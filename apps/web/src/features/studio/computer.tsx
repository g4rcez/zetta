import { DesktopPanel } from "./desktop";
import { useCallback, useEffect, useState } from "react";
import { Button } from "@/components/ui";

import { ApiError, call, errorMessage } from "../chat/chat-client";
import { ConfirmButton, Empty, field } from "../shared/ui";

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
    <section aria-label="Browser profiles" className="space-y-3 rounded-lg border bg-card p-5">
      <h2 className="font-medium">Browser profiles</h2>
      <p className="text-xs text-muted-foreground">Each profile keeps its own sign-ins and cookies. Reset clears them; revoke stops all use of the profile.</p>
      {profiles?.length === 0 && <Empty>No profiles yet. One is created when you start a browser.</Empty>}
      <ul className="space-y-1">{profiles?.map((p) => (
        <li key={p.name} className="flex flex-wrap items-center justify-between gap-2 rounded-md border bg-card p-3 text-sm">
          <span className="min-w-0 break-words"><strong>{p.name}</strong> · {p.mode === "shared" ? "shared by your bots" : "for one bot"}{p.revoked ? " · revoked" : ""}</span>
          <span className="flex flex-wrap gap-1">
            <ConfirmButton size="xs" label="Reset" question="Clear sign-ins and cookies for this profile?" confirmLabel="Reset" onConfirm={() => run(() => call(`/api/computer/profiles/${encodeURIComponent(p.name)}/reset`, "POST"), `Reset ${p.name}.`)} />
            {!p.revoked && <ConfirmButton size="xs" label="Revoke" question="Revoke this profile? Bots will lose access." confirmLabel="Revoke" onConfirm={() => run(() => call(`/api/computer/profiles/${encodeURIComponent(p.name)}`, "DELETE"), `Revoked ${p.name}.`)} />}
          </span>
        </li>))}</ul>
      <p role="status" className="text-xs empty:hidden">{status}</p>
    </section>
  );
}

export function Computer({ onError }: { onError: (m: string) => void }) {
  const profile = "default";
  const [session, setSession] = useState<Session>();
  const [png, setPng] = useState<string>();
  const [caps, setCaps] = useState<{ browser: boolean; desktop: boolean; note?: string }>();
  const [tick, setTick] = useState(0);
  const base = `/api/computer/sessions/${profile}`;
  const refresh = useCallback(() => call<{ png: string }>(`${base}/screenshot`).then((r) => setPng(r.png)).catch((e) => onError(computerError(e))), [base, onError]);
  const reloadSession = useCallback(() => call<{ sessions: Session[] }>("/api/computer/sessions").then((r) => { setSession(r.sessions.find((s) => s.profile === profile) ?? r.sessions[0]); if (r.sessions[0]) void refresh(); }).catch(() => {}), [refresh]);
  useEffect(() => { void reloadSession(); call<{ browser: boolean; desktop: boolean; note?: string }>("/api/computer/capabilities").then(setCaps, () => {}); }, [reloadSession]);
  const act = (body: object) => call<{ session: Session }>(`${base}/action`, "POST", body).then((r) => { setSession(r.session); return refresh(); }, (e) => { onError(computerError(e)); void reloadSession(); });
  async function start() { try { setSession((await call<{ session: Session }>("/api/computer/sessions", "POST", { profile })).session); setTick((t) => t + 1); } catch (e) { onError(computerError(e)); } }
  async function takeover() {
    if (!session) return;
    try { setSession((await call<{ session: Session }>(`${base}/takeover`, "POST", { human: session.control !== "human", expected: session.control })).session); }
    catch (e) { onError(computerError(e)); await reloadSession(); } // STALE_CONTROL: show what the control really is now
  }
  return (
    <section aria-label="Computer" className="space-y-4">
      <div className="space-y-3">
        <p className="text-sm text-muted-foreground">An isolated browser with its own profile, only for you. Bots read pages with /browse in chat or a browse step in workflows; here you can look, take over, and hand it back. Only public web addresses are allowed.</p>
        {caps && <p className="rounded-md border bg-card p-3 text-xs">{caps.browser ? "Browser control: available." : "Browser control: not available."} {caps.desktop ? "Desktop control: available (private Linux desktop)." : (caps.note ?? "Controlling the whole desktop is not available; only isolated browser sessions are.")}</p>}
        {caps?.desktop && <DesktopPanel onError={onError} />}
        {!session ? <Button size="sm" onClick={() => void start()}>Start browser</Button> : (
          <div className="space-y-2">
            <form className="flex gap-2" onSubmit={(e) => { e.preventDefault(); const url = String(new FormData(e.currentTarget).get("url")); void act({ type: "open", url }); }}>
              <input name="url" aria-label="Address" defaultValue={session.url === "about:blank" ? "" : session.url} placeholder="https://example.com" className={field} />
              <Button size="sm" type="submit">Go</Button>
            </form>
            <div className="flex flex-wrap items-center gap-2 text-sm">
              <span role="status">{session.control === "human" ? "You are in control (bots are paused)" : "Bots may use this browser"}</span>
              <Button size="sm" variant="outline" onClick={() => void takeover()}>{session.control === "human" ? "Hand back to bots" : "Take over"}</Button>
              <Button size="sm" variant="outline" onClick={() => void refresh()}>Refresh</Button>
              <Button size="sm" variant="outline" onClick={() => void act({ type: "scroll", dy: 400 })}>Scroll down</Button>
              <Button size="sm" variant="outline" onClick={() => void call(base, "DELETE").then(() => { setSession(undefined); setPng(undefined); }, (e) => onError(computerError(e)))}>Close browser</Button>
            </div>
            {png && <img alt="Remote browser screen" src={`data:image/png;base64,${png}`} className="h-auto w-full max-w-[1024px] cursor-crosshair rounded border" onClick={(e) => { const r = e.currentTarget.getBoundingClientRect(); void act({ type: "click", x: Math.round(((e.clientX - r.left) / r.width) * 1024), y: Math.round(((e.clientY - r.top) / r.height) * 640) }); }} />}
            <form className="flex gap-2" onSubmit={(e) => { e.preventDefault(); const text = String(new FormData(e.currentTarget).get("text")); e.currentTarget.reset(); void act({ type: "type", text }); }}>
              <input name="text" aria-label="Type into the page" placeholder="Type into the focused field" className={field} /><Button size="sm" type="submit">Type</Button>
              <Button size="sm" type="button" variant="outline" onClick={() => void act({ type: "key", key: "Enter" })}>Enter</Button>
            </form>
          </div>)}
      </div>
      <Profiles onError={onError} refreshKey={tick} />
    </section>
  );
}
