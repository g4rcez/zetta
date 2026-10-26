import { useState } from "react";
import { Monitor } from "lucide-react";

import { Button } from "@zetta/ui/components/button";

import { VmDialog } from "../studio/vm-viewer";

/** Shown on a bot's message as soon as it starts using one of your computers: open it to watch live, click along or take over. */
export function VmCard({ vm, botName, working }: { vm: { id: string; name: string }; botName?: string; working: boolean }) {
  const [open, setOpen] = useState(false);
  return (
    <div className="flex max-w-[760px] items-center gap-2 rounded-lg border bg-card p-2 text-sm">
      <Monitor aria-hidden="true" className="size-4 text-muted-foreground" />
      <span className="mr-auto truncate">{working ? "Using" : "Used"} the computer <strong>{vm.name}</strong>{working && <span className="ml-1 inline-block size-2 animate-pulse rounded-full bg-green-500 align-middle motion-reduce:animate-none" aria-hidden="true" />}</span>
      <Button size="sm" onClick={() => setOpen(true)}>Watch live</Button>
      {open && <VmDialog vmId={vm.id} botName={botName} onClose={() => setOpen(false)} />}
    </div>
  );
}
