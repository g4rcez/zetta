import { useEffect, useRef, useState } from "react";
import { Loader2, Monitor } from "lucide-react";

import { Button } from "@zetta/ui/components/button";

import { call } from "./chat-client";
import type { ComputerStep } from "./chat-rows";
import { VmDialog } from "../studio/vm-viewer";

/** How often the inline preview refreshes while the bot works; polls never stack behind a slow one. */
const PREVIEW_MS = 1500;

/** A small, view-only picture of the VM's screen, refreshed while `active`. Clicking it opens the full console. */
function LivePreview({
  vmId,
  active,
  onOpen,
}: {
  vmId: string;
  active: boolean;
  onOpen: () => void;
}) {
  const [png, setPng] = useState<string>();
  const busy = useRef(false);
  useEffect(() => {
    if (!active) return;
    let stop = false;
    const shot = async () => {
      if (busy.current || document.hidden) return;
      busy.current = true;
      try {
        const r = await call<{ png: string }>(
          `/api/computer/vms/${encodeURIComponent(vmId)}/screenshot`,
        );
        if (!stop) setPng(r.png);
      } catch {
        /* booting or reconnecting: keep the last frame */
      } finally {
        busy.current = false;
      }
    };
    void shot();
    const t = setInterval(() => void shot(), PREVIEW_MS);
    return () => {
      stop = true;
      clearInterval(t);
    };
  }, [vmId, active]);
  return (
    <button
      type="button"
      onClick={onOpen}
      aria-label="Open the computer to watch live"
      className="relative block aspect-[16/10] w-full overflow-hidden rounded-md border bg-muted sm:w-72"
    >
      {png ? (
        <img
          alt="Live view of the computer"
          src={`data:image/png;base64,${png}`}
          className="size-full object-cover object-top"
        />
      ) : (
        <span className="flex size-full items-center justify-center text-xs text-muted-foreground">
          <Loader2
            aria-hidden="true"
            className="mr-1.5 size-3.5 animate-spin motion-reduce:animate-none"
          />
          Starting the computer…
        </span>
      )}
      {active && (
        <span className="absolute left-1.5 top-1.5 flex items-center gap-1 rounded bg-black/60 px-1.5 py-0.5 text-[10px] font-medium uppercase tracking-wide text-white">
          <span
            aria-hidden="true"
            className="size-1.5 animate-pulse rounded-full bg-red-500 motion-reduce:animate-none"
          />
          Live
        </span>
      )}
    </button>
  );
}

/**
 * Shown on a bot's message as soon as it starts using one of your computers. While it works: a live preview of the screen and the
 * steps it takes, newest first. Open it to watch full size, click along or take over.
 */
export function VmCard({
  vm,
  botName,
  working,
  steps = [],
}: {
  vm: { id: string; name: string };
  botName?: string;
  working: boolean;
  steps?: ComputerStep[];
}) {
  const [open, setOpen] = useState(false);
  const recent = steps.slice(-5).reverse();
  return (
    <div
      className={
        working
          ? "flex max-w-[760px] flex-col gap-2 rounded-lg border bg-card p-2 text-sm"
          : "flex max-w-[760px] flex-col gap-2 text-xs text-muted-foreground"
      }
    >
      <div className="flex items-center gap-2">
        <Monitor aria-hidden="true" className="size-4 shrink-0 text-muted-foreground" />
        <span className="mr-auto truncate">
          {working ? "Using" : "Used"} the computer <strong className={working ? undefined : "font-medium text-foreground"}>{vm.name}</strong>
          {working && (
            <span
              className="ml-1 inline-block size-2 animate-pulse rounded-full bg-green-500 align-middle motion-reduce:animate-none"
              aria-hidden="true"
            />
          )}
          {!working && steps.length > 0 && (
            <span className="text-muted-foreground">
              {" "}
              · {steps.length} {steps.length === 1 ? "step" : "steps"}
            </span>
          )}
        </span>
        <Button
          size={working ? "sm" : "xs"}
          variant={working ? "default" : "ghost"}
          onClick={() => setOpen(true)}
        >
          {working ? "Watch live" : "Watch"}
        </Button>
      </div>
      {working && (
        <div className="flex flex-col gap-2 sm:flex-row">
          <LivePreview vmId={vm.id} active={working && !open} onOpen={() => setOpen(true)} />
          <ol
            aria-label={`What ${botName ?? "the bot"} is doing`}
            aria-live="polite"
            className="min-w-0 flex-1 space-y-1 text-xs"
          >
            {recent.length === 0 && (
              <li className="text-muted-foreground">Getting the computer ready…</li>
            )}
            {recent.map((s, i) => (
              <li
                key={`${s.at}:${i}`}
                className={
                  i === 0
                    ? "flex items-center gap-1.5 font-medium"
                    : "flex items-center gap-1.5 pl-5 text-muted-foreground"
                }
              >
                {i === 0 && (
                  <Loader2
                    aria-hidden="true"
                    className="size-3.5 shrink-0 animate-spin motion-reduce:animate-none"
                  />
                )}
                <span className="truncate" title={s.step}>
                  {s.step}
                </span>
              </li>
            ))}
          </ol>
        </div>
      )}
      {open && <VmDialog vmId={vm.id} botName={botName} onClose={() => setOpen(false)} />}
    </div>
  );
}
