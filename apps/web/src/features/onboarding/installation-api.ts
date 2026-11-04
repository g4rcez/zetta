import { queryOptions } from "@tanstack/react-query";

import { queryClient } from "@/lib/query-client";
import { call } from "../chat/chat-client";
import { STATIC } from "@/lib/query-policy";

export type NetworkMode = "local" | "network";
export type Installation = {
  networkMode: NetworkMode;
  publicUrl: string | null;
  onboarding: "pending" | "done";
  /** Builtin Laya decision model (plugin). On by default. */
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
  /** The answer is the saved installation: it replaces the cached one. */
  patch: (
    patch: Partial<
      Pick<Installation, "networkMode" | "publicUrl" | "onboarding" | "laya" | "layaLanguages">
    >,
  ) =>
    call<Installation>("/api/installation", "PATCH", patch).then((next) => {
      queryClient.setQueryData(installationQueries.get().queryKey, next);
      return next;
    }),
};

export const installationQueries = {
  get: () =>
    queryOptions({ queryKey: ["installation"], queryFn: () => installationApi.get(), ...STATIC }),
};
