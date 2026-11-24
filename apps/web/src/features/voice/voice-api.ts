import { queryOptions } from "@tanstack/react-query";

import { STATIC } from "@/lib/query-policy";
import { call } from "../chat/chat-client";

export type VoiceCapabilities = { voice: "on" | "off"; phone: "on" | "off" };

export const voiceQueries = {
  /** Whether voice is set up on this installation (speech to text and text to speech both chosen in Studio). */
  capabilities: () =>
    queryOptions({
      queryKey: ["voice", "capabilities"],
      queryFn: () => call<VoiceCapabilities>("/api/voice/capabilities"),
      ...STATIC,
    }),
};
