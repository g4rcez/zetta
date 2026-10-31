import { useCallback, useEffect, useState } from "react";
import { Button } from "@/components/ui";

import { call } from "../chat/chat-client";

import { ConfirmButton } from "../shared/ui";
import { VmDialog, vmError } from "./vm-viewer";

type Vm = {
  id: string;
  name: string;
  kind: "default" | "extra";
  purpose: string | null;
  createdByBotId: string | null;
  status: "stopped" | "running" | "failed";
  control: "agent" | "human";
};

/** Your persistent computers: the default one plus any a bot asked for and you approved. Sign-ins made here stay until you delete it. */
export function VmPanel({ onError }: { onError: (m: string) => void }) {
  const [vms, setVms] = useState<Vm[]>();
  const [open, setOpen] = useState<string>();
  const [busy, setBusy] = useState<{ id: string; doing: "Starting" | "Stopping" | "Deleting" }>();
  const load = useCallback(
    () =>
      call<{ vms: Vm[] }>("/api/computer/vms").then(
        (r) => setVms(r.vms),
        (e) => onError(vmError(e)),
      ),
    [onError],
  );
  useEffect(() => {
    void load();
  }, [load]);
  const run = async (
    id: string,
    doing: "Starting" | "Stopping" | "Deleting",
    work: () => Promise<unknown>,
  ) => {
    setBusy({ id, doing });
    try {
      await work();
    } catch (e) {
      onError(vmError(e));
    } finally {
      setBusy(undefined);
      await load();
    }
  };
  const list = vms?.length
    ? vms
    : [
        {
          id: "default",
          name: "Default",
          kind: "default",
          purpose: null,
          createdByBotId: null,
          status: "stopped",
          control: "agent",
        } satisfies Vm,
      ];
  return (
    <section aria-label="Computers" className="space-y-3 rounded-lg border bg-card p-4">
      <h2 className="text-sm font-medium">Computers</h2>
      <p className="text-xs text-muted-foreground">
        Private Linux computers with Chromium, kept between sessions. To let a bot use an account
        that has no integration: start the computer, Take over, sign in to the site in Chromium,
        then Hand back. Bots with Browser + desktop turned on use the default computer and can ask
        you for more.
      </p>
      <ul className="divide-y rounded-lg border">
        {list.map((vm) => (
          <li key={vm.id} className="space-y-2 px-3 py-2 text-sm">
            <div className="flex flex-wrap items-center gap-2">
              <strong>{vm.name}</strong>
              {vm.kind === "default" && (
                <span className="text-xs text-muted-foreground">default</span>
              )}
              <span className="text-xs text-muted-foreground">
                {vm.status === "running"
                  ? "running"
                  : vm.status === "failed"
                    ? "failed to start"
                    : "stopped"}
              </span>
              {vm.purpose && (
                <span className="truncate text-xs text-muted-foreground">· {vm.purpose}</span>
              )}
              <span className="ml-auto flex gap-1">
                {vm.status === "running" ? (
                  <>
                    <Button size="sm" variant="outline" onClick={() => setOpen(vm.id)}>
                      Open
                    </Button>
                    <Button
                      size="sm"
                      variant="outline"
                      disabled={busy?.id === vm.id}
                      onClick={() =>
                        void run(vm.id, "Stopping", () =>
                          call(`/api/computer/vms/${vm.id}/stop`, "POST").then(() =>
                            setOpen(undefined),
                          ),
                        )
                      }
                    >
                      Stop
                    </Button>
                  </>
                ) : (
                  <Button
                    size="sm"
                    disabled={busy?.id === vm.id}
                    onClick={() =>
                      void run(vm.id, "Starting", async () => {
                        const r = await call<{ vm: Vm }>(
                          vm.id === "default"
                            ? "/api/computer/vms/default/start"
                            : `/api/computer/vms/${vm.id}/start`,
                          "POST",
                        );
                        setOpen(r.vm.id);
                      })
                    }
                  >
                    {busy?.id === vm.id
                      ? busy.doing === "Starting"
                        ? "Starting… (the first start can take a minute)"
                        : `${busy.doing}…`
                      : "Start"}
                  </Button>
                )}
                {vm.id !== "default" && (
                  <ConfirmButton
                    label="Delete"
                    question={`Delete ${vm.name}? Its sign-ins, downloads and files are destroyed.`}
                    confirmLabel="Delete"
                    onConfirm={() =>
                      run(vm.id, "Deleting", () =>
                        call(`/api/computer/vms/${vm.id}`, "DELETE").then(() => setOpen(undefined)),
                      )
                    }
                  />
                )}
              </span>
            </div>
            {open === vm.id && (
              <VmDialog
                vmId={vm.id}
                onClose={() => {
                  setOpen(undefined);
                  void load();
                }}
              />
            )}
          </li>
        ))}
      </ul>
    </section>
  );
}
