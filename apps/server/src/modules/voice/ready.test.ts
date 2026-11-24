import { describe, expect, test } from "bun:test";
import type { SpeechSettings } from "@zetta/core/speech";
import type { InstallationKeyState } from "../connections/installation-key";
import type { TranscribeSettings } from "../transcribe/configured";
import { createVoiceReadiness } from "./ready";

const base: TranscribeSettings & SpeechSettings = {
  transcribeProvider: "local",
  transcribeModel: "",
  transcribeLanguage: "",
  transcribeBaseUrl: "",
  transcribeConnectionId: null,
  speechProvider: "browser",
  speechBaseUrl: "",
  speechModel: "",
  speechVoice: "",
  speechLanguage: "",
};
const ready = (
  over: Partial<typeof base>,
  keys: { stt?: InstallationKeyState; tts?: InstallationKeyState } = {},
) =>
  createVoiceReadiness({
    settings: async () => ({ ...base, ...over }),
    transcribeKey: async () => keys.stt ?? "none",
    speechKey: async () => keys.tts ?? "none",
  })();

describe("voice readiness", () => {
  test("local speech to text and the browser's voice need nothing else", async () => {
    expect(await ready({})).toBe(true);
  });
  test("speech to text off, or speech off, turns voice off", async () => {
    expect(await ready({ transcribeProvider: "off" })).toBe(false);
    // Even a saved key does not bring it back: `off` is a choice, not a missing key.
    expect(await ready({ transcribeProvider: "off" }, { stt: "set" })).toBe(false);
    expect(await ready({ speechProvider: "off" })).toBe(false);
  });
  test("the local voice needs no key, and only the provider decides: the removed variables change nothing", async () => {
    expect(await ready({ speechProvider: "local" })).toBe(true);
    process.env.ZETTA_SPEECH_LOCAL = "off";
    process.env.ZETTA_TRANSCRIBE = "off";
    try {
      expect(await ready({ speechProvider: "local" })).toBe(true);
      expect(await ready({})).toBe(true);
    } finally {
      delete process.env.ZETTA_SPEECH_LOCAL;
      delete process.env.ZETTA_TRANSCRIBE;
    }
  });
  test("a provider for hearing needs its key (and an address when it is a compatible server)", async () => {
    expect(await ready({ transcribeProvider: "openai" })).toBe(false);
    expect(await ready({ transcribeProvider: "openai" }, { stt: "set" })).toBe(true);
    expect(await ready({ transcribeProvider: "openai" }, { stt: "unavailable" })).toBe(false);
    expect(await ready({ transcribeProvider: "compatible" }, { stt: "set" })).toBe(false);
    expect(
      await ready(
        { transcribeProvider: "compatible", transcribeBaseUrl: "https://stt.example.invalid" },
        { stt: "set" },
      ),
    ).toBe(true);
  });
  test("a provider for speaking needs its key (and an address when it is a compatible server)", async () => {
    expect(await ready({ speechProvider: "openai" })).toBe(false);
    expect(await ready({ speechProvider: "openai" }, { tts: "set" })).toBe(true);
    expect(await ready({ speechProvider: "elevenlabs" }, { tts: "set" })).toBe(true);
    expect(await ready({ speechProvider: "compatible" }, { tts: "set" })).toBe(false);
    expect(
      await ready(
        { speechProvider: "compatible", speechBaseUrl: "https://tts.example.invalid" },
        { tts: "set" },
      ),
    ).toBe(true);
  });
});
