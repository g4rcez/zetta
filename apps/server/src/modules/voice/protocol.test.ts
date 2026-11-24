import { describe, expect, test } from "bun:test";
import { parseAudioFrame, parseClientMessage, VOICE_LIMITS, VoiceProtocolError } from "./protocol";

describe("control messages from the client", () => {
  test("every known message is accepted, as text or as an already parsed object", () => {
    expect(parseClientMessage('{"type":"start","language":"pt-BR"}')).toEqual({
      type: "start",
      language: "pt-BR",
    });
    expect(parseClientMessage({ type: "start" })).toEqual({ type: "start" });
    expect(parseClientMessage('{"type":"mute"}')).toEqual({ type: "mute" });
    expect(parseClientMessage({ type: "unmute" })).toEqual({ type: "unmute" });
    expect(parseClientMessage({ type: "end" })).toEqual({ type: "end" });
    expect(parseClientMessage({ type: "played", samples: 16000 })).toEqual({
      type: "played",
      samples: 16000,
    });
  });

  test.each([
    ["not json", "{nope"],
    ["an unknown type", { type: "shout" }],
    ["no type", { language: "en" }],
    ["an extra field", { type: "end", now: true }],
    ["a language that is too short", { type: "start", language: "x" }],
    ["a language that is too long", { type: "start", language: "x".repeat(36) }],
    ["negative samples", { type: "played", samples: -1 }],
    ["fractional samples", { type: "played", samples: 1.5 }],
    ["text samples", { type: "played", samples: "10" }],
    ["an array", []],
    ["null", null],
  ])("%s is refused", (_name, raw) => {
    expect(() => parseClientMessage(raw)).toThrow(VoiceProtocolError);
  });

  test("a text message over the limit is refused before it is parsed", () => {
    const big = JSON.stringify({ type: "start", language: "x".repeat(VOICE_LIMITS.maxTextBytes) });
    expect(() => parseClientMessage(big)).toThrow(/TOO_BIG/);
  });
});

describe("audio frames", () => {
  test("640 bytes are 320 little-endian samples", () => {
    const bytes = new Uint8Array(640);
    const view = new DataView(bytes.buffer);
    view.setInt16(0, 1000, true);
    view.setInt16(2, -2, true);
    const samples = parseAudioFrame(bytes)!;
    expect(samples.length).toBe(320);
    expect([samples[0], samples[1]]).toEqual([1000, -2]);
  });

  test("a view into a larger buffer is read from its own offset", () => {
    const backing = new Uint8Array(1000);
    new DataView(backing.buffer).setInt16(100, 7, true);
    expect(parseAudioFrame(backing.subarray(100, 740))![0]).toBe(7);
  });

  test("anything that is not bytes is not audio", () => {
    expect(parseAudioFrame("text")).toBeNull();
    expect(parseAudioFrame({ type: "end" })).toBeNull();
  });

  test("an odd length or an empty message is refused, and so is one over the limit", () => {
    expect(() => parseAudioFrame(new Uint8Array(641))).toThrow(/BAD_MESSAGE/);
    expect(() => parseAudioFrame(new Uint8Array(0))).toThrow(/BAD_MESSAGE/);
    expect(() => parseAudioFrame(new Uint8Array(VOICE_LIMITS.maxFrameBytes + 2))).toThrow(
      /TOO_BIG/,
    );
  });
});
