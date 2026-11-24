import { call as apiCall } from "../chat/chat-client";
import { serverOrigin } from "@/lib/server-origin";
import type { AudioSession, OpenAudio } from "./call-audio-session";
import { getBotVoice } from "./speech-player";

/**
 * One voice call from the page: the ticket, the WebSocket, the microphone and the speaker. It is a small store (`getView`, `subscribe`)
 * the panel reads, with no React in it. The words of the call are not kept here: the server saves them as ordinary chat messages, which
 * the chat shows as it shows any message. Protocol: `apps/server/src/modules/voice/protocol.ts`.
 */
export type CallPhase = "idle" | "connecting" | "listening" | "thinking" | "speaking" | "ended";
export type MicState = "live" | "muted";

/** Why nothing is happening, in a way the person can act on. */
export type CallNoticeKind =
  | "mic_denied"
  | "mic_missing"
  | "mic_unsupported"
  | "mic_failed"
  | "refused"
  | "connection_lost"
  | "link_expired"
  | "replaced"
  | "time_limit"
  | "idle"
  | "server_error"
  | "restart"
  | "hangup";
export type CallNotice = { kind: CallNoticeKind; message: string };

export type CallView = {
  phase: CallPhase;
  mic: MicState;
  /** What the person just said, until it shows up in the chat. */
  heard: string;
  /** A problem the call went on through (the server said something went wrong), for the person to read. */
  warning: string;
  /** Set when the call is over or could not start. */
  notice: CallNotice | undefined;
};

const IDLE_VIEW: CallView = {
  phase: "idle",
  mic: "live",
  heard: "",
  warning: "",
  notice: undefined,
};

export const NOTICES: Record<CallNoticeKind, string> = {
  mic_denied:
    "Zetta cannot use the microphone. Allow it for this site (the icon at the left of the address bar, then Microphone: Allow), then start again.",
  mic_missing: "No microphone was found. Plug one in or turn it on, then start again.",
  mic_unsupported:
    "This browser cannot capture audio for a call. Use a current Chrome, Edge, Firefox or Safari, over HTTPS.",
  mic_failed: "The microphone could not be started. Check that no other app is holding it.",
  refused: "The call could not start.",
  connection_lost: "The connection to the call was lost. Start it again when you are ready.",
  link_expired: "The call could not be opened because its link expired. Start it again.",
  replaced:
    "This call was ended because you started another one in another tab or on another device.",
  time_limit: "The call reached its time limit of 30 minutes. Start another to keep talking.",
  idle: "The call ended after 2 minutes of silence.",
  server_error: "The call stopped because of a problem on the server. Start it again.",
  restart: "The server restarted, so the call ended. Start it again.",
  hangup: "The call ended.",
};
const REASONS: Record<string, CallNoticeKind> = {
  replaced: "replaced",
  time_limit: "time_limit",
  idle: "idle",
  error: "server_error",
  restart: "restart",
  hangup: "hangup",
  disconnected: "connection_lost",
};

/** What the call uses from the page. Only tests replace these. */
export type CallDeps = {
  ticket: (conversationId: string) => Promise<{ ticket: string }>;
  socket: (ticket: string) => WebSocket;
  getUserMedia: (constraints: MediaStreamConstraints) => Promise<MediaStream>;
  openAudio: OpenAudio;
  synth: () => SynthLike | undefined;
  utterance: (text: string) => { voice?: unknown; lang?: string };
  language: () => string;
};
type SynthLike = {
  speak(u: unknown): void;
  cancel(): void;
  getVoices(): { name: string; lang: string }[];
};

const wsUrl = (ticket: string) => {
  const url = new URL("/api/voice/socket", serverOrigin());
  url.protocol = url.protocol === "https:" ? "wss:" : "ws:";
  url.searchParams.set("ticket", ticket);
  return url.toString();
};

export const callDeps: CallDeps = {
  ticket: (conversationId) =>
    apiCall<{ ticket: string }>("/api/voice/ticket", "POST", { conversationId }),
  socket: (ticket) => new WebSocket(wsUrl(ticket)),
  getUserMedia: (c) => navigator.mediaDevices.getUserMedia(c),
  openAudio: (stream, h) => import("./call-audio-session").then((m) => m.openAudio(stream, h)),
  synth: () =>
    typeof speechSynthesis === "undefined" ? undefined : (speechSynthesis as unknown as SynthLike),
  utterance: (text) => new SpeechSynthesisUtterance(text) as unknown as { voice?: unknown },
  language: () => (typeof navigator === "undefined" ? "en" : navigator.language || "en"),
};

/** The microphone asks the browser for what a call needs: its echo canceller on, so the bot does not hear itself. */
export const MIC_CONSTRAINTS: MediaStreamConstraints = {
  audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true },
};

const mediaNotice = (e: unknown): CallNoticeKind => {
  const name = (e as { name?: string } | undefined)?.name;
  if (name === "NotAllowedError" || name === "SecurityError") return "mic_denied";
  if (name === "NotFoundError" || name === "OverconstrainedError") return "mic_missing";
  return "mic_failed";
};
const errorText = (e: unknown) => (e instanceof Error && e.message ? e.message : NOTICES.refused);

export type VoiceCall = ReturnType<typeof createVoiceCall>;

export function createVoiceCall(options: {
  conversationId: string;
  botId?: string | undefined;
  /** Something changed that the chat may show (a message was saved): the page refreshes the chat. */
  onActivity?: (() => void) | undefined;
  deps?: Partial<CallDeps>;
}) {
  const deps = { ...callDeps, ...options.deps };
  let view: CallView = IDLE_VIEW;
  const listeners = new Set<() => void>();
  const levelListeners = new Set<(level: number) => void>();
  let run = 0;
  let ws: WebSocket | undefined;
  let stream: MediaStream | undefined;
  let audio: AudioSession | undefined;
  let closeTimer: ReturnType<typeof setTimeout> | undefined;
  let heardTimer: ReturnType<typeof setTimeout> | undefined;
  let lastPlayed = -1;
  let lastPlayedAt = 0;

  const set = (patch: Partial<CallView>) => {
    view = { ...view, ...patch };
    for (const l of listeners) l();
  };
  const level = (n: number) => {
    for (const l of levelListeners) l(n);
  };
  const send = (m: Record<string, unknown>) => {
    if (ws?.readyState === 1) ws.send(JSON.stringify(m));
  };
  const speaking = () => deps.synth();
  const stopSpeech = () => {
    try {
      speaking()?.cancel();
    } catch {
      /* a device without speech has nothing to stop */
    }
  };

  /** Lets go of the microphone, the audio and the speech, whatever state the call is in. The microphone indicator goes off here. */
  function release() {
    clearTimeout(closeTimer);
    clearTimeout(heardTimer);
    stream?.getTracks().forEach((t) => t.stop());
    stream = undefined;
    audio?.close();
    audio = undefined;
    stopSpeech();
    level(0);
    lastPlayed = -1;
  }
  function closeSocket() {
    const s = ws;
    ws = undefined;
    if (!s) return;
    s.onmessage = s.onclose = s.onerror = s.onopen = null;
    try {
      if (s.readyState === 0 || s.readyState === 1) s.close(1000, "bye");
    } catch {
      /* already closed */
    }
  }
  /** The call is over (or never started): everything is released, and the person is told why. */
  function finish(kind: CallNoticeKind, message = NOTICES[kind]) {
    release();
    closeSocket();
    set({ phase: "ended", notice: { kind, message }, heard: "", mic: "live" });
    options.onActivity?.();
  }

  function onMessage(mine: number, data: unknown) {
    if (mine !== run) return;
    if (typeof data !== "string") {
      if (data instanceof ArrayBuffer && audio) audio.push(data);
      return;
    }
    let m: {
      type?: string;
      state?: string;
      reason?: string;
      text?: string;
      final?: boolean;
      message?: string;
    };
    try {
      m = JSON.parse(data);
    } catch {
      return;
    }
    switch (m.type) {
      case "state": {
        if (m.state === "ended") {
          finish(REASONS[m.reason ?? ""] ?? "hangup");
          return;
        }
        if (m.state !== "listening" && m.state !== "thinking" && m.state !== "speaking") return;
        // A new turn or a new reply: what the player counted belongs to the one before.
        if (m.state === "thinking" || (m.state === "speaking" && view.phase !== "speaking"))
          audio?.resetPlayed();
        if (m.state === "speaking") set({ phase: "speaking", heard: "" });
        else set({ phase: m.state });
        options.onActivity?.();
        return;
      }
      case "transcript": {
        const text = (m.text ?? "").trim();
        set({ heard: text });
        clearTimeout(heardTimer);
        // The words are saved in the chat as the person's message; this line only bridges the moment until they show there.
        if (m.final) {
          heardTimer = setTimeout(() => set({ heard: "" }), 4000);
          options.onActivity?.();
        }
        return;
      }
      case "say": {
        const synth = speaking();
        if (!synth || !m.text) return;
        const u = deps.utterance(m.text);
        const chosen = options.botId ? getBotVoice(options.botId) : "";
        const voice = chosen ? synth.getVoices().find((v) => v.name === chosen) : undefined;
        if (voice) {
          u.voice = voice;
          u.lang = voice.lang;
        } else u.lang = deps.language();
        synth.speak(u);
        return;
      }
      case "clear":
        audio?.clear();
        stopSpeech();
        return;
      case "error":
        set({ warning: m.message || "Something went wrong in the call." });
        return;
    }
  }

  async function start() {
    if (view.phase !== "idle" && view.phase !== "ended") return;
    const mine = ++run;
    const stale = () => mine !== run;
    set({ ...IDLE_VIEW, phase: "connecting" });
    if (typeof navigator === "undefined" || !navigator.mediaDevices?.getUserMedia) {
      return finish("mic_unsupported");
    }
    try {
      stream = await deps.getUserMedia(MIC_CONSTRAINTS);
    } catch (e) {
      if (stale()) return;
      return finish(mediaNotice(e));
    }
    if (stale()) return release();
    try {
      audio = await deps.openAudio(stream, {
        onFrame: (bytes) => {
          if (view.mic === "live" && ws?.readyState === 1)
            ws.send(bytes as Uint8Array<ArrayBuffer>);
        },
        onLevel: (n) => level(view.mic === "live" ? n : 0),
        onPlayed: (samples) => {
          // Told to the server about four times a second, and only when it changed.
          const now = Date.now();
          // Nothing played (a cleared player, or the device's own voice) says nothing: the server then counts what it sent.
          if (samples <= 0 || samples === lastPlayed || now - lastPlayedAt < 200) return;
          lastPlayed = samples;
          lastPlayedAt = now;
          send({ type: "played", samples });
        },
      });
    } catch {
      if (stale()) return release();
      return finish("mic_failed");
    }
    if (stale()) return release();
    let ticket: string;
    try {
      ticket = (await deps.ticket(options.conversationId)).ticket;
    } catch (e) {
      if (stale()) return;
      return finish("refused", errorText(e));
    }
    if (stale()) return release();
    const socket = deps.socket(ticket);
    socket.binaryType = "arraybuffer";
    ws = socket;
    socket.onopen = () => {
      if (stale()) return;
      send({ type: "start", language: deps.language() });
      set({ phase: "listening" });
    };
    socket.onmessage = (e) => onMessage(mine, e.data);
    socket.onerror = () => undefined;
    socket.onclose = (e) => {
      if (stale() || ws !== socket) return;
      ws = undefined;
      if (view.phase === "ended") return;
      if (e.code === 4401) return finish("link_expired");
      if (e.code === 4409) return finish("replaced");
      finish("connection_lost");
    };
  }

  /** Hangs up. The microphone is let go at once; the socket gets a moment to say why it ended, then closes. */
  function end() {
    if (view.phase === "idle" || view.phase === "ended") return;
    send({ type: "end" });
    run++;
    release();
    set({ phase: "ended", notice: { kind: "hangup", message: NOTICES.hangup }, heard: "" });
    const s = ws;
    clearTimeout(closeTimer);
    closeTimer = setTimeout(() => {
      if (ws === s) closeSocket();
    }, 1500);
    if (s) s.onmessage = null;
    options.onActivity?.();
  }

  /** The page is leaving or the chat changed: stop everything and go back to the start, ready for a new call. */
  function dispose() {
    if (view.phase !== "idle" && view.phase !== "ended") send({ type: "end" });
    run++;
    release();
    closeSocket();
    view = IDLE_VIEW;
    for (const l of listeners) l();
  }

  function setMuted(mic: MicState) {
    if (view.phase === "idle" || view.phase === "ended" || view.phase === "connecting") return;
    send({ type: mic === "muted" ? "mute" : "unmute" });
    if (mic === "muted") level(0);
    set({ mic });
  }

  return {
    start,
    end,
    dispose,
    mute: () => setMuted("muted"),
    unmute: () => setMuted("live"),
    /** Back to the start after a notice, with nothing running. */
    dismiss() {
      if (view.phase === "ended" || view.phase === "idle") {
        view = IDLE_VIEW;
        for (const l of listeners) l();
      }
    },
    getView: () => view,
    subscribe(l: () => void) {
      listeners.add(l);
      return () => void listeners.delete(l);
    },
    /** The microphone's loudness, 0 to 1, about 25 times a second; it is not React state, so the meter does not render the page. */
    subscribeLevel(l: (level: number) => void) {
      levelListeners.add(l);
      return () => void levelListeners.delete(l);
    },
  };
}
