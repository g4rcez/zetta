import { useCallback, useEffect, useRef, useState, type FormEvent } from "react";
import { Button, Input } from "@/components/ui";

import { ApiError, call, errorMessage } from "../chat/chat-client";

export type VmControl = { id: string; control: "agent" | "human"; epoch: number };

/** Friendly wording for VM errors; NOT_FOUND on a screenshot just means the computer is stopped. */
export function vmError(e: unknown): string {
  if (e instanceof ApiError) {
    if (e.code === "LIMIT") return "Too many computers are running. Stop one in Studio > Computer first.";
    if (e.code === "STALE_CONTROL") return "Control changed while you were clicking, so nothing happened. Try again.";
    if (e.code === "BLOCKED_URL") return "That address is not allowed.";
  }
  return errorMessage(e);
}

/**
 * Live view of one of the user's computers, shared with the bots: the screen refreshes every couple of seconds, and your clicks and
 * typing go to the same machine the bot is using. Take over pauses the bots (for sign-ins); Hand back lets them continue.
 */
export function VmViewer({ vmId, compact = false, onStopped }: { vmId: string; compact?: boolean; onStopped?: () => void }) {
  const base = `/api/computer/vms/${vmId}`;
  const [png, setPng] = useState<string>();
  const [control, setControl] = useState<VmControl["control"]>("agent");
  const [error, setError] = useState<string>();
  const [stopped, setStopped] = useState(false);
  const busy = useRef(false);
  const refresh = useCallback(async () => {
    if (busy.current) return; busy.current = true;
    try { setPng((await call<{ png: string }>(`${base}/screenshot`)).png); setError(undefined); setStopped(false); }
    catch (e) { if (e instanceof ApiError && e.code === "NOT_FOUND") { setStopped(true); onStopped?.(); } else setError(vmError(e)); }
    finally { busy.current = false; }
  }, [base, onStopped]);
  useEffect(() => {
    void refresh();
    const t = setInterval(() => { if (document.visibilityState === "visible") void refresh(); }, 2000);
    return () => clearInterval(t);
  }, [refresh]);
  useEffect(() => { call<{ vms: (VmControl & { status: string })[] }>("/api/computer/vms").then((r) => { const v = r.vms.find((x) => x.id === vmId); if (v) setControl(v.control); }, () => {}); }, [vmId]);
  const act = (body: object) => call<{ vm: VmControl }>(`${base}/action`, "POST", body).then(() => refresh(), (e) => setError(vmError(e)));
  const toggle = () => call<{ vm: VmControl }>(`${base}/takeover`, "POST", { human: control !== "human", expected: control }).then((r) => setControl(r.vm.control), (e) => setError(vmError(e)));
  const start = () => call(`${base}/start`, "POST").then(() => { setStopped(false); return refresh(); }, (e) => setError(vmError(e)));

  if (stopped) return (
    <div className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
      This computer is stopped. <Button size="sm" variant="outline" onClick={() => void start()}>Start it</Button>
    </div>);
  return (
    <div className="space-y-2">
      <div className="flex flex-wrap items-center gap-2 text-xs">
        <span role="status" className="mr-auto text-muted-foreground">{control === "human" ? "You are in control: bots are paused." : "Live. Your clicks and typing go to the same computer the bot is using."}</span>
        <Button size="sm" variant="outline" onClick={() => void toggle()}>{control === "human" ? "Hand back to bots" : "Take over"}</Button>
        {!compact && <Button size="sm" variant="outline" onClick={() => void refresh()}>Refresh</Button>}
      </div>
      {png
        ? <img alt="Computer screen" src={`data:image/png;base64,${png}`} className={`${compact ? "max-w-[720px]" : "max-w-[1280px]"} h-auto w-full cursor-crosshair rounded-lg border shadow-xs`}
            onClick={(e) => { const img = e.currentTarget, r = img.getBoundingClientRect(); void act({ type: "click", x: Math.round(((e.clientX - r.left) / r.width) * img.naturalWidth), y: Math.round(((e.clientY - r.top) / r.height) * img.naturalHeight) }); }} />
        : <p role="status" className="text-xs text-muted-foreground">Loading the screen…</p>}
      <form className="flex flex-wrap items-end gap-2 [&>div:first-child]:flex-1" onSubmit={(e: FormEvent<HTMLFormElement>) => { e.preventDefault(); const text = String(new FormData(e.currentTarget).get("text")); e.currentTarget.reset(); if (text) void act({ type: "type", text }); }}>
        <Input title="Type into the computer" hiddenLabel name="text" placeholder="Type into the focused window" /><Button size="sm" type="submit">Type</Button>
        <Button size="sm" type="button" variant="outline" onClick={() => void act({ type: "key", key: "Return" })}>Enter</Button>
        <Button size="sm" type="button" variant="outline" onClick={() => void act({ type: "scroll", direction: "down" })}>Scroll</Button>
      </form>
      <p role="alert" className="text-xs text-destructive empty:hidden">{error}</p>
    </div>
  );
}
