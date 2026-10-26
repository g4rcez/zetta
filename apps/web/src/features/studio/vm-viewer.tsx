import { useCallback, useEffect, useRef, useState, type FormEvent } from "react";
import { Button, Input } from "@/components/ui";

import { ENV } from "../../env";
import { ApiError, call, errorMessage } from "../chat/chat-client";

export type VmControl = { id: string; control: "agent" | "human"; epoch: number };
type Rfb = InstanceType<typeof import("@novnc/novnc").default>;

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
 * Live VNC view of one of the user's computers, shared with the bots: the real screen, mouse and keyboard (click into it to type).
 * The server hands out a one-time ticket and bridges the WebSocket to the VM's VNC server; the VNC password never reaches the browser.
 * Take over pauses the bots (for sign-ins); Hand back lets them continue.
 */
export function VmViewer({ vmId, compact = false, onStopped }: { vmId: string; compact?: boolean; onStopped?: () => void }) {
  const base = `/api/computer/vms/${vmId}`;
  const screen = useRef<HTMLDivElement>(null);
  const rfb = useRef<Rfb>(undefined);
  const [state, setState] = useState<"connecting" | "connected" | "disconnected" | "stopped">("connecting");
  const [attempt, setAttempt] = useState(0);
  const [control, setControl] = useState<VmControl["control"]>("agent");
  const [error, setError] = useState<string>();
  const stopped = useRef(onStopped); stopped.current = onStopped;

  useEffect(() => {
    let cancelled = false;
    setState("connecting");
    (async () => {
      try {
        const [{ default: RFB }, { ticket }] = await Promise.all([import("@novnc/novnc"), call<{ ticket: string }>(`${base}/vnc-ticket`, "POST")]);
        if (cancelled || !screen.current) return;
        const url = new URL(`${base}/vnc`, ENV.VITE_SERVER_URL);
        url.protocol = url.protocol === "https:" ? "wss:" : "ws:"; url.searchParams.set("ticket", ticket);
        const r = new RFB(screen.current, url.toString(), { shared: true });
        r.scaleViewport = true; r.resizeSession = false; r.focusOnClick = true; r.background = "transparent";
        r.addEventListener("connect", () => { setState("connected"); setError(undefined); });
        r.addEventListener("disconnect", () => { if (rfb.current === r) { rfb.current = undefined; setState("disconnected"); } });
        r.addEventListener("securityfailure", () => setError("The computer refused the connection."));
        rfb.current = r;
      } catch (e) {
        if (cancelled) return;
        if (e instanceof ApiError && e.code === "NOT_FOUND") { setState("stopped"); stopped.current?.(); } else { setState("disconnected"); setError(vmError(e)); }
      }
    })();
    return () => { cancelled = true; const r = rfb.current; rfb.current = undefined; r?.disconnect(); };
  }, [base, attempt]);
  useEffect(() => { call<{ vms: (VmControl & { status: string })[] }>("/api/computer/vms").then((r) => { const v = r.vms.find((x) => x.id === vmId); if (v) setControl(v.control); }, () => {}); }, [vmId]);
  const reconnect = useCallback(() => setAttempt((n) => n + 1), []);
  const toggle = () => call<{ vm: VmControl }>(`${base}/takeover`, "POST", { human: control !== "human", expected: control }).then((r) => setControl(r.vm.control), (e) => setError(vmError(e)));
  const start = () => call(`${base}/start`, "POST").then(reconnect, (e) => setError(vmError(e)));
  const paste = (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault(); const text = String(new FormData(e.currentTarget).get("text")); e.currentTarget.reset();
    // Puts the text on the computer's clipboard; press Ctrl+V inside it to paste.
    if (text && rfb.current) { rfb.current.clipboardPasteFrom(text); rfb.current.focus(); }
  };

  if (state === "stopped") return (
    <div className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
      This computer is stopped. <Button size="sm" variant="outline" onClick={() => void start()}>Start it</Button>
    </div>);
  return (
    <div className="space-y-2">
      <div className="flex flex-wrap items-center gap-2 text-xs">
        <span role="status" className="mr-auto text-muted-foreground">
          {state === "connecting" ? "Connecting to the screen…" : state === "disconnected" ? "Disconnected from the screen." : control === "human" ? "You are in control: bots are paused." : "Live. Click into the screen to use the mouse and keyboard; bots share it."}
        </span>
        {state === "disconnected" && <Button size="sm" variant="outline" onClick={reconnect}>Reconnect</Button>}
        <Button size="sm" variant="outline" onClick={() => void toggle()}>{control === "human" ? "Hand back to bots" : "Take over"}</Button>
      </div>
      <div ref={screen} aria-label="Computer screen" className={`${compact ? "max-w-[720px]" : "max-w-[1280px]"} aspect-[16/10] w-full overflow-hidden rounded-lg border bg-black shadow-xs`} />
      {!compact && (
        <form className="flex flex-wrap items-end gap-2 [&>div:first-child]:flex-1" onSubmit={paste}>
          <Input title="Send text to the computer's clipboard" hiddenLabel name="text" placeholder="Text to paste into the computer (then Ctrl+V)" />
          <Button size="sm" type="submit" disabled={state !== "connected"}>Send to clipboard</Button>
        </form>
      )}
      <p role="alert" className="text-xs text-destructive empty:hidden">{error}</p>
    </div>
  );
}
