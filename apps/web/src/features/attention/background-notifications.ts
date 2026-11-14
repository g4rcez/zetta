import { mentionsUser } from "@zetta/core/mentions";
import { useQueryClient } from "@tanstack/react-query";
import { useEffect } from "react";

import { call } from "../chat/chat-client";
import { chatQueries } from "../chat/chat-queries";
import { artifactsApi } from "../artifacts/artifacts-api";
import { nativeNotificationState, showNative } from "./summary";

type Routine = { id: string; title: string; lastRunAt?: string | null; status?: string };

const INTERVAL_MS = 30_000;
const HIDDEN_INTERVAL_MS = 60_000; // alerts matter most while the tab is hidden, so it keeps polling, just less often
const away = () => document.hidden || !document.hasFocus();

/**
 * Slack-style alerts for work that finished while the window was not in focus: a bot answered a chat,
 * a routine ran, an artifact was created. Polls the existing list endpoints and compares with what the
 * previous poll saw, so the first poll after load only records a baseline.
 */
export function useBackgroundNotifications() {
  const qc = useQueryClient();
  useEffect(() => {
    if (nativeNotificationState() === "unsupported") return;
    const chats = new Map<string, string>();
    const runs = new Map<string, string | null | undefined>();
    const artifacts = new Set<string>();
    let primed = false;
    let stopped = false;
    let polling = false;

    async function poll() {
      if (stopped || polling || nativeNotificationState() !== "granted") return;
      // In focus nobody needs an alert: send nothing. The next poll after the window loses focus starts a new baseline.
      if (!away()) {
        primed = false;
        return;
      }
      polling = true;
      try {
        // Each poll needs the answer of now to compare with the last one, so no cached value is good enough (`staleTime: 0`).
        const fresh = { staleTime: 0 };
        const [conversations, routines, list] = await Promise.all([
          qc.fetchQuery({ ...chatQueries.conversations(), ...fresh }),
          // Same key and shape as the Routines page, so the two share one entry.
          qc.fetchQuery({
            queryKey: ["routines", { state: "all" }],
            queryFn: () => call<{ routines: Routine[] }>("/api/routines").then((r) => r.routines),
            ...fresh,
          }),
          qc.fetchQuery({
            queryKey: ["artifacts", "notifications"],
            queryFn: () => artifactsApi.list(),
            ...fresh,
          }),
        ]);
        const notify = primed && away();
        const changed = conversations.filter((c) => {
          const before = chats.get(c.id);
          chats.set(c.id, c.updatedAt);
          return notify && before !== undefined && before !== c.updatedAt;
        });
        const histories = await Promise.all(
          changed.map((c) => qc.fetchQuery({ ...chatQueries.messages(c.id), ...fresh })),
        );
        for (const [i, c] of changed.entries()) {
          const last = histories[i]!.at(-1);
          // A reply that calls `@user` already raised its own attention card, and that card notifies.
          if (
            last?.role === "assistant" &&
            last.status === "complete" &&
            last.content.trim() &&
            !mentionsUser(last.content)
          )
            showNative(c.title || "New reply", last.content, `chat-${c.id}`, `/chat/${c.id}`);
        }
        for (const r of routines) {
          const before = runs.get(r.id);
          runs.set(r.id, r.lastRunAt);
          // A failed run raised a decision card in Inbox, and that card notifies: a second alert would say it twice.
          if (
            notify &&
            r.status !== "failed" &&
            r.lastRunAt &&
            before !== undefined &&
            before !== r.lastRunAt
          )
            showNative(
              `Routine ran: ${r.title}`,
              "",
              `routine-${r.id}-${r.lastRunAt}`,
              "/routines",
            );
        }
        for (const a of list) {
          if (notify && !artifacts.has(a.id))
            showNative(
              `Artifact ready: ${a.title}`,
              a.description,
              `artifact-${a.id}`,
              `/artifacts/${a.id}`,
            );
          artifacts.add(a.id);
        }
        primed = true;
      } catch {
        /* signed out or offline: try again on the next tick */
      } finally {
        polling = false;
      }
    }
    // The baseline is taken when the window goes away, so a change in the first seconds away still raises an alert.
    const onAway = () => void poll();
    window.addEventListener("blur", onAway);
    document.addEventListener("visibilitychange", onAway);
    let timer: ReturnType<typeof setTimeout>;
    const loop = async () => {
      await poll();
      if (!stopped)
        timer = setTimeout(() => void loop(), document.hidden ? HIDDEN_INTERVAL_MS : INTERVAL_MS);
    };
    void loop();
    return () => {
      stopped = true;
      clearTimeout(timer);
      window.removeEventListener("blur", onAway);
      document.removeEventListener("visibilitychange", onAway);
    };
  }, [qc]);
}
