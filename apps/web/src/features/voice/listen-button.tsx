import { useQuery } from "@tanstack/react-query";
import { SpeakerHighIcon, SpinnerGapIcon, StopIcon } from "@phosphor-icons/react";

import { ActionHint } from "@/components/action-hint";
import { Button } from "@/components/ui";
import { queryClient } from "@/lib/query-client";
import { installationQueries } from "../onboarding/installation-api";
import { getBotVoice, toggleListen, useListenState } from "./speech-player";

/**
 * Whether messages can be read aloud: the installation's text-to-speech is anything but off. It reads the cached installation, and shows
 * nothing until that is known (the button never flashes in and out).
 */
export function useListenEnabled() {
  const { data } = useQuery(installationQueries.get(), queryClient);
  return Boolean(data && (data.speechProvider ?? "browser") !== "off");
}

/**
 * "Listen" on a bot's message: reads it aloud with the installation's voice (or the one chosen for this bot) and stops when pressed again.
 * The text of the message is sent to the speech provider the administrator chose, which Studio says next to that choice.
 */
export function ListenButton({
  id,
  text,
  botId,
  size = "icon-xs",
}: {
  id: string;
  text: string;
  botId?: string | undefined;
  size?: "icon-xs" | "icon-sm";
}) {
  const enabled = useListenEnabled();
  const state = useListenState();
  if (!enabled || !text.trim()) return null;
  const mine = state.id === id ? state : undefined;
  const reading = mine?.phase === "loading" || mine?.phase === "playing";
  const label =
    mine?.phase === "error"
      ? (mine.message ?? "Listen")
      : mine?.phase === "loading"
        ? "Preparing audio"
        : reading
          ? "Stop listening"
          : "Listen";
  return (
    <>
      <ActionHint label={label}>
        <Button
          size={size}
          variant="ghost"
          aria-label={label}
          aria-pressed={reading}
          onClick={() => void toggleListen(id, text, botId ? getBotVoice(botId) : undefined, botId)}
        >
          {mine?.phase === "loading" ? (
            <SpinnerGapIcon className="animate-spin" />
          ) : reading ? (
            <StopIcon />
          ) : (
            <SpeakerHighIcon />
          )}
        </Button>
      </ActionHint>
      {mine?.phase === "error" && (
        <span role="alert" className="sr-only">
          {mine.message}
        </span>
      )}
    </>
  );
}
