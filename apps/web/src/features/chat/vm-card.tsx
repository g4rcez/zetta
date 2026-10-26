import { useState } from "react";
import { Monitor } from "lucide-react";

import { Button } from "@zetta/ui/components/button";

import { VmViewer } from "../studio/vm-viewer";

/** Shown on a bot's message as soon as it starts using one of your computers: open it to watch live and click along. */
export function VmCard({ vm, working }: { vm: { id: string; name: string }; working: boolean }) {
  const [open, setOpen] = useState(false);
  return (
    <div className="max-w-[760px] space-y-2 rounded-lg border bg-card p-2 text-sm">
      <div className="flex items-center gap-2">
        <Monitor aria-hidden="true" className="size-4 text-muted-foreground" />
        <span className="mr-auto truncate">{working ? "Using" : "Used"} the computer <strong>{vm.name}</strong>{working && <span className="ml-1 inline-block size-2 animate-pulse rounded-full bg-green-500 align-middle motion-reduce:animate-none" aria-hidden="true" />}</span>
        <Button size="sm" variant={open ? "outline" : "default"} aria-expanded={open} onClick={() => setOpen((o) => !o)}>{open ? "Hide" : "Watch live"}</Button>
      </div>
      {open && <VmViewer vmId={vm.id} compact />}
    </div>
  );
}
