import { queryOptions } from "@tanstack/react-query";
import { useEffect } from "react";

import { call, chatClient, errorMessage } from "../chat/chat-client";
import { STATIC } from "@/lib/query-policy";

/** Shows a failed load once per error, through the page's own error handler. */
export function useLoadError(
  error: unknown,
  onError: (message: string) => void,
  format: (e: unknown) => string = errorMessage,
) {
  useEffect(() => {
    if (error) onError(format(error));
    // `onError` is usually an inline function; the message only matters when the error changes.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [error]);
}

/** What drives a computer: cua (the default) or agent-desktop. The operator decides which are offered (ZETTA_VM_DRIVERS). */
export type ComputerDriver = "cua" | "agent-desktop";
/** The system a container computer runs. */
export type ComputerOsId = "debian" | "ubuntu";
/** One entry of the list a person picks from: every system, with whether it can be created and why not. */
export type ComputerOsOption = {
  id: string;
  family: "linux" | "windows" | "macos";
  label: string;
  browser: boolean;
  available: boolean;
  note?: string;
};
export type Vm = {
  id: string;
  name: string;
  kind: "default" | "extra";
  /** "cua" is a computer on another machine that runs cua-spacesd; it has no container and no VNC view here. */
  target: "vm" | "local" | "cua";
  /** Where a remote computer listens (https address, no secret). */
  endpoint?: string | null;
  driver: ComputerDriver;
  os: ComputerOsId;
  purpose: string | null;
  createdByBotId: string | null;
  status: "stopped" | "running" | "failed";
  control: "agent" | "human";
  epoch: number;
  keyboard?: string;
};
/** A remote machine a bot reaches through the server. The key or password is stored encrypted and never comes back. */
export type MachineKind = "ssh" | "sftp" | "ftp";
export type Machine = {
  id: string;
  name: string;
  kind: MachineKind;
  host: string;
  port: number;
  username: string;
  /** SHA256 fingerprint of the pinned host key (ssh, sftp). */
  fingerprint: string | null;
  /** The bots that may use this machine. None means no bot can. */
  botIds: string[];
  createdAt: string;
};
export type HostKeyCandidate = { key: string; type: string; fingerprint: string };
export type ComputerSession = { profile: string; control: "agent" | "human"; url: string };
export type ComputerProfile = { name: string; mode: "dedicated" | "shared"; revoked: boolean };
export type ComputerCapabilities = {
  browser: boolean;
  desktop: boolean;
  desktopBackend?: string | null;
  /** Drivers offered per kind of computer. */
  targets?: { vm: ComputerDriver[]; local: ComputerDriver[]; cua?: ComputerDriver[] };
  os?: ComputerOsOption[];
  note?: string;
};

/** Keys nest under `["computer"]`: invalidate the prefix after a write. */
export const computerQueries = {
  vms: () =>
    queryOptions({
      queryKey: ["computer", "vms"],
      queryFn: () => call<{ vms: Vm[] }>("/api/computer/vms").then((r) => r.vms),
    }),
  machines: () =>
    queryOptions({
      queryKey: ["computer", "machines"],
      queryFn: () =>
        call<{ machines: Machine[] }>("/api/computer/machines").then((r) => r.machines),
    }),
  sessions: () =>
    queryOptions({
      queryKey: ["computer", "sessions"],
      queryFn: () =>
        call<{ sessions: ComputerSession[] }>("/api/computer/sessions").then((r) => r.sessions),
    }),
  profiles: () =>
    queryOptions({
      queryKey: ["computer", "profiles"],
      queryFn: () =>
        call<{ profiles: ComputerProfile[] }>("/api/computer/profiles").then((r) => r.profiles),
    }),
  capabilities: () =>
    queryOptions({
      queryKey: ["computer", "capabilities"],
      queryFn: () => call<ComputerCapabilities>("/api/computer/capabilities"),
    }),
};

export const connectionsQueries = {
  list: () =>
    queryOptions({ queryKey: ["connections"], queryFn: () => chatClient.connections(), ...STATIC }),
};

export type Harness = {
  harness: string;
  label: string;
  installed: boolean;
  version?: string | null;
  status: "ready" | "not_installed" | "needs_login" | "unverified";
  perUserLogin: boolean;
  guidance?: string;
};
export const harnessQueries = {
  list: () =>
    queryOptions({
      queryKey: ["harnesses"],
      queryFn: () => call<{ harnesses: Harness[] }>("/api/harnesses").then((r) => r.harnesses),
    }),
};

export const DECISIONS_STATUS = ["decisions", "status"];
/** The Laya model loads in the background. Callers that wait for it add `refetchInterval`. */
export const decisionsQueries = {
  status: () =>
    queryOptions({
      queryKey: DECISIONS_STATUS,
      queryFn: () => call<{ state: string; variant?: string }>("/api/decisions/status"),
    }),
};
