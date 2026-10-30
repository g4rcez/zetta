import { useCallback, useEffect, useRef, useState, type FormEvent } from "react";
import {
  ArrowUpIcon,
  CheckIcon,
  ArrowSquareOutIcon,
  HandIcon,
  MonitorIcon,
  XIcon,
} from "@phosphor-icons/react";
import { Button, Input, Select } from "@/components/ui";

import { ENV } from "../../env";
import { ApiError, call, errorMessage } from "../chat/chat-client";

export type VmControl = { id: string; control: "agent" | "human"; epoch: number };
type VmInfo = VmControl & { name: string; status: string; keyboard?: string };
type Rfb = InstanceType<typeof import("@novnc/novnc").default>;

/** setxkbmap layouts the server accepts (KEYBOARD_LAYOUTS in apps/server/src/modules/computer/vm.ts). */
const KEYBOARDS = [
  { value: "us", label: "English (US)" },
  { value: "us:intl", label: "English (US, international)" },
  { value: "gb", label: "English (UK)" },
  { value: "br", label: "Português (Brasil)" },
  { value: "pt", label: "Português (Portugal)" },
  { value: "es", label: "Español" },
  { value: "latam", label: "Español (Latinoamérica)" },
  { value: "de", label: "Deutsch" },
  { value: "fr", label: "Français" },
  { value: "it", label: "Italiano" },
];

/** Friendly wording for VM errors; NOT_FOUND on a screenshot just means the computer is stopped. */
export function vmError(e: unknown): string {
  if (e instanceof ApiError) {
    if (e.code === "LIMIT")
      return "Too many computers are running. Stop one in Studio > Computer first.";
    if (e.code === "STALE_CONTROL")
      return "Control changed while you were clicking, so nothing happened. Try again.";
    if (e.code === "BLOCKED_URL") return "That address is not allowed.";
  }
  return errorMessage(e);
}

export const openVmWindow = (vmId: string) =>
  window.open(`/computer/${vmId}`, `zetta-computer-${vmId}`, "popup,width=1320,height=900");

/**
 * Live VNC console for one of the user's computers, shared with the bots: the real screen, mouse and keyboard (click into it to type).
 * The server hands out a one-time ticket and bridges the WebSocket to the VM's VNC server; the VNC password never reaches the browser.
 * Take over pauses the bots (for sign-ins); Hand back lets them continue. `botName` names who is waiting (from a chat card).
 */
export function VmConsole({
  vmId,
  botName,
  onClose,
  popout = true,
}: {
  vmId: string;
  botName?: string;
  onClose?: () => void;
  popout?: boolean;
}) {
  const base = `/api/computer/vms/${vmId}`;
  const screen = useRef<HTMLDivElement>(null);
  const rfb = useRef<Rfb>(undefined);
  const [state, setState] = useState<"connecting" | "connected" | "disconnected" | "stopped">(
    "connecting",
  );
  const [attempt, setAttempt] = useState(0);
  const [info, setInfo] = useState<VmInfo>();
  const [error, setError] = useState<string>();
  const control = info?.control ?? "agent";

  useEffect(() => {
    let cancelled = false;
    setState("connecting");
    (async () => {
      try {
        const [{ default: RFB }, { ticket }] = await Promise.all([
          import("@novnc/novnc"),
          call<{ ticket: string }>(`${base}/vnc-ticket`, "POST"),
        ]);
        if (cancelled || !screen.current) return;
        const url = new URL(`${base}/vnc`, ENV.VITE_SERVER_URL);
        url.protocol = url.protocol === "https:" ? "wss:" : "ws:";
        url.searchParams.set("ticket", ticket);
        const r = new RFB(screen.current, url.toString(), { shared: true });
        r.scaleViewport = true;
        r.resizeSession = false;
        r.focusOnClick = true;
        r.background = "transparent";
        r.addEventListener("connect", () => {
          setState("connected");
          setError(undefined);
          r.focus();
        });
        r.addEventListener("disconnect", () => {
          if (rfb.current === r) {
            rfb.current = undefined;
            setState("disconnected");
          }
        });
        r.addEventListener("securityfailure", () =>
          setError("The computer refused the connection."),
        );
        rfb.current = r;
      } catch (e) {
        if (cancelled) return;
        if (e instanceof ApiError && e.code === "NOT_FOUND") setState("stopped");
        else {
          setState("disconnected");
          setError(vmError(e));
        }
      }
    })();
    return () => {
      cancelled = true;
      const r = rfb.current;
      rfb.current = undefined;
      r?.disconnect();
    };
  }, [base, attempt]);
  useEffect(() => {
    call<{ vms: VmInfo[] }>("/api/computer/vms").then(
      (r) => setInfo(r.vms.find((x) => x.id === vmId)),
      () => {},
    );
  }, [vmId, attempt]);

  const reconnect = useCallback(() => setAttempt((n) => n + 1), []);
  const toggle = () =>
    call<{ vm: VmControl }>(`${base}/takeover`, "POST", {
      human: control !== "human",
      expected: control,
    }).then(
      (r) => {
        setInfo((i) => i && { ...i, ...r.vm });
        rfb.current?.focus();
      },
      (e) => setError(vmError(e)),
    );
  const start = () => call(`${base}/start`, "POST").then(reconnect, (e) => setError(vmError(e)));
  const keyboard = (layout: string) =>
    call<{ keyboard: string }>(`${base}/keyboard`, "POST", { layout }).then(
      (r) => {
        setInfo((i) => i && { ...i, keyboard: r.keyboard });
        rfb.current?.focus();
      },
      (e) => setError(vmError(e)),
    );
  const paste = (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const form = e.currentTarget,
      text = String(new FormData(form).get("text") ?? "");
    if (!text) return;
    // Typed into the focused window on the computer, so it lands where the cursor is (a terminal, a page, a sign-in field).
    void call(`${base}/paste`, "POST", { text }).then(
      () => {
        form.reset();
        rfb.current?.focus();
      },
      (err) => setError(vmError(err)),
    );
  };

  const who = botName ?? "Bots";
  const title = info
    ? info.name === "Default"
      ? botName
        ? `${botName}'s computer`
        : "Your computer"
      : info.name
    : "Computer";
  const status =
    state === "stopped"
      ? "Stopped"
      : state === "connecting"
        ? "Connecting to the screen…"
        : state === "disconnected"
          ? "Disconnected from the screen"
          : control === "human"
            ? `You're in control · ${botName ?? "bots"} ${botName ? "waits" : "wait"}`
            : `${who} can use it · take over to type or sign in`;

  return (
    <div className="flex h-full min-h-0 flex-col gap-3">
      <header className="flex items-center gap-3">
        <span
          className="grid size-10 shrink-0 place-items-center rounded-full bg-success/15 text-success"
          aria-hidden="true"
        >
          <MonitorIcon className="size-5" />
        </span>
        <div className="min-w-0 mr-auto">
          <h2 className="truncate text-lg font-semibold leading-tight">{title}</h2>
          <p role="status" className="truncate text-sm text-muted-foreground">
            {status}
          </p>
        </div>
        {state === "disconnected" && (
          <Button size="sm" variant="outline" onClick={reconnect}>
            Reconnect
          </Button>
        )}
        {state !== "stopped" && (
          <Button size="sm" onClick={() => void toggle()} aria-pressed={control === "human"}>
            {control === "human" ? (
              <>
                <CheckIcon aria-hidden="true" className="size-4" />
                Hand back
              </>
            ) : (
              <>
                <HandIcon aria-hidden="true" className="size-4" />
                Take over
              </>
            )}
          </Button>
        )}
        {popout && (
          <Button
            size="icon-sm"
            variant="ghost"
            title="Open in a new window"
            aria-label="Open in a new window"
            onClick={() => {
              openVmWindow(vmId);
              onClose?.();
            }}
          >
            <ArrowSquareOutIcon className="size-4" />
          </Button>
        )}
        {onClose && (
          <Button size="icon-sm" variant="ghost" title="Close" aria-label="Close" onClick={onClose}>
            <XIcon className="size-4" />
          </Button>
        )}
      </header>
      <div
        className={`h-0.5 w-full rounded-full ${control === "human" ? "bg-success/60" : "bg-border"}`}
        aria-hidden="true"
      />

      <div className="relative min-h-0 flex-1 rounded-xl bg-muted/60 p-3">
        <div
          ref={screen}
          aria-label="Computer screen"
          className="size-full overflow-hidden rounded-lg"
        />
        {state === "stopped" && (
          <div className="absolute inset-0 grid place-items-center">
            <div className="flex flex-col items-center gap-2 text-sm text-muted-foreground">
              This computer is stopped.
              <Button size="sm" onClick={() => void start()}>
                Start it
              </Button>
            </div>
          </div>
        )}
      </div>

      <form
        className="flex items-center gap-2 rounded-xl border bg-card px-3 py-1.5 [&>:first-child]:flex-1"
        onSubmit={paste}
      >
        <Input
          title="Paste text on the computer"
          hiddenLabel
          name="text"
          autoComplete="off"
          placeholder="Paste text on the computer"
          disabled={state !== "connected"}
          className="border-0 shadow-none"
        />
        <Button
          size="icon-sm"
          variant="ghost"
          type="submit"
          title="Paste"
          aria-label="Paste"
          disabled={state !== "connected"}
        >
          <ArrowUpIcon className="size-4" />
        </Button>
      </form>
      <div className="flex flex-wrap items-center gap-3 text-sm text-muted-foreground">
        <div className="w-56">
          <Select
            title="Keyboard layout"
            hiddenLabel
            required={false}
            value={info?.keyboard ?? "us"}
            disabled={state !== "connected"}
            onChange={(e) => void keyboard(e.target.value)}
            options={KEYBOARDS}
          />
        </div>
        <span className="min-w-0 flex-1">
          {control === "human"
            ? "While you're in control, programs on this computer can see the screen and what you type."
            : `${who} see${botName ? "s" : ""} this same screen. Take over before typing a password.`}
        </span>
      </div>
      <p role="alert" className="text-sm text-destructive empty:hidden">
        {error}
      </p>
    </div>
  );
}

/** The console in a modal dialog (Studio's computers list, a bot's chat card). Escape typed into the screen goes to the computer. */
export function VmDialog({
  vmId,
  botName,
  onClose,
}: {
  vmId: string;
  botName?: string;
  onClose: () => void;
}) {
  const ref = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    const d = ref.current;
    if (d && !d.open) d.showModal();
  }, []);
  return (
    <dialog
      ref={ref}
      onClose={onClose}
      aria-label="Computer"
      className="m-auto h-[min(920px,94vh)] w-[min(1440px,96vw)] max-w-none rounded-2xl border bg-background p-5 text-foreground shadow-2xl backdrop:bg-black/50"
    >
      <VmConsole vmId={vmId} botName={botName} onClose={() => ref.current?.close()} />
    </dialog>
  );
}
