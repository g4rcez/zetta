import { ZoomImage } from "@/components/zoom-image";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useState } from "react";
import { Button } from "@/components/ui";

import { call, errorMessage } from "../chat/chat-client";

type Session = { profile: string; control: "agent" | "human"; url?: string };
const path = (profile: string) => `/api/computer/sessions/${encodeURIComponent(profile)}`;

const IDLE_POLL_MS = 15_000;
const sessionsKey = ["computer", "sessions"] as const;

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
  const qc = useQueryClient();
  const [live, setLive] = useState(false);
  const [actionError, setActionError] = useState<string>();
  useEffect(() => setLive(false), [botId]);
  // The list is the caller's own sessions, shared by every bot's card. Polls fast while this bot has a session, slowly otherwise.
  const sessions = useQuery({
    queryKey: sessionsKey,
    queryFn: () =>
      call<{ sessions: Session[] }>("/api/computer/sessions").then(
        (r) => r.sessions,
        () => [] as Session[],
      ),
    refetchInterval: (q) =>
      q.state.data?.some((s) => s.profile === `b-${botId}`) ? pollMs : IDLE_POLL_MS,
  });
  const session = sessions.data?.find((s) => s.profile === `b-${botId}`);
  const found = session ? { session } : undefined;
  const profile = session?.profile;
  const shot = useQuery({
    queryKey: [...sessionsKey, profile, "screenshot"],
    queryFn: () => call<{ png: string }>(`${path(profile!)}/screenshot`),
    enabled: live && Boolean(profile),
    refetchInterval: 2000,
    staleTime: 0,
    gcTime: 0,
  });
  const png = shot.data?.png;
  const error = actionError ?? (shot.error ? errorMessage(shot.error) : undefined);
  if (!found) return null;
  const human = found.session.control === "human";
  const what = "browser";
  async function takeover() {
    try {
      await call(`${path(found!.session.profile)}/takeover`, "POST", {
        human: !human,
        expected: found!.session.control,
      });
      setActionError(undefined);
      if (!human) setLive(true);
    } catch (e) {
      setActionError(errorMessage(e));
    }
    await qc.invalidateQueries({ queryKey: sessionsKey });
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
        <ZoomImage
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
