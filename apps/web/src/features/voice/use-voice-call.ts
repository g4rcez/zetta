import { useQuery } from "@tanstack/react-query";
import { useEffect, useMemo, useRef, useSyncExternalStore } from "react";

import { createVoiceCall, type CallDeps, type CallView, type VoiceCall } from "./voice-call";
import { voiceQueries } from "./voice-api";

/** Where a voice call may be held: a plain chat between the person and one bot (never a room, never a chat with outside people). */
export type VoicePlace = { conversationId?: string | undefined; kind?: string | undefined };
export const canTalkHere = ({ conversationId, kind }: VoicePlace) =>
  Boolean(conversationId) && (kind === undefined || kind === "chat");

const IDLE: CallView = { phase: "idle", mic: "live", heard: "", warning: "", notice: undefined };
const NEVER = () => () => undefined;

export type VoiceSupport = {
  /** `on` only when voice is set up here and this is a place for a call. The button and the panel exist only then. */
  availability: "on" | "off";
  call: VoiceCall | undefined;
  view: CallView;
};

/**
 * The voice call of one chat. It ends when the chat changes, when the page goes away or when the component unmounts: the microphone and
 * the socket never outlive the chat they were opened for.
 */
export function useVoiceCall(options: {
  conversationId?: string | undefined;
  kind?: string | undefined;
  botId?: string | undefined;
  onActivity?: (() => void) | undefined;
  deps?: Partial<CallDeps>;
}): VoiceSupport {
  const { conversationId, kind, botId, deps } = options;
  const capabilities = useQuery(voiceQueries.capabilities());
  const here = canTalkHere({ conversationId, kind });
  const activity = useRef(options.onActivity);
  activity.current = options.onActivity;
  const call = useMemo(
    () =>
      conversationId && here
        ? createVoiceCall({
            conversationId,
            botId,
            onActivity: () => activity.current?.(),
            ...(deps ? { deps } : {}),
          })
        : undefined,
    // `deps` is a test seam and does not change while mounted.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [conversationId, here, botId],
  );
  useEffect(() => {
    if (!call) return;
    const leave = () => call.dispose();
    window.addEventListener("pagehide", leave);
    return () => {
      window.removeEventListener("pagehide", leave);
      call.dispose();
    };
  }, [call]);
  const view = useSyncExternalStore(
    call ? call.subscribe : NEVER,
    call ? call.getView : () => IDLE,
  );
  return {
    availability: call && capabilities.data?.voice === "on" ? "on" : "off",
    call,
    view,
  };
}
