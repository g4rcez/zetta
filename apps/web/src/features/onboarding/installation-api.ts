import { queryOptions } from "@tanstack/react-query";

import { queryClient } from "@/lib/query-client";
import { call, sendSealed } from "../chat/chat-client";
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
  /** Whether the server checks once a day if a newer version is published. `off` sends nothing anywhere. */
  updateCheck?: "on" | "off";
  /** The saved network mode differs from the one the server booted with. */
  restartRequired: boolean;
  /** Speech to text: the server's own model, OpenAI, or any server that speaks OpenAI's transcription API. */
  transcribeProvider: TranscribeProvider;
  transcribeModel: string;
  /** Two-letter code; empty means the language of the person's browser. */
  transcribeLanguage: string;
  transcribeBaseUrl: string;
  /** The key is never sent here: whether one is saved, the operator's own is used, or the saved one cannot be read any more. */
  transcribeKey: "none" | "set" | "operator" | "unavailable";
};
export type TranscribeProvider = "local" | "openai" | "compatible";
export type TranscribeSettingsPatch = Partial<
  Pick<
    Installation,
    "transcribeProvider" | "transcribeModel" | "transcribeLanguage" | "transcribeBaseUrl"
  >
>;
export type TranscribeTest = { ok: boolean; provider?: TranscribeProvider; message?: string };

export const installationApi = {
  get: () => call<Installation>("/api/installation"),
  /** The answer is the saved installation: it replaces the cached one. */
  patch: (
    patch: Partial<
      Pick<
        Installation,
        "networkMode" | "publicUrl" | "onboarding" | "laya" | "layaLanguages" | "updateCheck"
      >
    > &
      TranscribeSettingsPatch,
  ) =>
    call<Installation>("/api/installation", "PATCH", patch).then((next) => {
      queryClient.setQueryData(installationQueries.get().queryKey, next);
      return next;
    }),
  /** The key travels sealed to the server's transport key, like every credential; the page never keeps it. */
  saveTranscribeKey: (secret: string) =>
    sendSealed("installation.transcribe-key", { secret }, (sealed) =>
      call<{ ok: true }>("/api/connections/transcribe-key", "PUT", { sealed }),
    ).then(refresh),
  removeTranscribeKey: () =>
    call<{ ok: true }>("/api/connections/transcribe-key", "DELETE").then(refresh),
  /** One second of silence through the saved choice: whether the key, the address and the model work. */
  testTranscribe: () => call<TranscribeTest>("/api/installation/transcribe/test", "POST", {}),
};
/** After a change that does not return the installation: read it again into the cache. */
const refresh = async () => {
  const next = await installationApi.get();
  queryClient.setQueryData(installationQueries.get().queryKey, next);
  return next;
};

export const installationQueries = {
  get: () =>
    queryOptions({ queryKey: ["installation"], queryFn: () => installationApi.get(), ...STATIC }),
};
