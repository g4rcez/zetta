import { useCallback, useEffect, useRef, useState } from "react";
import { Button } from "@/components/ui";

import { call, errorMessage } from "../chat/chat-client";

type Kind = "browser" | "desktop";
type Session = { profile: string; control: "agent" | "human"; url?: string };
const path = (kind: Kind, profile: string) => `/api/computer/${kind === "desktop" ? "desktop/" : ""}sessions/${encodeURIComponent(profile)}`;

/**
 * Shows while a bot has a live browser or desktop session of the signed-in user: who is driving, a Take over / Hand back button
 * and an optional live view. Render it above the composer of the chat with that bot. Renders nothing when there is no session.
 * Sessions are always the caller's own (the server scopes them by user).
 */
export function ComputerActivity({ botId, botName = "The bot", pollMs = 3000 }: { botId: string; botName?: string; pollMs?: number }) {
  const [found, setFound] = useState<{ kind: Kind; session: Session }>();
  const [live, setLive] = useState(false);
  const [png, setPng] = useState<string>();
  const [error, setError] = useState<string>();
  // With the VM backend, desktop use shows as a live card on the bot's message instead (chat/vm-card.tsx): only Cua desktop sessions are polled here.
  const [cuaDesktop, setCuaDesktop] = useState(false);
  useEffect(() => { call<{ desktopBackend?: string | null }>("/api/computer/capabilities").then((c) => setCuaDesktop(c.desktopBackend === "cua-spaces"), () => {}); }, []);
  const polling = useRef(false); // never stack polls behind a slow one: they would hold browser connections the chat needs
  const find = useCallback(async () => {
    if (polling.current) return;
    polling.current = true;
    try {
      const [b, d] = await Promise.all([
        call<{ sessions: Session[] }>("/api/computer/sessions").catch(() => ({ sessions: [] as Session[] })),
        cuaDesktop ? call<{ sessions: Session[] }>("/api/computer/desktop/sessions").catch(() => ({ sessions: [] as Session[] })) : { sessions: [] as Session[] },
      ]);
      const br = b.sessions.find((s) => s.profile === `b-${botId}`); const de = d.sessions.find((s) => s.profile === `d-${botId}`);
      // Prefer whichever one a person is controlling, then the browser.
      const hit = (de?.control === "human" ? { kind: "desktop" as const, session: de } : br ? { kind: "browser" as const, session: br } : de ? { kind: "desktop" as const, session: de } : undefined);
      setFound(hit);
    } finally { polling.current = false; }
  }, [botId, cuaDesktop]);
  useEffect(() => { setFound(undefined); setLive(false); void find(); const t = setInterval(() => void find(), pollMs); return () => clearInterval(t); }, [find, pollMs]);
  const kind = found?.kind; const profile = found?.session.profile;
  useEffect(() => {
    if (!live || !kind || !profile) return;
    let stop = false;
    const shot = () => call<{ png: string }>(`${path(kind, profile)}/screenshot`).then((r) => { if (!stop) { setPng(r.png); setError(undefined); } }, (e) => { if (!stop) setError(errorMessage(e)); });
    void shot(); const t = setInterval(() => void shot(), 2000);
    return () => { stop = true; clearInterval(t); };
  }, [live, kind, profile]);
  if (!found) return null;
  const human = found.session.control === "human"; const what = found.kind === "desktop" ? "desktop" : "browser";
  async function takeover() {
    try { await call(`${path(found!.kind, found!.session.profile)}/takeover`, "POST", { human: !human, expected: found!.session.control }); setError(undefined); if (!human) setLive(true); }
    catch (e) { setError(errorMessage(e)); }
    await find();
  }
  return (
    <section aria-label={`${botName} computer use`} className="space-y-2 rounded-md border bg-card p-3 text-sm">
      <div className="flex flex-wrap items-center gap-2">
        <span role="status" className="min-w-0 flex-1 break-words">
          <span aria-hidden className={`mr-2 inline-block size-2 rounded-full ${human ? "bg-amber-500" : "bg-emerald-500"}`} />
          {human ? `You are controlling the ${what}. ${botName} is paused.` : `${botName} is using the ${what}${found.session.url && found.session.url !== "about:blank" ? `: ${found.session.url}` : ""}`}
        </span>
        <Button size="sm" variant="outline" onClick={() => setLive((v) => !v)} aria-pressed={live}>{live ? "Hide live view" : "Watch live"}</Button>
        <Button size="sm" onClick={() => void takeover()}>{human ? "Hand back" : "Take over"}</Button>
      </div>
      {live && png && <img alt={`Live ${what} view`} src={`data:image/png;base64,${png}`} className="h-auto w-full max-w-[1024px] rounded border" />}
      <p role="alert" className="text-xs text-destructive empty:hidden">{error}</p>
    </section>
  );
}
