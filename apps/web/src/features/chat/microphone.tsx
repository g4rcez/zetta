import { MicrophoneIcon, StopIcon } from "@phosphor-icons/react";
import { InputGroupButton } from "@zetta/ui/components/input-group";
import { cn } from "@zetta/ui/lib/utils";
import { useEffect, useRef, useState } from "react";

import { ActionHint } from "@/components/action-hint";
import {
  bytesToBase64,
  clock,
  floatToPcm16,
  MAX_RECORDING_SECONDS,
  recordingToSamples,
} from "./audio";
import { call } from "./chat-client";

export const transcribe = async (samples: Float32Array) =>
  (
    await call<{ text: string }>("/api/transcribe", "POST", {
      pcmBase64: bytesToBase64(floatToPcm16(samples)),
      language: typeof navigator === "undefined" ? undefined : navigator.language,
    })
  ).text;

type Phase = "idle" | "recording" | "working";

/**
 * The microphone of the message box. Press to record, press again to stop: the recording is turned into 16 kHz samples here, sent to the
 * server's speech model, and the words are put into the message for the person to read and change before sending. Nothing is sent as a
 * message by itself.
 */
export function MicButton({
  onText,
  onError,
  toSamples = recordingToSamples,
  send = transcribe,
}: {
  onText: (text: string) => void;
  onError: (e: unknown) => void;
  /** How a recording becomes 16 kHz samples, and how they become words. Only tests set these. */
  toSamples?: (blob: Blob) => Promise<Float32Array>;
  send?: (samples: Float32Array) => Promise<string>;
}) {
  const [phase, setPhase] = useState<Phase>("idle");
  const [seconds, setSeconds] = useState(0);
  const recorder = useRef<MediaRecorder | undefined>(undefined);
  const stream = useRef<MediaStream | undefined>(undefined);
  const chunks = useRef<Blob[]>([]);
  const timer = useRef<ReturnType<typeof setInterval> | undefined>(undefined);

  const release = () => {
    clearInterval(timer.current);
    stream.current?.getTracks().forEach((t) => t.stop());
    stream.current = undefined;
  };
  // A recording that is still going when the box goes away is dropped, and the microphone is let go.
  useEffect(
    () => () => {
      const r = recorder.current;
      if (r && r.state !== "inactive") {
        r.onstop = null;
        r.stop();
      }
      release();
    },
    [],
  );

  async function start() {
    if (!navigator.mediaDevices?.getUserMedia || typeof MediaRecorder === "undefined") {
      onError(new Error("This browser cannot record. Try Chrome, Firefox or Safari over HTTPS."));
      return;
    }
    try {
      stream.current = await navigator.mediaDevices.getUserMedia({ audio: true });
    } catch {
      onError(
        new Error(
          "Zetta needs permission to use the microphone. Allow it in the address bar and try again.",
        ),
      );
      return;
    }
    chunks.current = [];
    const r = new MediaRecorder(stream.current);
    recorder.current = r;
    r.ondataavailable = (e) => {
      if (e.data.size) chunks.current.push(e.data);
    };
    r.onstop = () => {
      const blob = new Blob(chunks.current, { type: r.mimeType || "audio/webm" });
      release();
      if (!blob.size) {
        setPhase("idle");
        return;
      }
      setPhase("working");
      toSamples(blob)
        .then(send)
        .then((text) => {
          if (text) onText(text);
          else onError(new Error("Nothing could be heard in that recording."));
        })
        .catch(onError)
        .finally(() => setPhase("idle"));
    };
    r.start();
    setSeconds(0);
    setPhase("recording");
    const began = Date.now();
    timer.current = setInterval(() => {
      const s = Math.floor((Date.now() - began) / 1000);
      setSeconds(s);
      if (s >= MAX_RECORDING_SECONDS) r.stop();
    }, 250);
  }
  const stop = () => recorder.current?.state === "recording" && recorder.current.stop();

  const label =
    phase === "recording"
      ? `Stop recording (${clock(seconds)})`
      : phase === "working"
        ? "Writing it down…"
        : "Record a message";
  return (
    <ActionHint label={label}>
      <InputGroupButton
        size="icon-xs"
        aria-label={label}
        aria-pressed={phase === "recording"}
        disabled={phase === "working"}
        className={cn(phase === "recording" && "bg-destructive/15 text-destructive")}
        onClick={() => (phase === "recording" ? stop() : void start())}
      >
        {phase === "recording" ? <StopIcon weight="fill" /> : <MicrophoneIcon />}
      </InputGroupButton>
    </ActionHint>
  );
}
