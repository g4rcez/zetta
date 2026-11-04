import { useCallback, useEffect, useState } from "react";
import { Button, Input, Select } from "@/components/ui";

import { call } from "../chat/chat-client";

import { ConfirmButton } from "../shared/ui";
import { VmDialog, vmError } from "./vm-viewer";

/** What drives a computer: cua (the default) or agent-desktop. The operator decides which are offered (ZETTA_VM_DRIVERS). */
type ComputerDriver = "cua" | "agent-desktop";
/** The system a container computer runs. */
type ComputerOsId = "debian" | "ubuntu";
/** One entry of the list a person picks from: every system, with whether it can be created and why not. */
type ComputerOsOption = {
  id: string;
  family: "linux" | "windows" | "macos";
  label: string;
  browser: boolean;
  available: boolean;
  note?: string;
};
type Capabilities = {
  targets?: { vm: ComputerDriver[]; local: ComputerDriver[] };
  os?: ComputerOsOption[];
};
type Vm = {
  id: string;
  name: string;
  kind: "default" | "extra";
  target: "vm" | "local";
  driver: ComputerDriver;
  os: ComputerOsId;
  purpose: string | null;
  createdByBotId: string | null;
  status: "stopped" | "running" | "failed";
  control: "agent" | "human";
};

/** Your persistent computers: the default one plus any a bot asked for and you approved. Sign-ins made here stay until you delete it. */
export function VmPanel({ onError }: { onError: (m: string) => void }) {
  const [vms, setVms] = useState<Vm[]>();
  const [caps, setCaps] = useState<Capabilities>();
  const drivers = caps?.targets?.vm ?? [];
  const systems = caps?.os ?? [];
  const creatable = systems.filter((o) => o.available);
  const [draft, setDraft] = useState<{ name: string; driver: ComputerDriver; os: ComputerOsId }>({
    name: "",
    driver: "cua",
    os: "debian",
  });
  const [open, setOpen] = useState<string>();
  const [busy, setBusy] = useState<{
    id: string;
    doing: "Starting" | "Stopping" | "Deleting" | "Creating" | "Switching";
  }>();
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
  useEffect(() => {
    // Without the capabilities the panel simply offers no choice of driver or system.
    call<Capabilities>("/api/computer/capabilities").then(setCaps, () => undefined);
  }, []);
  const run = async (
    id: string,
    doing: "Starting" | "Stopping" | "Deleting" | "Creating" | "Switching",
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
          target: "vm",
          driver: "cua",
          os: "debian",
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
              {creatable.length > 1 && (
                <span className="text-xs text-muted-foreground">
                  {systems.find((o) => o.id === vm.os)?.label ?? vm.os}
                </span>
              )}
              {drivers.length > 1 && (
                <span className="text-xs text-muted-foreground">
                  {vm.driver === "cua" ? "Cua" : "agent-desktop"}
                </span>
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
              <span className="ml-auto flex items-center gap-1">
                {drivers.length > 1 && vm.status !== "running" && vm.id !== "default" && (
                  <Select
                    title={`Driver for ${vm.name}`}
                    hiddenLabel
                    required={false}
                    value={vm.driver}
                    disabled={busy?.id === vm.id}
                    onChange={(e) =>
                      void run(vm.id, "Switching", () =>
                        call(`/api/computer/vms/${vm.id}`, "PATCH", { driver: e.target.value }),
                      )
                    }
                    options={drivers.map((d) => ({
                      value: d,
                      label: d === "cua" ? "Cua" : "agent-desktop",
                    }))}
                  />
                )}
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
      <form
        className="flex flex-wrap items-end gap-2"
        onSubmit={(e) => {
          e.preventDefault();
          const name = draft.name.trim();
          if (!name) return;
          void run("new", "Creating", async () => {
            await call("/api/computer/vms", "POST", {
              name,
              driver: draft.driver,
              ...(creatable.length > 1 ? { os: draft.os } : {}),
            });
            setDraft({ ...draft, name: "" });
          });
        }}
      >
        <Input
          title="New computer"
          placeholder="Name, e.g. Bank"
          value={draft.name}
          maxLength={60}
          required={false}
          onChange={(e) => setDraft({ ...draft, name: e.target.value })}
        />
        {creatable.length > 1 && (
          <Select
            title="System"
            required={false}
            value={draft.os}
            onChange={(e) => setDraft({ ...draft, os: e.target.value as ComputerOsId })}
            options={creatable.map((o) => ({ value: o.id, label: o.label }))}
          />
        )}
        {drivers.length > 1 && (
          <Select
            title="Driver"
            required={false}
            value={draft.driver}
            onChange={(e) => setDraft({ ...draft, driver: e.target.value as ComputerDriver })}
            options={drivers.map((d) => ({
              value: d,
              label: d === "cua" ? "Cua" : "agent-desktop",
            }))}
          />
        )}
        <Button
          type="submit"
          size="sm"
          variant="outline"
          disabled={busy?.id === "new" || !draft.name.trim()}
        >
          {busy?.id === "new" ? "Creating…" : "Create"}
        </Button>
      </form>
      {systems.some((o) => !o.available) && (
        <ul className="space-y-0.5 text-xs text-muted-foreground">
          {systems
            .filter((o) => !o.available)
            .map((o) => (
              <li key={o.id}>
                <strong>{o.label}</strong>: {o.note}
              </li>
            ))}
        </ul>
      )}
    </section>
  );
}
