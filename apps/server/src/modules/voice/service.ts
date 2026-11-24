import type { Database } from "@zetta/db";
import { and, eq } from "@zetta/db/query";
import { bot, conversation } from "@zetta/db/schema/chat";
import type { VoiceEndReason } from "@zetta/db/schema/voice";
import { audit } from "../features/audit";
import type { ActiveActor } from "../identity/access";
import type { ConfiguredSynthesizer } from "../speech/configured";
import { FrameChunker, pcm16ToBytes } from "./core/audio";
import { VoiceSession, type SessionDeps, type SessionEvent } from "./core/session";
import { systemClock, type Clock, type TimerHandle, type VoiceTranscriber } from "./core/types";
import { createEnergyVad, type Vad } from "./core/vad";
import { createChatTurnFollower, type FollowerChat } from "./follower";
import { createPlayback, createTextSynthesizer, realSleep, type Sleep } from "./playback";
import {
  parseAudioFrame,
  parseClientMessage,
  VOICE_LIMITS,
  VoiceProtocolError,
  type CallState,
  type ServerMessage,
} from "./protocol";
import { createCallStore } from "./store";
import { createPerMinute, createTicketStore } from "./tickets";
import { createCallWatch } from "./watch";

/** Why a ticket or a socket was refused. `safe` is a sentence for the person. */
export class VoiceError extends Error {
  constructor(
    readonly code: "OFF" | "NOT_FOUND" | "NOT_A_CHAT" | "RATE",
    readonly safe: string,
  ) {
    super(code);
  }
}

/** The socket as the service sees it: the route fills it from the real WebSocket, a test from memory. */
export type VoiceSocket = {
  sendText(message: ServerMessage): void;
  sendBinary(frame: Uint8Array): void;
  ping(): void;
  close(code: number, reason: string): void;
};

/** What the person's side does with an open call. */
export type VoiceCallHandle = {
  readonly id: string;
  /** A message from the person: binary audio, or a JSON text message. */
  message(data: unknown): void;
  /** The socket closed. */
  closed(): void;
};

export type VoiceDeps = {
  db: Database;
  chat: FollowerChat;
  transcriber: VoiceTranscriber;
  synthesizer: ConfiguredSynthesizer;
  /** True when speech to text and text to speech are both ready: the feature is on. */
  ready: () => Promise<boolean>;
  /** True when a phone provider, its key, its public address and its call application are all set (installation settings). */
  phoneOn?: () => Promise<boolean>;
  /** The installation's language for speech to text, used when neither the person nor the bot names one. */
  defaultLanguage?: () => Promise<string | undefined>;
  instance?: () => string | undefined;
  clock?: Clock;
  sleep?: Sleep;
  vad?: () => Vad;
  /** How much audio may wait at the player before the server holds the next chunk back (default 500 ms). */
  leadMs?: number;
  /** Faster than real time for the `browser` mode's imitation of speaking (tests). */
  textRate?: number;
  limits?: Partial<{ maxCallMs: number; idleMs: number; pingMs: number; ticketMs: number }>;
  session?: SessionDeps["config"];
  /** How many tickets one person can ask for per minute (default 12). */
  ticketsPerMinute?: number;
};

/** Close codes of the socket (the 4xxx range is for applications). */
export const CLOSE = {
  normal: 1000,
  badTicket: 4401,
  replaced: 4409,
  ended: 4410,
  protocol: 4400,
} as const;

const STATE_OF: Record<string, CallState | undefined> = {
  listening: "listening",
  interrupted: "listening",
  thinking: "thinking",
  speaking: "speaking",
};

type Ticket = { actor: ActiveActor; conversationId: string; botId: string };
type Live = { end(reason: VoiceEndReason): Promise<void> };

/**
 * The spoken conversation: a ticket for a person's own chat with a bot, and the socket that carries 20 ms frames of 16 kHz mono audio
 * both ways plus a few JSON messages (protocol.ts). The speech to text, the bot's turn (the chat service, exactly as for a typed
 * message), the text to speech and the barge-in all live in the voice session (core/session.ts); this file connects it to a socket, the
 * database and the clock.
 */
export function createVoiceService(deps: VoiceDeps) {
  const clock = deps.clock ?? systemClock;
  const sleep = deps.sleep ?? realSleep;
  const limits = {
    maxCallMs: VOICE_LIMITS.maxCallMs,
    idleMs: VOICE_LIMITS.idleMs,
    pingMs: VOICE_LIMITS.pingMs,
    ticketMs: VOICE_LIMITS.ticketMs,
    ...deps.limits,
  };
  const tickets = createTicketStore<Ticket>({ ttlMs: limits.ticketMs, now: () => clock.now() });
  const perMinute = createPerMinute(deps.ticketsPerMinute ?? VOICE_LIMITS.ticketsPerMinute, () =>
    clock.now(),
  );
  const store = createCallStore(deps.db, deps.instance ?? (() => undefined));
  /** The call each person has now: a second one ends the first. */
  const live = new Map<string, Live>();

  async function ticket(actor: ActiveActor, conversationId: string) {
    if (!(await deps.ready()))
      throw new VoiceError(
        "OFF",
        "Voice is not set up. An administrator turns on speech to text and text to speech in Studio.",
      );
    if (!perMinute.take(actor.userId))
      throw new VoiceError("RATE", "That was a lot of calls. Wait a minute and try again.");
    // Someone else's chat is not found, whatever it is.
    const [conv] = await deps.db
      .select({ id: conversation.id, kind: conversation.kind, botId: conversation.botId })
      .from(conversation)
      .where(and(eq(conversation.id, conversationId), eq(conversation.ownerUserId, actor.userId)));
    if (!conv) throw new VoiceError("NOT_FOUND", "That chat was not found.");
    // A room, or a chat with outside people, is not a place for a call: only a plain chat between the person and one bot.
    if (conv.kind !== "chat")
      throw new VoiceError(
        "NOT_A_CHAT",
        "You can only talk by voice in a one-to-one chat with a bot.",
      );
    const [b] = await deps.db
      .select({ id: bot.id, archived: bot.archived })
      .from(bot)
      .where(eq(bot.id, conv.botId));
    if (!b || b.archived) throw new VoiceError("NOT_FOUND", "That bot is not available.");
    return {
      ticket: tickets.mint({ actor, conversationId: conv.id, botId: conv.botId }),
      expiresInSeconds: Math.round(limits.ticketMs / 1000),
    };
  }

  async function capabilities() {
    return {
      voice: (await deps.ready().catch(() => false)) ? ("on" as const) : ("off" as const),
      phone: (await deps.phoneOn?.().catch(() => false)) ? ("on" as const) : ("off" as const),
    };
  }

  /** Opens the call a socket carries. A ticket that is not valid closes the socket and gives null. */
  async function open(ticketValue: string, socket: VoiceSocket): Promise<VoiceCallHandle | null> {
    const info = tickets.redeem(ticketValue);
    if (!info) {
      socket.close(CLOSE.badTicket, "This link to the call is no longer valid.");
      return null;
    }
    const userId = info.actor.userId;
    // One call per person: the new one ends the old one.
    await live.get(userId)?.end("replaced");

    const [b] = await deps.db.select().from(bot).where(eq(bot.id, info.botId));
    if (!b) {
      socket.close(CLOSE.badTicket, "That bot is not available.");
      return null;
    }
    const mode = await deps.synthesizer.mode().catch(() => "off" as const);
    const installationLanguage = await deps.defaultLanguage?.().catch(() => undefined);
    const row = await store.open({
      ownerUserId: userId,
      botId: b.id,
      conversationId: info.conversationId,
    });
    void audit(deps.db, userId, {
      kind: "voice_call",
      outcome: "ok",
      botId: b.id,
      subjectId: row.id,
      detail: "started",
    });

    const follower = createChatTurnFollower({
      db: deps.db,
      chat: deps.chat,
      actor: info.actor,
      conversationId: info.conversationId,
      callId: row.id,
    });
    const playback = createPlayback({ clock, sleep, leadMs: deps.leadMs });
    const out = new FrameChunker();
    const inbound = new FrameChunker();
    const early: Int16Array[] = [];
    let session: VoiceSession | null = null;
    let muted = false;
    let over = false;
    let lastState: CallState | null = null;
    let startTimer: TimerHandle | null = null;
    let pingTimer: TimerHandle | null = null;

    const send = (m: ServerMessage) => {
      try {
        socket.sendText(m);
      } catch {
        /* the socket is gone: the close handler ends the call */
      }
    };
    const sendState = (state: CallState, reason?: string) => {
      if (state === lastState) return;
      lastState = state;
      send(reason ? { type: "state", state, reason } : { type: "state", state });
    };
    const sendFrames = (frames: Int16Array[]) => {
      for (const f of frames) {
        try {
          socket.sendBinary(pcm16ToBytes(f));
        } catch {
          /* closed */
        }
      }
    };

    const watch = createCallWatch({
      clock,
      maxCallMs: limits.maxCallMs,
      idleMs: limits.idleMs,
      busy: () => session !== null && session.state !== "listening",
      onEnd: (reason) => void end(reason),
    });

    async function end(reason: VoiceEndReason) {
      if (over) return;
      over = true;
      live.delete(userId);
      watch.stop();
      if (startTimer !== null) clock.clearTimeout(startTimer);
      if (pingTimer !== null) clock.clearTimeout(pingTimer);
      session?.end();
      const failed = reason === "error";
      // The row first, so a person told "ended" finds the call ended.
      await store.finish(row.id, failed ? "failed" : "ended", reason).catch(() => undefined);
      sendState("ended", reason);
      try {
        socket.close(reason === "replaced" ? CLOSE.replaced : CLOSE.ended, reason);
      } catch {
        /* closed */
      }
      void audit(deps.db, userId, {
        kind: "voice_call",
        outcome: failed ? "failed" : "ok",
        botId: b!.id,
        subjectId: row.id,
        detail: `ended:${reason}`,
      });
      // What the person heard of the last reply is saved with it once its turn is over.
      await follower.settled().catch(() => undefined);
    }
    live.set(userId, { end });

    const vad = (deps.vad ?? (() => createEnergyVad()))();
    const watchedVad: Vad = {
      push(frame) {
        const e = vad.push(frame);
        if (e === "speech-start") watch.touch();
        return e;
      },
      reset: () => vad.reset(),
      get speaking() {
        return vad.speaking;
      },
      get hangoverMs() {
        return vad.hangoverMs;
      },
    };

    const onEvent = (e: SessionEvent) => {
      watch.touch();
      if (over) return;
      switch (e.type) {
        case "state": {
          const state = STATE_OF[e.state];
          if (state) {
            // The last piece of a sentence is padded to a whole frame once the bot stops speaking.
            if (state !== "speaking") sendFrames(out.flush());
            sendState(state);
          }
          return;
        }
        case "audio":
          if (mode === "remote") sendFrames(out.push(e.pcm));
          return;
        case "flush":
          out.flush();
          playback.reset();
          send({ type: "clear" });
          return;
        case "transcript":
          // The person spoke while audio was still playing at their end (the session had finished sending it): cut it.
          if (playback.pending() > 0) {
            playback.reset();
            send({ type: "clear" });
          }
          send({ type: "transcript", text: e.text, final: true });
          return;
        case "reply":
          void follower.reportReply({
            spokenChars: e.spokenChars,
            replyChars: e.replyChars,
            interrupted: e.interrupted,
          });
          return;
        case "error":
          send({ type: "error", code: "VOICE_ERROR", message: e.message });
          return;
        default:
          return;
      }
    };

    const startSession = (clientLanguage?: string) => {
      if (session || over) return;
      if (startTimer !== null) clock.clearTimeout(startTimer);
      startTimer = null;
      const language =
        clientLanguage ?? (b!.voiceLanguage || undefined) ?? installationLanguage ?? undefined;
      const synthesizer =
        mode === "browser"
          ? createTextSynthesizer({
              say: (text) => send({ type: "say", text }),
              sleep,
              rate: deps.textRate,
            })
          : playback.wrap(deps.synthesizer);
      session = new VoiceSession({
        vad: watchedVad,
        transcriber: {
          transcribe: (pcm, o) =>
            deps.transcriber
              .transcribe(pcm, { signal: o?.signal, language: o?.language })
              .then((t) => t.replace(/\s+/g, " ").trim().slice(0, 8000)),
        },
        synthesizer,
        follower,
        clock,
        emit: onEvent,
        language,
        voice: b!.voice || undefined,
        config: deps.session,
      });
      sendState("listening");
      for (const f of early.splice(0)) session.pushAudio(f);
    };
    // A client that never says `start` begins with the defaults.
    startTimer = clock.setTimeout(() => startSession(), VOICE_LIMITS.startGraceMs);

    const ping = () => {
      if (over) return;
      try {
        socket.ping();
      } catch {
        /* closed */
      }
      pingTimer = clock.setTimeout(ping, limits.pingMs);
    };
    pingTimer = clock.setTimeout(ping, limits.pingMs);

    return {
      id: row.id,
      message(data) {
        if (over) return;
        try {
          if (typeof data === "string" || !(data instanceof Uint8Array)) {
            const m = parseClientMessage(data);
            switch (m.type) {
              case "start":
                return startSession(m.language);
              case "mute":
                muted = true;
                return;
              case "unmute":
                muted = false;
                return;
              case "played":
                session?.reportPlayed(m.samples);
                return;
              case "end":
                return void end("hangup");
            }
          }
          const samples = parseAudioFrame(data);
          if (!samples || muted) return;
          for (const frame of inbound.push(samples)) {
            if (session) session.pushAudio(frame);
            else if (early.length < 100) early.push(frame);
          }
        } catch (e) {
          if (e instanceof VoiceProtocolError)
            send({ type: "error", code: e.code, message: "That message was not understood." });
          else send({ type: "error", code: "VOICE_ERROR", message: "Something went wrong." });
        }
      },
      closed() {
        void end("disconnected");
      },
    };
  }

  return {
    ticket,
    open,
    capabilities,
    /** Boot and every recovery tick: calls whose server is gone are marked failed. */
    recover: store.recover,
    store,
    /** How many calls are live on this instance. */
    get liveCalls() {
      return live.size;
    },
    /** Ends every live call (the server is stopping). */
    async endAll(reason: VoiceEndReason = "restart") {
      await Promise.all([...live.values()].map((c) => c.end(reason)));
    },
  };
}
export type VoiceService = ReturnType<typeof createVoiceService>;
