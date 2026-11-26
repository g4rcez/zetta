/**
 * The audio and messages of Telnyx's media stream (https://developers.telnyx.com/docs/voice/programmable-voice/media-streaming), for the
 * phone line: the codecs (L16 16 kHz is what is asked for; PCMU 8 kHz is converted with the helpers of the voice session), the order of
 * inbound chunks (the provider does not promise the order of events) and the JSON messages of the socket.
 */
import { SAMPLE_RATE, mulawDecode, mulawEncode, resample } from "../voice/core/audio";

export type WireCodec = "L16" | "PCMU";

/**
 * L16 is 16-bit linear audio in network byte order (big endian), 16 kHz. Telnyx's page names L16 but does not write the byte layout:
 * big endian is the RTP standard (RFC 3551) and what its decision document assumed.
 */
export function decodeAudio(payload: string, codec: WireCodec): Int16Array {
  const bytes = Uint8Array.from(Buffer.from(payload, "base64"));
  if (codec === "PCMU") return resample(mulawDecode(bytes), 8000, SAMPLE_RATE);
  const even = bytes.length - (bytes.length % 2);
  const out = new Int16Array(even / 2);
  const view = new DataView(bytes.buffer, bytes.byteOffset, even);
  for (let i = 0; i < out.length; i++) out[i] = view.getInt16(i * 2, false);
  return out;
}

/** 16 kHz samples as the base64 payload of one outgoing `media` message. */
export function encodeAudio(pcm: Int16Array, codec: WireCodec): string {
  if (codec === "PCMU")
    return Buffer.from(mulawEncode(resample(pcm, SAMPLE_RATE, 8000))).toString("base64");
  const out = new Uint8Array(pcm.length * 2);
  const view = new DataView(out.buffer);
  for (let i = 0; i < pcm.length; i++) view.setInt16(i * 2, pcm[i] ?? 0, false);
  return Buffer.from(out).toString("base64");
}

/** The codec the provider says the stream carries (`start.media_format`); the one asked for when it says nothing readable. */
export function codecOfFormat(format: unknown, fallback: WireCodec = "L16"): WireCodec {
  const f = format && typeof format === "object" ? (format as Record<string, unknown>) : {};
  const encoding = String(f.encoding ?? "").toUpperCase();
  // Twilio names the stream's audio "audio/x-mulaw" at 8 kHz; Telnyx says PCMU.
  if (encoding === "PCMU" || encoding.includes("MULAW")) return "PCMU";
  if (encoding === "L16") return "L16";
  return fallback;
}

export type WireMessage =
  | { event: "connected" }
  | {
      event: "start";
      codec: WireCodec | null;
      /** Telnyx: `stream_id`. Twilio: `streamSid`, which every message sent back must carry. */
      streamId: string;
      /** Twilio: the one-time stream token, which comes as a custom parameter of the stream (its address cannot carry a query). */
      token?: string;
    }
  | { event: "media"; track: string; chunk: number | null; payload: string }
  | { event: "stop" }
  | { event: "mark"; name: string }
  | { event: "dtmf"; digit: string }
  | { event: "error"; code: string }
  | { event: "other" };

const MAX_PAYLOAD_CHARS = 64 * 1024;

/** One text message of the socket; anything that does not parse is `other` (ignored), never an exception. */
export function parseWire(raw: unknown): WireMessage {
  if (typeof raw !== "string" || raw.length > MAX_PAYLOAD_CHARS * 2) return { event: "other" };
  let m: Record<string, unknown>;
  try {
    const v: unknown = JSON.parse(raw);
    if (!v || typeof v !== "object" || Array.isArray(v)) return { event: "other" };
    m = v as Record<string, unknown>;
  } catch {
    return { event: "other" };
  }
  const obj = (v: unknown): Record<string, unknown> =>
    v && typeof v === "object" && !Array.isArray(v) ? (v as Record<string, unknown>) : {};
  switch (m.event) {
    case "connected":
      return { event: "connected" };
    case "start": {
      const start = obj(m.start);
      const format = start.media_format ?? start.mediaFormat;
      const custom = obj(start.customParameters);
      return {
        event: "start",
        codec: format ? codecOfFormat(format) : null,
        streamId: String(m.stream_id ?? start.streamSid ?? m.streamSid ?? "").slice(0, 100),
        ...(typeof custom.token === "string" ? { token: custom.token.slice(0, 500) } : {}),
      };
    }
    case "media": {
      const media = obj(m.media);
      const payload = typeof media.payload === "string" ? media.payload : "";
      if (!payload || payload.length > MAX_PAYLOAD_CHARS) return { event: "other" };
      const chunk = Number(media.chunk);
      return {
        event: "media",
        track: String(media.track ?? "inbound"),
        chunk: Number.isInteger(chunk) && chunk >= 0 ? chunk : null,
        payload,
      };
    }
    case "stop":
      return { event: "stop" };
    case "dtmf": {
      const digit = String(obj(m.dtmf).digit ?? "");
      return /^[0-9*#A-D]$/.test(digit) ? { event: "dtmf", digit } : { event: "other" };
    }
    case "mark":
      return { event: "mark", name: String(obj(m.mark).name ?? "") };
    case "error":
      return { event: "error", code: String(obj(m.payload).code ?? "") };
    default:
      return { event: "other" };
  }
}

/** Twilio's messages carry the `streamSid` of the stream; Telnyx's do not. */
export const mediaMessage = (payload: string, streamSid?: string) =>
  JSON.stringify({ event: "media", ...(streamSid ? { streamSid } : {}), media: { payload } });
export const clearMessage = (streamSid?: string) =>
  JSON.stringify({ event: "clear", ...(streamSid ? { streamSid } : {}) });
export const CLEAR_MESSAGE = clearMessage();

/**
 * Puts inbound chunks in order. `chunk` counts media frames of the stream; one that arrives early waits for the ones before it, up to
 * `window` of them, and past that the gap is given up (a lost frame is a click, a stalled call is worse). A chunk older than the one
 * already passed on is dropped. Frames with no number pass straight through.
 */
export function createReorder<T>(window = 8) {
  let next: number | null = null;
  const held = new Map<number, T>();
  return {
    push(chunk: number | null, item: T): T[] {
      if (chunk === null) return [item];
      if (next === null) next = chunk;
      if (chunk < next) return [];
      held.set(chunk, item);
      const out: T[] = [];
      for (;;) {
        const got = held.get(next);
        if (got !== undefined) {
          held.delete(next);
          out.push(got);
          next++;
        } else if (held.size > window) {
          // Give up the missing one: continue from the oldest that arrived.
          next = Math.min(...held.keys());
        } else break;
      }
      return out;
    },
  };
}
