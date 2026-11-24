import { z } from "zod";

/**
 * The socket's protocol. Audio travels as binary frames: 16 kHz mono 16-bit little-endian samples, 20 ms (640 bytes) each, in both
 * directions. Everything else is a small JSON text message, listed here.
 */
export const VOICE_LIMITS = {
  /** A call ends after this long, whatever is said. */
  maxCallMs: 30 * 60_000,
  /** A call ends after this long without speech from either side (a bot that works on a task counts as speaking). */
  idleMs: 2 * 60_000,
  /** The server pings this often, so no proxy or idle timer cuts a quiet call. */
  pingMs: 20_000,
  /** The ticket of the socket expires this fast. */
  ticketMs: 30_000,
  /** A socket that never says `start` begins with the defaults after this long. */
  startGraceMs: 3_000,
  /** The largest binary message the server accepts: 100 ms of audio is 3,200 bytes, so this is generous. */
  maxFrameBytes: 16 * 1024,
  /** The largest text message. */
  maxTextBytes: 2 * 1024,
  /** Tickets one person can ask for per minute. */
  ticketsPerMinute: 12,
} as const;

/** What the person's side sends. */
export const clientMessage = z.discriminatedUnion("type", [
  /** The first message. `language` is the browser's ("pt-BR"); without it the bot's, then the installation's. */
  z.strictObject({ type: z.literal("start"), language: z.string().min(2).max(35).optional() }),
  z.strictObject({ type: z.literal("mute") }),
  z.strictObject({ type: z.literal("unmute") }),
  z.strictObject({ type: z.literal("end") }),
  /** How many samples of the current reply the player has played so far (what the person has really heard). */
  z.strictObject({ type: z.literal("played"), samples: z.number().int().min(0).max(100_000_000) }),
]);
export type ClientMessage = z.infer<typeof clientMessage>;

export type CallState = "listening" | "thinking" | "speaking" | "ended";

/** What the server sends as text. */
export type ServerMessage =
  | { type: "state"; state: CallState; reason?: string }
  | { type: "transcript"; text: string; final: boolean }
  /** `mode: "browser"`: the device speaks this sentence itself. */
  | { type: "say"; text: string }
  /** Drop every sample of the reply that has not been played yet, now. */
  | { type: "clear" }
  | { type: "error"; code: string; message: string };

/** Why a socket message was not understood. */
export class VoiceProtocolError extends Error {
  constructor(readonly code: "BAD_MESSAGE" | "TOO_BIG") {
    super(code);
  }
}

/** Parses one text message from the client. Throws `VoiceProtocolError` for anything that is not a known, well-formed message. */
export function parseClientMessage(raw: unknown): ClientMessage {
  let value = raw;
  if (typeof raw === "string") {
    if (raw.length > VOICE_LIMITS.maxTextBytes) throw new VoiceProtocolError("TOO_BIG");
    try {
      value = JSON.parse(raw);
    } catch {
      throw new VoiceProtocolError("BAD_MESSAGE");
    }
  }
  const parsed = clientMessage.safeParse(value);
  if (!parsed.success) throw new VoiceProtocolError("BAD_MESSAGE");
  return parsed.data;
}

/** One audio message: whole 16-bit samples, not larger than the limit. Returns the samples, or null when the message is no audio. */
export function parseAudioFrame(raw: unknown): Int16Array | null {
  if (!(raw instanceof Uint8Array)) return null;
  if (raw.byteLength > VOICE_LIMITS.maxFrameBytes) throw new VoiceProtocolError("TOO_BIG");
  if (raw.byteLength < 2 || raw.byteLength % 2 !== 0) throw new VoiceProtocolError("BAD_MESSAGE");
  const out = new Int16Array(raw.byteLength / 2);
  const view = new DataView(raw.buffer, raw.byteOffset, raw.byteLength);
  for (let i = 0; i < out.length; i++) out[i] = view.getInt16(i * 2, true);
  return out;
}
