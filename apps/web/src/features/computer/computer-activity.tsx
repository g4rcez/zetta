import { useCallback, useEffect, useRef, useState } from "react";
import { Button } from "@/components/ui";

import { call, errorMessage } from "../chat/chat-client";

type Session = { profile: string; control: "agent" | "human"; url?: string };
const path = (profile: string) => `/api/computer/sessions/${encodeURIComponent(profile)}`;

const IDLE_POLL_MS = 15_000;

/**
 * Shows while a bot has a live browser session of the signed-in user: who is driving, a Take over / Hand back button
 * and an optional live view. Render it above the composer of the chat with that bot. Renders nothing when there is no session.
 * Sessions are always the caller's own (the server scopes them by user).
 */
export function ComputerActivity({
  botId,
  botName = "The bot",
  pollMs = 3000,
}: {
  botId: string;
  botName?: string;
  pollMs?: number;
}) {
  const [found, setFound] = useState<{ session: Session }>();
  const [live, setLive] = useState(false);
  const [png, setPng] = useState<string>();
  const [error, setError] = useState<string>();
  const has = useRef(false); // a session was found: poll fast; otherwise back off
  const polling = useRef(false); // never stack polls behind a slow one: they would hold browser connections the chat needs
  const find = useCallback(async () => {
    if (polling.current) return;
    polling.current = true;
    try {
      const b = await call<{ sessions: Session[] }>("/api/computer/sessions").catch(() => ({
        sessions: [] as Session[],
      }));
      const br = b.sessions.find((s) => s.profile === `b-${botId}`);
      const hit = br ? { session: br } : undefined;
      has.current = !!hit;
      setFound(hit);
    } finally {
      polling.current = false;
    }
  }, [botId]);
  // Polls only while the tab is visible, slowly while there is nothing to show, and right away when the tab comes back.
  useEffect(() => {
    setFound(undefined);
    setLive(false);
    has.current = false;
    let stop = false,
      t: ReturnType<typeof setTimeout> | undefined;
    const tick = async () => {
      clearTimeout(t);
      if (document.visibilityState === "visible") await find();
      clearTimeout(t); // a visibility tick may have scheduled one while this find was in flight
      if (!stop) t = setTimeout(() => void tick(), has.current ? pollMs : IDLE_POLL_MS);
    };
    const onVisible = () => {
      if (document.visibilityState === "visible") void tick();
    };
    document.addEventListener("visibilitychange", onVisible);
    void tick();
    return () => {
      stop = true;
      clearTimeout(t);
      document.removeEventListener("visibilitychange", onVisible);
    };
  }, [find, pollMs]);
  const profile = found?.session.profile;
  useEffect(() => {
    if (!live || !profile) return;
    let stop = false;
    const shot = () =>
      call<{ png: string }>(`${path(profile)}/screenshot`).then(
        (r) => {
          if (!stop) {
            setPng(r.png);
            setError(undefined);
          }
        },
        (e) => {
          if (!stop) setError(errorMessage(e));
        },
      );
    void shot();
    const t = setInterval(() => void shot(), 2000);
    return () => {
      stop = true;
      clearInterval(t);
    };
  }, [live, profile]);
  if (!found) return null;
  const human = found.session.control === "human";
  const what = "browser";
  async function takeover() {
    try {
      await call(`${path(found!.session.profile)}/takeover`, "POST", {
        human: !human,
        expected: found!.session.control,
      });
      setError(undefined);
      if (!human) setLive(true);
    } catch (e) {
      setError(errorMessage(e));
    }
    await find();
  }
  return (
    <section
      aria-label={`${botName} computer use`}
      className="space-y-2 rounded-md border bg-card p-3 text-sm"
    >
      <div className="flex flex-wrap items-center gap-2">
        <span role="status" className="min-w-0 flex-1 break-words">
          <span
            aria-hidden
            className={`mr-2 inline-block size-2 rounded-full ${human ? "bg-warn" : "bg-success"}`}
          />
          {human
            ? `You are controlling the ${what}. ${botName} is paused.`
            : `${botName} is using the ${what}${found.session.url && found.session.url !== "about:blank" ? `: ${found.session.url}` : ""}`}
        </span>
        <Button size="sm" variant="outline" onClick={() => setLive((v) => !v)} aria-pressed={live}>
          {live ? "Hide live view" : "Watch live"}
        </Button>
        <Button size="sm" onClick={() => void takeover()}>
          {human ? "Hand back" : "Take over"}
        </Button>
      </div>
      {live && png && (
        <img
          alt={`Live ${what} view`}
          src={`data:image/png;base64,${png}`}
          className="h-auto w-full max-w-[1024px] rounded border"
        />
      )}
      <p role="alert" className="text-xs text-destructive empty:hidden">
        {error}
      </p>
    </section>
  );
}
