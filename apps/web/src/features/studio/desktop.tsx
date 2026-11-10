import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { Button, Input, Select } from "@/components/ui";

import { call, sendSealed } from "../chat/chat-client";

import { ConfirmButton } from "../shared/ui";
import {
  computerQueries,
  useLoadError,
  type ComputerDriver,
  type ComputerOsId,
  type Vm,
} from "./studio-queries";
import { VmDialog, vmError } from "./vm-viewer";

/** Your persistent computers: the default one plus any a bot asked for and you approved. Sign-ins made here stay until you delete it. */
export function VmPanel({ onError }: { onError: (m: string) => void }) {
  const qc = useQueryClient();
  const { data: vms, error } = useQuery(computerQueries.vms());
  const { data: caps } = useQuery(computerQueries.capabilities());
  const drivers = caps?.targets?.vm ?? [];
  /** Drivers installed for this computer's own desktop (agent-desktop, Cua). */
  const localDrivers = caps?.targets?.local ?? [];
  const driversFor = (target: string | undefined) => (target === "local" ? localDrivers : drivers);
  const systems = caps?.os ?? [];
  const creatable = systems.filter((o) => o.available);
  const remoteOffered = (caps?.targets?.cua?.length ?? 0) > 0;
  // This machine's own desktop: offered only when Zetta runs on it (a local install with agent-desktop).
  const hostOffered = (caps?.targets?.local?.length ?? 0) > 0;
  const vmOffered = drivers.length > 0;
  const [draft, setDraft] = useState<{
    name: string;
    driver: ComputerDriver;
    os: ComputerOsId;
    type: "vm" | "cua" | "local";
  }>({
    name: "",
    driver: "cua",
    os: "debian",
    type: "vm",
  });
  const remote = remoteOffered && draft.type === "cua";
  useLoadError(error, onError, vmError);
  const [open, setOpen] = useState<string>();
  const [busy, setBusy] = useState<{
    id: string;
    doing: "Starting" | "Stopping" | "Deleting" | "Creating" | "Switching";
  }>();
  const load = () => qc.invalidateQueries({ queryKey: computerQueries.vms().queryKey });
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
          epoch: 0,
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
              {vm.target === "local" ? (
                <span className="text-xs text-muted-foreground">
                  this computer
                  {localDrivers.length > 1 && ` · ${vm.driver === "cua" ? "Cua" : "agent-desktop"}`}
                </span>
              ) : vm.target === "cua" ? (
                <span className="break-all text-xs text-muted-foreground">
                  remote Cua · {vm.endpoint}
                </span>
              ) : (
                drivers.length > 1 && (
                  <span className="text-xs text-muted-foreground">
                    {vm.driver === "cua" ? "Cua" : "agent-desktop"}
                  </span>
                )
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
                {driversFor(vm.target).length > 1 &&
                  vm.target !== "cua" &&
                  vm.status !== "running" &&
                  vm.id !== "default" && (
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
                      options={driversFor(vm.target).map((d) => ({
                        value: d,
                        label: d === "cua" ? "Cua" : "agent-desktop",
                      }))}
                    />
                  )}
                {vm.status === "running" ? (
                  <>
                    {vm.target !== "cua" && (
                      <Button size="sm" variant="outline" onClick={() => setOpen(vm.id)}>
                        Open
                      </Button>
                    )}
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
                        if (r.vm.target !== "cua") setOpen(r.vm.id);
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
                    question={
                      vm.target === "cua"
                        ? `Delete ${vm.name}? Its saved token is revoked. Nothing on that machine changes.`
                        : `Delete ${vm.name}? Its sign-ins, downloads and files are destroyed.`
                    }
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
          // React clears `currentTarget` after the first await, so the form is kept here.
          const form = e.currentTarget;
          const name = draft.name.trim();
          if (!name) return;
          const f = new FormData(form);
          void run("new", "Creating", async () => {
            try {
              if (remote)
                // The token is sealed to the server's key before it leaves the page; it is never in a request body.
                await sendSealed(
                  "computer.create:cua",
                  { secret: String(f.get("token")) },
                  (sealed) =>
                    call("/api/computer/vms", "POST", {
                      name,
                      target: "cua",
                      endpoint: String(f.get("endpoint")).trim(),
                      sealed,
                    }),
                );
              else if (draft.type === "local")
                await call("/api/computer/vms", "POST", {
                  name,
                  target: "local",
                  ...(localDrivers.length > 1
                    ? {
                        driver: localDrivers.includes(draft.driver)
                          ? draft.driver
                          : localDrivers[0],
                      }
                    : {}),
                });
              else
                await call("/api/computer/vms", "POST", {
                  name,
                  driver: draft.driver,
                  ...(creatable.length > 1 ? { os: draft.os } : {}),
                });
              setDraft({ ...draft, name: "" });
            } finally {
              // The token field is always cleared, success or not.
              form.reset();
            }
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
        {(remoteOffered || hostOffered) && (
          <Select
            title="Type"
            required={false}
            value={draft.type}
            onChange={(e) => setDraft({ ...draft, type: e.target.value as "vm" | "cua" | "local" })}
            options={[
              ...(vmOffered ? [{ value: "vm", label: "Computer in a container" }] : []),
              ...(hostOffered
                ? [{ value: "local", label: "This computer (your own desktop and browser)" }]
                : []),
              ...(remoteOffered ? [{ value: "cua", label: "Remote Cua computer" }] : []),
            ]}
          />
        )}
        {draft.type === "local" && (
          <p className="text-xs text-muted-foreground">
            Bots act on your screen with your apps and your default browser, signed in as you are.
            macOS asks you to allow the app that runs Zetta under Privacy &amp; Security &gt;
            Accessibility (and Screen Recording for screenshots).
          </p>
        )}
        {remote && (
          <>
            <Input
              title="Address"
              name="endpoint"
              required
              maxLength={300}
              placeholder="https://mac.example.com:3211"
              inputMode="url"
              autoComplete="off"
              info="Where cua-spacesd listens. Must be https."
            />
            <Input
              title="Access token"
              name="token"
              type="password"
              required
              minLength={8}
              maxLength={8000}
              autoComplete="new-password"
              spellCheck={false}
              info="Stored encrypted and never shown again."
            />
          </>
        )}
        {!remote && creatable.length > 1 && (
          <Select
            title="System"
            required={false}
            value={draft.os}
            onChange={(e) => setDraft({ ...draft, os: e.target.value as ComputerOsId })}
            options={creatable.map((o) => ({ value: o.id, label: o.label }))}
          />
        )}
        {!remote && driversFor(draft.type).length > 1 && (
          <Select
            title="Driver"
            required={false}
            value={
              driversFor(draft.type).includes(draft.driver)
                ? draft.driver
                : driversFor(draft.type)[0]
            }
            onChange={(e) => setDraft({ ...draft, driver: e.target.value as ComputerDriver })}
            options={driversFor(draft.type).map((d) => ({
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
