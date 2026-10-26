import { useCallback, useEffect, useState, type FormEvent } from "react";
import { Button, Input } from "@/components/ui";

import { call } from "../chat/chat-client";

import { computerError } from "./computer";
import { ConfirmButton } from "../shared/ui";
import { VmViewer, vmError } from "./vm-viewer";

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
            <Input title="Type into the desktop" hiddenLabel name="text" placeholder="Type into the focused window" /><Button size="sm" type="submit">Type</Button>
            <Button size="sm" type="button" variant="outline" onClick={() => void act({ type: "key", key: "Return" })}>Enter</Button>
            <Button size="sm" type="button" variant="outline" onClick={() => void act({ type: "scroll", direction: "down" })}>Scroll down</Button>
          </form>
        </div>)}
    </section>
  );
}

type Vm = { id: string; name: string; kind: "default" | "extra"; purpose: string | null; createdByBotId: string | null; status: "stopped" | "running" | "failed"; control: "agent" | "human" };

/** Your persistent computers: the default one plus any a bot asked for and you approved. Sign-ins made here stay until you delete it. */
export function VmPanel({ onError }: { onError: (m: string) => void }) {
  const [vms, setVms] = useState<Vm[]>();
  const [open, setOpen] = useState<string>();
  const [busy, setBusy] = useState<{ id: string; doing: "Starting" | "Stopping" | "Deleting" }>();
  const load = useCallback(() => call<{ vms: Vm[] }>("/api/computer/vms").then((r) => setVms(r.vms), (e) => onError(vmError(e))), [onError]);
  useEffect(() => { void load(); }, [load]);
  const run = async (id: string, doing: "Starting" | "Stopping" | "Deleting", work: () => Promise<unknown>) => { setBusy({ id, doing }); try { await work(); } catch (e) { onError(vmError(e)); } finally { setBusy(undefined); await load(); } };
  const list = vms?.length ? vms : [{ id: "default", name: "Default", kind: "default", purpose: null, createdByBotId: null, status: "stopped", control: "agent" } satisfies Vm];
  return (
    <section aria-label="Computers" className="space-y-3 rounded-lg border bg-card p-4">
      <h2 className="text-sm font-medium">Computers</h2>
      <p className="text-xs text-muted-foreground">Private Linux computers with Chromium, kept between sessions. To let a bot use an account that has no integration: start the computer, Take over, sign in to the site in Chromium, then Hand back. Bots with Browser + desktop turned on use the default computer and can ask you for more.</p>
      <ul className="divide-y rounded-lg border">{list.map((vm) => (
        <li key={vm.id} className="space-y-2 px-3 py-2 text-sm">
          <div className="flex flex-wrap items-center gap-2">
            <strong>{vm.name}</strong>{vm.kind === "default" && <span className="text-xs text-muted-foreground">default</span>}
            <span className="text-xs text-muted-foreground">{vm.status === "running" ? "running" : vm.status === "failed" ? "failed to start" : "stopped"}</span>
            {vm.purpose && <span className="truncate text-xs text-muted-foreground">· {vm.purpose}</span>}
            <span className="ml-auto flex gap-1">
              {vm.status === "running"
                ? <><Button size="sm" variant="outline" onClick={() => setOpen(open === vm.id ? undefined : vm.id)}>{open === vm.id ? "Hide" : "Open"}</Button>
                    <Button size="sm" variant="outline" disabled={busy?.id === vm.id} onClick={() => void run(vm.id, "Stopping", () => call(`/api/computer/vms/${vm.id}/stop`, "POST").then(() => setOpen(undefined)))}>Stop</Button></>
                : <Button size="sm" disabled={busy?.id === vm.id} onClick={() => void run(vm.id, "Starting", async () => { const r = await call<{ vm: Vm }>(vm.id === "default" ? "/api/computer/vms/default/start" : `/api/computer/vms/${vm.id}/start`, "POST"); setOpen(r.vm.id); })}>{busy?.id === vm.id ? (busy.doing === "Starting" ? "Starting… (the first start can take a minute)" : `${busy.doing}…`) : "Start"}</Button>}
              {vm.id !== "default" && <ConfirmButton label="Delete" question={`Delete ${vm.name}? Its sign-ins, downloads and files are destroyed.`} confirmLabel="Delete" onConfirm={() => run(vm.id, "Deleting", () => call(`/api/computer/vms/${vm.id}`, "DELETE").then(() => setOpen(undefined)))} />}
            </span>
          </div>
          {open === vm.id && vm.status === "running" && <VmViewer vmId={vm.id} onStopped={() => void load()} />}
        </li>))}</ul>
    </section>
  );
}
