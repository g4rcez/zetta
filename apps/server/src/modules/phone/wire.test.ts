import { describe, expect, test } from "bun:test";
import { pcm16ToBytes } from "../voice/core/audio";
import { tone } from "../voice/core/test-audio";
import {
  clearMessage,
  codecOfFormat,
  createReorder,
  decodeAudio,
  encodeAudio,
  mediaMessage,
  parseWire,
} from "./wire";

describe("audio", () => {
  test("L16 is big endian 16 kHz and round-trips", () => {
    const pcm = tone(60, 0.3);
    const payload = encodeAudio(pcm, "L16");
    const bytes = Buffer.from(payload, "base64");
    expect(bytes.length).toBe(pcm.length * 2);
    expect(bytes.readInt16BE(2 * 5)).toBe(pcm[5]!);
    expect([...decodeAudio(payload, "L16")]).toEqual([...pcm]);
    // not the little endian layout of the web socket
    expect(Buffer.from(pcm16ToBytes(pcm)).equals(bytes)).toBe(false);
  });
  test("PCMU is 8 kHz mu-law, converted to 16 kHz at the edge", () => {
    const pcm = tone(100, 0.3);
    const payload = encodeAudio(pcm, "PCMU");
    expect(Buffer.from(payload, "base64").length).toBe(800); // 100 ms at 8 kHz, one byte each
    const back = decodeAudio(payload, "PCMU");
    expect(back.length).toBe(pcm.length);
    let err = 0;
    for (let i = 10; i < back.length - 10; i++) err = Math.max(err, Math.abs(back[i]! - pcm[i]!));
    expect(err).toBeLessThan(2500);
  });
  test("the codec comes from the stream's own description", () => {
    expect(codecOfFormat({ encoding: "PCMU", sample_rate: 8000 })).toBe("PCMU");
    expect(codecOfFormat({ encoding: "L16", sample_rate: 16000 })).toBe("L16");
    expect(codecOfFormat(undefined)).toBe("L16");
  });
});

describe("messages", () => {
  test("a media message is read, anything odd is ignored", () => {
    expect(
      parseWire(
        JSON.stringify({
          event: "media",
          media: { track: "inbound", chunk: "2", payload: "AAA=" },
        }),
      ),
    ).toEqual({ event: "media", track: "inbound", chunk: 2, payload: "AAA=" });
    expect(
      parseWire(
        JSON.stringify({ event: "media", media: { track: "inbound", chunk: 2, payload: "AAA=" } }),
      ),
    ).toEqual({ event: "media", track: "inbound", chunk: 2, payload: "AAA=" });
    expect(parseWire("not json")).toEqual({ event: "other" });
    expect(parseWire(JSON.stringify([1]))).toEqual({ event: "other" });
    expect(parseWire(JSON.stringify({ event: "media", media: {} }))).toEqual({ event: "other" });
    expect(parseWire(JSON.stringify({ event: "stop" }))).toEqual({ event: "stop" });
    expect(
      parseWire(
        JSON.stringify({
          event: "start",
          start: { media_format: { encoding: "PCMU" } },
          stream_id: "s",
        }),
      ),
    ).toEqual({ event: "start", codec: "PCMU", streamId: "s" });
  });
});

describe("Twilio's media stream messages", () => {
  const start = {
    event: "start",
    sequenceNumber: "1",
    start: {
      accountSid: `AC${"0".repeat(32)}`,
      streamSid: "MZ00000000000000000000000000000000",
      callSid: "CA00000000000000000000000000000000",
      tracks: ["inbound"],
      mediaFormat: { encoding: "audio/x-mulaw", sampleRate: 8000, channels: 1 },
      customParameters: { token: "one-time" },
    },
    streamSid: "MZ00000000000000000000000000000000",
  };
  test("start gives the codec, the stream sid and the token of the custom parameters", () => {
    expect(parseWire(JSON.stringify(start))).toEqual({
      event: "start",
      codec: "PCMU",
      streamId: "MZ00000000000000000000000000000000",
      token: "one-time",
    });
    expect(codecOfFormat({ encoding: "audio/x-mulaw", sampleRate: 8000 })).toBe("PCMU");
  });
  test("a token that is not text is dropped", () => {
    const m = parseWire(
      JSON.stringify({ ...start, start: { ...start.start, customParameters: { token: 5 } } }),
    );
    expect(m.event === "start" && m.token).toBe(undefined);
  });
  test("media has string counters and a track", () => {
    expect(
      parseWire(
        JSON.stringify({
          event: "media",
          sequenceNumber: "4",
          media: { track: "inbound", chunk: "2", timestamp: "5", payload: "AAA=" },
          streamSid: "MZ1",
        }),
      ),
    ).toEqual({ event: "media", track: "inbound", chunk: 2, payload: "AAA=" });
  });
  test("a key press is read; anything that is not a key is ignored", () => {
    const dtmf = (digit: unknown) =>
      parseWire(
        JSON.stringify({ event: "dtmf", streamSid: "MZ1", dtmf: { track: "inbound", digit } }),
      );
    expect(dtmf("5")).toEqual({ event: "dtmf", digit: "5" });
    expect(dtmf("#")).toEqual({ event: "dtmf", digit: "#" });
    expect(dtmf("55")).toEqual({ event: "other" });
    expect(dtmf("")).toEqual({ event: "other" });
    expect(dtmf(undefined)).toEqual({ event: "other" });
  });
  test("a mark and a stop are read", () => {
    expect(parseWire(JSON.stringify({ event: "mark", mark: { name: "done" } }))).toEqual({
      event: "mark",
      name: "done",
    });
    expect(parseWire(JSON.stringify({ event: "stop", stop: { callSid: "CA1" } }))).toEqual({
      event: "stop",
    });
  });
  test("what is sent back carries the stream sid, and Telnyx's shape does not", () => {
    expect(JSON.parse(mediaMessage("AAA=", "MZ1"))).toEqual({
      event: "media",
      streamSid: "MZ1",
      media: { payload: "AAA=" },
    });
    expect(JSON.parse(clearMessage("MZ1"))).toEqual({ event: "clear", streamSid: "MZ1" });
    expect(JSON.parse(mediaMessage("AAA="))).toEqual({
      event: "media",
      media: { payload: "AAA=" },
    });
    expect(JSON.parse(clearMessage())).toEqual({ event: "clear" });
  });
});

describe("order of chunks", () => {
  test("an early chunk waits for the ones before it; an old one is dropped", () => {
    const r = createReorder<string>();
    expect(r.push(1, "a")).toEqual(["a"]);
    expect(r.push(3, "c")).toEqual([]);
    expect(r.push(2, "b")).toEqual(["b", "c"]);
    expect(r.push(2, "again")).toEqual([]);
    expect(r.push(null, "x")).toEqual(["x"]);
  });
  test("a chunk that never comes is given up, so the call does not stall", () => {
    const r = createReorder<number>(3);
    r.push(1, 1);
    const got: number[] = [];
    for (let c = 3; c <= 8; c++) got.push(...r.push(c, c));
    expect(got).toEqual([3, 4, 5, 6, 7, 8]);
  });
});
