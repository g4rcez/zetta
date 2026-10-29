import { useEffect } from "react";

import { call, chatClient } from "../chat/chat-client";
import { artifactsApi } from "../artifacts/artifacts-api";
import { nativeNotificationState, showNative } from "./summary";

type Routine = { id: string; title: string; lastRunAt?: string | null; status?: string };

const INTERVAL_MS = 30_000;
const away = () => document.hidden || !document.hasFocus();

/**
 * Slack-style alerts for work that finished while the window was not in focus: a bot answered a chat,
 * a routine ran, an artifact was created. Polls the existing list endpoints and compares with what the
 * previous poll saw, so the first poll after load only records a baseline.
 */
export function useBackgroundNotifications() {
  useEffect(() => {
    if (nativeNotificationState() === "unsupported") return;
    const chats = new Map<string, string>();
    const runs = new Map<string, string | null | undefined>();
    const artifacts = new Set<string>();
    let primed = false;
    let stopped = false;

    async function poll() {
      if (stopped || nativeNotificationState() !== "granted") return;
      try {
        const [conversations, { routines }, list] = await Promise.all([
          chatClient.conversations(),
          call<{ routines: Routine[] }>("/api/routines"),
          artifactsApi.list(),
        ]);
        const notify = primed && away();
        for (const c of conversations) {
          const before = chats.get(c.id);
          chats.set(c.id, c.updatedAt);
          if (!notify || before === undefined || before === c.updatedAt) continue;
          const last = (await chatClient.messages(c.id)).at(-1);
          if (last?.role === "assistant" && last.status === "complete" && last.content.trim())
            showNative(c.title || "New reply", last.content, `chat-${c.id}`, `/chat/${c.id}`);
        }
        for (const r of routines) {
          const before = runs.get(r.id);
          runs.set(r.id, r.lastRunAt);
          if (notify && r.lastRunAt && before !== undefined && before !== r.lastRunAt)
            showNative(
              r.status === "failed" ? `Routine failed: ${r.title}` : `Routine ran: ${r.title}`,
              "",
              `routine-${r.id}-${r.lastRunAt}`,
              "/studio/routines",
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
      }
    }
    void poll();
    const timer = setInterval(() => void poll(), INTERVAL_MS);
    return () => {
      stopped = true;
      clearInterval(timer);
    };
  }, []);
}
