import { useCallback, useEffect, useState, type FormEvent } from "react";
import { Button } from "@/components/ui";

import { call } from "../chat/chat-client";
import { field } from "../shared/ui";
import { computerError } from "./computer";

type DSession = { profile: string; control: "agent" | "human"; epoch: number; space: string };

/** Desktop control in the user's own Linux container (Cua Space): look, click, type, take over, hand back. */
export function DesktopPanel({ onError }: { onError: (m: string) => void }) {
  const profile = "default";
  const base = `/api/computer/desktop/sessions/${profile}`;
  const [session, setSession] = useState<DSession>();
  const [png, setPng] = useState<string>();
  const [busy, setBusy] = useState(false);
  const refresh = useCallback(() => call<{ png: string }>(`${base}/screenshot`).then((r) => setPng(r.png), (e) => onError(computerError(e))), [base, onError]);
  useEffect(() => { call<{ sessions: DSession[] }>("/api/computer/desktop/sessions").then((r) => { setSession(r.sessions[0]); if (r.sessions[0]) void refresh(); }, () => {}); }, [refresh]);
  const act = (body: object) => call<{ session: DSession }>(`${base}/action`, "POST", body).then((r) => { setSession(r.session); return refresh(); }, (e) => onError(computerError(e)));
  async function start() { setBusy(true); try { setSession((await call<{ session: DSession }>("/api/computer/desktop/sessions", "POST", { profile })).session); await refresh(); } catch (e) { onError(computerError(e)); } finally { setBusy(false); } }
  return (
    <section aria-label="Desktop" className="space-y-2 rounded-lg border bg-card p-4">
      <h2 className="text-sm font-medium">Desktop</h2>
      <p className="text-xs text-muted-foreground">A private Linux desktop that only you and your bots can use. It starts empty and is deleted when you close it.</p>
      {!session ? <Button size="sm" onClick={() => void start()} disabled={busy}>{busy ? "Starting… (the first start can take a minute)" : "Start desktop"}</Button> : (
        <div className="space-y-2">
          <div className="flex flex-wrap items-center gap-2 text-sm">
            <span>{session.control === "human" ? "You are in control (bots are paused)" : "Bots may use this desktop"}</span>
            <Button size="sm" variant="outline" onClick={() => void call<{ session: DSession }>(`${base}/takeover`, "POST", { human: session.control !== "human", expected: session.control }).then((r) => setSession(r.session), (e) => onError(computerError(e)))}>{session.control === "human" ? "Hand back to bots" : "Take over"}</Button>
            <Button size="sm" variant="outline" onClick={() => void refresh()}>Refresh</Button>
            <Button size="sm" variant="outline" onClick={() => void call(base, "DELETE").then(() => { setSession(undefined); setPng(undefined); }, (e) => onError(computerError(e)))}>Close desktop</Button>
          </div>
          {png && <img alt="Remote desktop screen" src={`data:image/png;base64,${png}`} className="w-full max-w-[1200px] cursor-crosshair rounded border" onClick={(e) => { const img = e.currentTarget; const r = img.getBoundingClientRect(); void act({ type: "click", x: Math.round(((e.clientX - r.left) / r.width) * img.naturalWidth), y: Math.round(((e.clientY - r.top) / r.height) * img.naturalHeight) }); }} />}
          <form className="flex gap-2" onSubmit={(e: FormEvent<HTMLFormElement>) => { e.preventDefault(); const text = String(new FormData(e.currentTarget).get("text")); e.currentTarget.reset(); void act({ type: "type", text }); }}>
            <input name="text" aria-label="Type into the desktop" placeholder="Type into the focused window" className={field} /><Button size="sm" type="submit">Type</Button>
            <Button size="sm" type="button" variant="outline" onClick={() => void act({ type: "key", key: "Return" })}>Enter</Button>
            <Button size="sm" type="button" variant="outline" onClick={() => void act({ type: "scroll", direction: "down" })}>Scroll down</Button>
          </form>
        </div>)}
    </section>
  );
}
