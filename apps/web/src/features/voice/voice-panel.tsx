import {
  MicrophoneIcon,
  MicrophoneSlashIcon,
  PhoneXIcon,
  SpeakerHighIcon,
  WaveformIcon,
  WarningCircleIcon,
} from "@phosphor-icons/react";
import { InputGroupButton } from "@zetta/ui/components/input-group";
import { cn } from "@zetta/ui/lib/utils";
import { useEffect, useRef, type KeyboardEvent } from "react";

import { ActionHint } from "@/components/action-hint";
import { Button } from "@/components/ui";
import type { VoiceCall, CallPhase, CallView } from "./voice-call";

/** What the composer needs to show the Voice button. Absent when voice is off or this is not a plain chat. */
export type VoiceControl = {
  call: "idle" | "active";
  botName?: string | undefined;
  onToggle: () => void;
};

/** The Voice button next to the microphone: starts a call, and while one runs ends it. */
export function VoiceButton({ call, botName, onToggle }: VoiceControl) {
  const label =
    call === "active"
      ? "End the voice call"
      : botName
        ? `Talk with ${botName} by voice`
        : "Talk by voice";
  return (
    <ActionHint label={label}>
      <InputGroupButton
        size="icon-xs"
        aria-label={label}
        aria-pressed={call === "active"}
        className={cn(call === "active" && "bg-muted text-foreground")}
        onClick={onToggle}
      >
        <WaveformIcon />
      </InputGroupButton>
    </ActionHint>
  );
}

const STATE_TEXT: Record<Exclude<CallPhase, "idle" | "ended">, string> = {
  connecting: "Connecting…",
  listening: "Listening",
  thinking: "Thinking",
  speaking: "Speaking",
};

function StateIcon({ phase, muted }: { phase: CallPhase; muted: boolean }) {
  if (muted) return <MicrophoneSlashIcon aria-hidden="true" className="size-5 shrink-0" />;
  if (phase === "speaking")
    return <SpeakerHighIcon aria-hidden="true" className="size-5 shrink-0" />;
  if (phase === "thinking") return <WaveformIcon aria-hidden="true" className="size-5 shrink-0" />;
  return <MicrophoneIcon aria-hidden="true" className="size-5 shrink-0" />;
}

/** The loudness of the microphone. It is drawn straight from the level feed, not from React state, so 25 updates a second never render the page. */
function LevelMeter({ call }: { call: VoiceCall }) {
  const bar = useRef<HTMLDivElement>(null);
  useEffect(
    () =>
      call.subscribeLevel((level) => {
        // Speech sits low on the scale: a square root makes a normal voice move the bar.
        if (bar.current)
          bar.current.style.transform = `scaleX(${Math.min(1, Math.sqrt(level) * 1.6)})`;
      }),
    [call],
  );
  return (
    <div aria-hidden="true" className="h-1.5 w-24 shrink-0 overflow-hidden rounded-full bg-muted">
      <div
        ref={bar}
        className="h-full w-full origin-left bg-primary"
        style={{ transform: "scaleX(0)" }}
      />
    </div>
  );
}

function Notice({ view, call }: { view: CallView; call: VoiceCall }) {
  const notice = view.notice!;
  const failed = notice.kind !== "hangup";
  return (
    <div className="flex flex-wrap items-center gap-3">
      <p role={failed ? "alert" : "status"} className="min-w-0 flex-1 break-words">
        {failed && (
          <WarningCircleIcon
            aria-hidden="true"
            className="mr-1.5 inline size-4 align-text-bottom text-destructive"
          />
        )}
        {notice.message}
      </p>
      <Button size="sm" onClick={() => void call.start()}>
        Start again
      </Button>
      <Button size="sm" variant="outline" onClick={() => call.dismiss()}>
        Close
      </Button>
    </div>
  );
}

/**
 * The voice call, inline above the message box. What the person says and what the bot answers appear in the chat as ordinary messages
 * (the server saves them), so this panel shows only the state, the microphone, and the words just heard until they show in the chat.
 * Escape ends the call when focus is inside the panel.
 */
export function VoicePanel({ call, view }: { call: VoiceCall; view: CallView }) {
  if (view.phase === "idle") return null;
  const onKeyDown = (e: KeyboardEvent) => {
    if (e.key === "Escape" && view.phase !== "ended") {
      e.stopPropagation();
      call.end();
    }
  };
  const muted = view.mic === "muted";
  const live = view.phase !== "ended";
  const text = live ? STATE_TEXT[view.phase as keyof typeof STATE_TEXT] : "";
  return (
    <section
      aria-label="Voice call"
      onKeyDown={onKeyDown}
      className="flex flex-col gap-2 rounded-xl border bg-muted/30 px-4 py-3 text-sm"
    >
      {live ? (
        <div className="flex flex-wrap items-center gap-3">
          <StateIcon phase={view.phase} muted={muted} />
          {/* Announced politely each time the state changes. */}
          <p role="status" aria-live="polite" className="min-w-0 font-medium">
            {text}
            {muted ? ", microphone muted" : ""}
          </p>
          <LevelMeter call={call} />
          <span className="flex-1" />
          <Button
            size="sm"
            variant="outline"
            aria-pressed={muted}
            disabled={view.phase === "connecting"}
            onClick={() => (muted ? call.unmute() : call.mute())}
          >
            {muted ? "Unmute" : "Mute"}
          </Button>
          <Button size="sm" variant="destructive" onClick={() => call.end()}>
            <PhoneXIcon aria-hidden="true" />
            End call
          </Button>
        </div>
      ) : (
        <Notice view={view} call={call} />
      )}
      {live && view.heard && (
        <p className="truncate text-muted-foreground">
          <span className="sr-only">You said: </span>“{view.heard}”
        </p>
      )}
      {live && view.warning && (
        <p role="alert" className="text-destructive">
          {view.warning}
        </p>
      )}
    </section>
  );
}
