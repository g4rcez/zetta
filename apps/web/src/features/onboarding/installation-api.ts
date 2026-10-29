import { call } from "../chat/chat-client";

export type NetworkMode = "local" | "network";
export type Installation = {
  networkMode: NetworkMode;
  publicUrl: string | null;
  onboarding: "pending" | "done";
  /** The saved network mode differs from the one the server booted with. */
  restartRequired: boolean;
};

export const installationApi = {
  get: () => call<Installation>("/api/installation"),
  patch: (patch: Partial<Pick<Installation, "networkMode" | "publicUrl" | "onboarding">>) =>
    call<Installation>("/api/installation", "PATCH", patch),
};
