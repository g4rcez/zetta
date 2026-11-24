import { SPEECH_NAME_PATTERN } from "@zetta/core/speech";
import { useSyncExternalStore } from "react";

import { serverOrigin } from "@/lib/server-origin";
import { toApiError } from "../chat/chat-client";

/**
 * The "Listen" button's player: one message is read at a time, anywhere in the app. The text goes to `POST /api/speech`; the answer is
 * audio (a provider speaks) or text for the device's own voice (`browser`). Pressing the same message again stops it.
 */
export type ListenState = {
  /** The message being read, if any. */
  id: string | null;
  phase: "idle" | "loading" | "playing" | "error";
  /** A sentence for the person when `phase` is `error`. */
  message?: string;
};
const IDLE: ListenState = { id: null, phase: "idle" };

type AudioLike = {
  play(): Promise<void>;
  pause(): void;
  onended: ((e: Event) => void) | null;
  onerror: ((e: Event | string) => void) | null;
};
type SynthLike = {
  speak(u: unknown): void;
  cancel(): void;
  getVoices(): { name: string; lang: string }[];
};

/** What the player uses from the page. Only tests replace these. */
export const listenDeps = {
  fetch: (input: URL, init: RequestInit) => fetch(input, init),
  createAudio: (url: string): AudioLike => new Audio(url),
  createUrl: (blob: Blob) => URL.createObjectURL(blob),
  revokeUrl: (url: string) => URL.revokeObjectURL(url),
  synth: (): SynthLike | undefined =>
    typeof speechSynthesis === "undefined" ? undefined : (speechSynthesis as unknown as SynthLike),
  utterance: (text: string) =>
    new SpeechSynthesisUtterance(text) as unknown as Record<string, unknown>,
};

let state: ListenState = IDLE;
const listeners = new Set<() => void>();
let stop: (() => void) | null = null;
let run = 0;
const publish = (next: ListenState) => {
  state = next;
  for (const l of listeners) l();
};

export const getListenState = () => state;
export const subscribeListen = (l: () => void) => {
  listeners.add(l);
  return () => void listeners.delete(l);
};
export const useListenState = () => useSyncExternalStore(subscribeListen, getListenState);

export function stopListening() {
  run++;
  stop?.();
  stop = null;
  publish(IDLE);
}

const voiceKey = (botId: string) => `zetta:bot-voice:${botId}`;
/** The voice a person chose for a bot on this device (the provider's own name or id), or empty for the installation's. */
export function getBotVoice(botId: string): string {
  try {
    return localStorage.getItem(voiceKey(botId)) ?? "";
  } catch {
    return "";
  }
}
export function setBotVoice(botId: string, voice: string) {
  try {
    if (voice) localStorage.setItem(voiceKey(botId), voice);
    else localStorage.removeItem(voiceKey(botId));
  } catch {
    /* storage can be blocked: the choice then lasts until the page closes at most */
  }
}

/**
 * Reads a message aloud, or stops it when it is the one being read. `voice` is the voice chosen on this device (the browser's own
 * voices); without one, `botId` lets the server use the voice saved on the bot. `language` ("pt-BR") tells the provider what language the text is in.
 */
export async function toggleListen(
  id: string,
  text: string,
  voice?: string,
  botId?: string,
  language?: string,
) {
  if (state.id === id && state.phase !== "idle" && state.phase !== "error") return stopListening();
  stopListening();
  const mine = ++run;
  const alive = () => mine === run;
  publish({ id, phase: "loading" });
  try {
    const response = await listenDeps.fetch(new URL("/api/speech", serverOrigin()), {
      method: "POST",
      credentials: "include",
      cache: "no-store",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        text,
        // A device voice ("Grandma (Portuguese (Brazil))") is not a provider voice name: the server would reject it.
        ...(voice && SPEECH_NAME_PATTERN.test(voice) ? { voice } : botId ? { botId } : {}),
        ...(language ? { language } : {}),
      }),
    });
    if (!response.ok) throw await toApiError(response);
    if (!alive()) return;
    if ((response.headers.get("content-type") ?? "").startsWith("audio/")) {
      const url = listenDeps.createUrl(await response.blob());
      if (!alive()) return listenDeps.revokeUrl(url);
      const audio = listenDeps.createAudio(url);
      const done = () => {
        if (alive()) publish(IDLE);
        listenDeps.revokeUrl(url);
      };
      audio.onended = done;
      audio.onerror = () => {
        if (alive()) publish({ id, phase: "error", message: "The audio could not be played." });
        listenDeps.revokeUrl(url);
      };
      stop = () => {
        audio.pause();
        listenDeps.revokeUrl(url);
      };
      publish({ id, phase: "playing" });
      await audio.play();
      return;
    }
    const body = (await response.json()) as { mode?: string; text?: string };
    const synth = listenDeps.synth();
    if (body.mode !== "browser" || !body.text || !synth)
      throw new Error("This device cannot speak the message.");
    const utterance = listenDeps.utterance(body.text);
    const chosen = voice ? synth.getVoices().find((v) => v.name === voice) : undefined;
    if (chosen) utterance.voice = chosen;
    utterance.onend = () => alive() && publish(IDLE);
    utterance.onerror = () => alive() && publish(IDLE);
    stop = () => synth.cancel();
    publish({ id, phase: "playing" });
    synth.speak(utterance);
  } catch (e) {
    if (alive())
      publish({
        id,
        phase: "error",
        message:
          e instanceof Error && e.message ? e.message : "The message could not be read aloud.",
      });
  }
}
