import { call } from "../chat/chat-client";

export type NetworkMode = "local" | "network";
export type Installation = {
  networkMode: NetworkMode;
  publicUrl: string | null;
  onboarding: "pending" | "done";
  /** Builtin Laya decision model (plugin). Off by default. */
  laya: "on" | "off";
  /** BCP-47 tags the Laya model must understand ("en" is always first). */
  layaLanguages: string[];
  /** The model those languages select: English only, or the multilingual one. */
  layaModel: "english" | "multilingual";
  /** The saved network mode differs from the one the server booted with. */
  restartRequired: boolean;
};

export const installationApi = {
  get: () => call<Installation>("/api/installation"),
  patch: (
    patch: Partial<
      Pick<Installation, "networkMode" | "publicUrl" | "onboarding" | "laya" | "layaLanguages">
    >,
  ) => call<Installation>("/api/installation", "PATCH", patch),
};
