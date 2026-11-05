import { useState } from "react";
import { CircleNotchIcon, MonitorIcon } from "@phosphor-icons/react";

import { Button } from "@/components/ui";

import { call, errorMessage } from "../chat/chat-client";
import { VmDialog, vmError } from "../studio/vm-viewer";

type Vm = { id: string; name: string; status: string };

/** Header icon for a bot with desktop access: starts the user's default computer when it is stopped, then opens its live console. */
export function DesktopButton({
  botName,
  onError,
}: {
  botName: string;
  onError: (message: string) => void;
}) {
  const [vmId, setVmId] = useState<string>();
  const [busy, setBusy] = useState(false);
  async function connect() {
    if (busy) return;
    setBusy(true);
    try {
      const { vms } = await call<{ vms: Vm[] }>("/api/computer/vms");
      const mine = vms.find((v) => v.name === "Default") ?? vms[0];
      setVmId(
        mine && mine.status === "running"
          ? mine.id
          : (await call<{ vm: Vm }>("/api/computer/vms/default/start", "POST")).vm.id,
      );
    } catch (e) {
      onError(vmError(e) || errorMessage(e));
    } finally {
      setBusy(false);
    }
  }
  return (
    <>
      <Button
        size="icon-sm"
        variant="ghost"
        aria-label={`Connect to ${botName}'s computer`}
        title="Connect to the computer"
        disabled={busy}
        onClick={() => void connect()}
      >
        {busy ? (
          <CircleNotchIcon className="animate-spin motion-reduce:animate-none" />
        ) : (
          <MonitorIcon />
        )}
      </Button>
      {vmId && <VmDialog vmId={vmId} botName={botName} onClose={() => setVmId(undefined)} />}
    </>
  );
}
