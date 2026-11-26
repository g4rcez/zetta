import { useQuery } from "@tanstack/react-query";
import { SpeakerHighIcon, StopIcon } from "@phosphor-icons/react";

import { queryClient } from "@/lib/query-client";
import { toast } from "@/lib/notify";
import { MenuRow } from "../chat/menu-row";
import { installationQueries } from "../onboarding/installation-api";
import { getBotVoice, getListenState, toggleListen, useListenState } from "./speech-player";

/**
 * Whether messages can be read aloud: the installation's text-to-speech is anything but off. It reads the cached installation, and shows
 * nothing until that is known (the control never flashes in and out).
 */
export function useListenEnabled() {
  const { data } = useQuery(installationQueries.get(), queryClient);
  return Boolean(data && (data.speechProvider ?? "browser") !== "off");
}

/**
 * "Listen" in the menu of a bot's message: reads it aloud with the installation's voice (or the one chosen for this bot); on the message
 * being read it stops. The reading goes on after the menu closes, so a failure is reported as a toast.
 * The text of the message is sent to the speech provider the administrator chose, which Studio says next to that choice.
 */
export function ListenMenuRow({
  id,
  text,
  botId,
  onDone,
}: {
  id: string;
  text: string;
  botId?: string | undefined;
  onDone: () => void;
}) {
  const enabled = useListenEnabled();
  const state = useListenState();
  if (!enabled || !text.trim()) return null;
  const phase = state.id === id ? state.phase : "idle";
  const reading = phase === "loading" || phase === "playing";
  const read = async () => {
    await toggleListen(id, text, botId ? getBotVoice(botId) : undefined, botId);
    const after = getListenState();
    if (after.id === id && after.phase === "error")
      toast.error(after.message ?? "The message could not be read.");
  };
  return (
    <MenuRow
      icon={reading ? StopIcon : SpeakerHighIcon}
      onClick={() => {
        onDone();
        void read();
      }}
    >
      {reading ? "Stop listening" : "Listen"}
    </MenuRow>
  );
}
