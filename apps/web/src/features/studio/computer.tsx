import { DesktopPanel, VmPanel } from "./desktop";
import { useCallback, useEffect, useState } from "react";
import { Button, Input } from "@/components/ui";

import { ApiError, call, errorMessage } from "../chat/chat-client";
import { Badge, ConfirmButton, Empty, list, listItem, Panel } from "../shared/ui";

type Session = { profile: string; control: "agent" | "human"; url: string };
type Profile = { name: string; mode: "dedicated" | "shared"; revoked: boolean };

/** Friendly wording for the computer errors (409 HUMAN_IN_CONTROL / STALE_CONTROL, 410 REVOKED). */
export function computerError(e: unknown): string {
  if (e instanceof ApiError) {
    if (e.code === "HUMAN_IN_CONTROL") return "A person is in control of this browser right now. Hand it back to the bots before they can use it.";
    if (e.code === "REVOKED" || e.status === 410) return "This browser profile was revoked, so it cannot be used. Reset it in the profile list to start fresh.";
    if (e.code === "STALE_CONTROL") return "Control changed while you were clicking, so nothing happened. The view was refreshed; try again.";
  }
  return errorMessage(e);
}

function Profiles({ onError, refreshKey }: { onError: (m: string) => void; refreshKey: number }) {
  const [profiles, setProfiles] = useState<Profile[]>();
  const [status, setStatus] = useState<string>();
  const load = useCallback(() => call<{ profiles: Profile[] }>("/api/computer/profiles").then((r) => setProfiles(r.profiles), (e) => onError(computerError(e))), [onError]);
  useEffect(() => { void load(); }, [load, refreshKey]);
  const run = async (work: () => Promise<unknown>, done: string) => { setStatus(undefined); try { await work(); setStatus(done); } catch (e) { onError(computerError(e)); } await load(); };
  return (
    <Panel title="Browser profiles" label="Browser profiles" description="Each profile keeps its own sign-ins and cookies. Reset clears them; revoke stops all use of the profile.">
      {profiles?.length === 0 && <Empty>No profiles yet. One is created when you start a browser.</Empty>}
      <ul className={list}>{profiles?.map((p) => (
        <li key={p.name} className={`${listItem} flex flex-wrap items-center justify-between gap-2`}>
          <span className="flex min-w-0 flex-wrap items-center gap-2 break-words"><strong>{p.name}</strong><span className="text-muted-foreground">{p.mode === "shared" ? "Shared by your bots" : "For one bot"}</span>{p.revoked && <Badge tone="danger">Revoked</Badge>}</span>
          <span className="flex flex-wrap gap-1">
            <ConfirmButton size="xs" label="Reset" question="Clear sign-ins and cookies for this profile?" confirmLabel="Reset" onConfirm={() => run(() => call(`/api/computer/profiles/${encodeURIComponent(p.name)}/reset`, "POST"), `Reset ${p.name}.`)} />
            {!p.revoked && <ConfirmButton size="xs" label="Revoke" question="Revoke this profile? Bots will lose access." confirmLabel="Revoke" onConfirm={() => run(() => call(`/api/computer/profiles/${encodeURIComponent(p.name)}`, "DELETE"), `Revoked ${p.name}.`)} />}
          </span>
        </li>))}</ul>
      <p role="status" className="text-xs empty:hidden">{status}</p>
    </Panel>
  );
}

export function Computer({ onError }: { onError: (m: string) => void }) {
  const [profile, setProfile] = useState("default");
  const [session, setSession] = useState<Session>();
  const [png, setPng] = useState<string>();
  const [caps, setCaps] = useState<{ browser: boolean; desktop: boolean; desktopBackend?: string | null; note?: string }>();
  const [tick, setTick] = useState(0);
  const base = `/api/computer/sessions/${profile}`;
  const refresh = useCallback((p?: string) => call<{ png: string }>(`/api/computer/sessions/${p ?? profile}/screenshot`).then((r) => setPng(r.png)).catch((e) => onError(computerError(e))), [profile, onError]);
  const reloadSession = useCallback(() => call<{ sessions: Session[] }>("/api/computer/sessions").then((r) => { /* a bot's own session (b-<botId>) is listed too, so a handoff from chat can be taken over here */ const s = r.sessions.find((x) => x.profile === profile) ?? r.sessions.find((x) => x.profile === "default") ?? r.sessions[0]; setSession(s); if (s) { setProfile(s.profile); void refresh(s.profile); } }).catch(() => {}), [refresh, profile]);
  useEffect(() => { void reloadSession(); call<{ browser: boolean; desktop: boolean; desktopBackend?: string | null; note?: string }>("/api/computer/capabilities").then(setCaps, () => {}); }, [reloadSession]);
  const act = (body: object) => call<{ session: Session }>(`${base}/action`, "POST", body).then((r) => { setSession(r.session); return refresh(); }, (e) => { onError(computerError(e)); void reloadSession(); });
  async function start() { try { setSession((await call<{ session: Session }>("/api/computer/sessions", "POST", { profile })).session); setTick((t) => t + 1); } catch (e) { onError(computerError(e)); } }
  async function takeover() {
    if (!session) return;
    try { setSession((await call<{ session: Session }>(`${base}/takeover`, "POST", { human: session.control !== "human", expected: session.control })).session); }
    catch (e) { onError(computerError(e)); await reloadSession(); } // STALE_CONTROL: show what the control really is now
  }
  return (
    <section aria-label="Computer" className="space-y-6">
      <Panel title="Remote browser" description={<>An isolated browser with its own profile, only for you. Bots with Computer use turned on (in their settings) open pages here, one browser per bot; here you can look, take over, and hand it back. /browse in chat and workflow browse steps use it too. Only public web addresses are allowed.</>}>
        {caps && <p className="flex flex-wrap items-center gap-2 rounded-md bg-muted/50 px-3 py-2 text-xs text-muted-foreground"><Badge tone={caps.browser ? "success" : "danger"}>{caps.browser ? "Browser available" : "Browser unavailable"}</Badge> {caps.desktop ? "Desktop control: available (private Linux desktop)." : (caps.note ?? "Controlling the whole desktop is not available; only isolated browser sessions are.")}</p>}
        {caps?.desktop && (caps.desktopBackend === "vm" ? <VmPanel onError={onError} /> : <DesktopPanel onError={onError} />)}
        {!session ? <Button size="sm" onClick={() => void start()}>Start browser</Button> : (
          <div className="space-y-2">
            <form className="flex items-end gap-2 [&>div:first-child]:flex-1" onSubmit={(e) => { e.preventDefault(); const url = String(new FormData(e.currentTarget).get("url")); void act({ type: "open", url }); }}>
              <Input title="Address" hiddenLabel name="url" defaultValue={session.url === "about:blank" ? "" : session.url} placeholder="https://example.com" />
              <Button size="sm" type="submit">Go</Button>
            </form>
            <div className="flex flex-wrap items-center gap-2 text-sm">
              <span role="status" className="mr-auto"><Badge tone={session.control === "human" ? "warning" : "success"}>{session.control === "human" ? "You are in control (bots paused)" : "Bots may use this browser"}</Badge></span>
              <Button size="sm" variant="outline" onClick={() => void takeover()}>{session.control === "human" ? "Hand back to bots" : "Take over"}</Button>
              <Button size="sm" variant="outline" onClick={() => void refresh()}>Refresh</Button>
              <Button size="sm" variant="outline" onClick={() => void act({ type: "scroll", dy: 400 })}>Scroll down</Button>
              <Button size="sm" variant="outline" onClick={() => void call(base, "DELETE").then(() => { setSession(undefined); setPng(undefined); }, (e) => onError(computerError(e)))}>Close browser</Button>
            </div>
            {png && <img alt="Remote browser screen" src={`data:image/png;base64,${png}`} className="h-auto w-full max-w-[1024px] cursor-crosshair rounded-lg border shadow-xs" onClick={(e) => { const r = e.currentTarget.getBoundingClientRect(); void act({ type: "click", x: Math.round(((e.clientX - r.left) / r.width) * 1024), y: Math.round(((e.clientY - r.top) / r.height) * 640) }); }} />}
            <form className="flex items-end gap-2 [&>div:first-child]:flex-1" onSubmit={(e) => { e.preventDefault(); const text = String(new FormData(e.currentTarget).get("text")); e.currentTarget.reset(); void act({ type: "type", text }); }}>
              <Input title="Type into the page" hiddenLabel name="text" placeholder="Type into the focused field" /><Button size="sm" type="submit">Type</Button>
              <Button size="sm" type="button" variant="outline" onClick={() => void act({ type: "key", key: "Enter" })}>Enter</Button>
            </form>
          </div>)}
      </Panel>
      <Profiles onError={onError} refreshKey={tick} />
    </section>
  );
}
