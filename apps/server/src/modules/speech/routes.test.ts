import { beforeEach, describe, expect, test } from "bun:test";
import { DEFAULT_MAIL_SETTINGS } from "@zetta/core/mail-provision";
import { DEFAULT_PHONE_SETTINGS, DEFAULT_PHONE_TWILIO_SETTINGS } from "@zetta/core/phone";
import { DEFAULT_SPEECH_SETTINGS } from "@zetta/core/speech";
import { createApp } from "../../app";
import { InvalidInstallationError, type InstallationSettings } from "../installation/service";
import { createIdentityAccess } from "../identity/access";
import { createConfiguredSynthesizer } from "./configured";
import { SpeechError } from "./errors";
import { LISTEN_MAX_CHARS, SPEECH_PER_MINUTE, listenText } from "./routes";

const origin = "https://app.example.invalid";
const KEY = "sk-test-0123456789abcdef";
let saved: InstallationSettings;
let keyState: "none" | "set" | "unavailable" = "none";
let synthCalls: { text: string; voice?: string; language?: string }[] = [];
let synthFails: SpeechError | null = null;

const reset = () => {
  saved = {
    networkMode: "local",
    publicUrl: null,
    onboarding: "pending",
    laya: "off",
    layaLanguages: ["en"],
    transcribeProvider: "local",
    transcribeModel: "",
    transcribeLanguage: "",
    transcribeBaseUrl: "",
    transcribeConnectionId: null,
    ...DEFAULT_SPEECH_SETTINGS,
    speechConnectionId: "c0000000-0000-7000-8000-000000000001",
    ...DEFAULT_MAIL_SETTINGS,
    mailConnectionId: null,
    mailCursor: null,
    ...DEFAULT_PHONE_SETTINGS,
    ...DEFAULT_PHONE_TWILIO_SETTINGS,
    phoneConnectionId: null,
    phoneTwilioConnectionId: null,
    wahaConnectionId: null,
    pushPublicKey: null,
    pushConnectionId: null,
    updateCheck: "on",
  };
  keyState = "none";
  synthCalls = [];
  synthFails = null;
};

const auth = {
  api: {
    getSession: async ({ headers }: { headers: Headers }) => {
      const id = headers.get("cookie");
      return id
        ? { user: { id, name: id, email: `${id}@example.invalid` }, session: { id: "s" } }
        : null;
    },
  },
  handler: () => new Response("auth"),
};
const access = createIdentityAccess(auth, async (id) => ({ isAdmin: id === "admin" }));
const installation = {
  load: async () => saved,
  update: async (patch: Partial<InstallationSettings>) => {
    const next = { ...saved, ...patch };
    if (next.speechProvider === "compatible" && !next.speechBaseUrl)
      throw new InvalidInstallationError("A custom speech provider needs its address.");
    return (saved = next);
  },
};
// A synthesizer that answers one second of audio (or fails) without a network, behind the real configured one for `mode`.
const real = createConfiguredSynthesizer({
  settings: async () => saved,
  key: async () => Buffer.from(KEY),
  fetch: (async () => new Response(new Uint8Array(0))) as never,
});
const synthesizer = {
  ...real,
  synthesize: async (text: string, o?: { voice?: string; language?: string }) => {
    synthCalls.push({ text, ...o });
    if (synthFails) throw synthFails;
    return new Int16Array(16000).fill(7);
  },
};
const BOT = "0192f000-0000-7000-8000-000000000042";
const app = () =>
  createApp({
    auth,
    installation: {
      access,
      installation,
      runningMode: "local",
      speech: { synthesizer, key: { state: async () => keyState } },
      allowPrivate: false,
    },
    speech: {
      access,
      speech: synthesizer,
      // The voice saved on a bot: only this one bot has one, for this one person.
      botVoice: async (userId, botId) =>
        userId === "member" && botId === BOT ? { voice: "shimmer", language: "pt-BR" } : undefined,
    },
    webOrigin: origin,
    desktopOrigins: [],
  });
const send = (
  a: ReturnType<typeof app>,
  as: string | null,
  method: string,
  path: string,
  body?: unknown,
  headers: Record<string, string> = {},
) =>
  a.handle(
    new Request(`http://localhost${path}`, {
      method,
      headers: {
        origin,
        ...(as ? { cookie: as } : {}),
        "content-type": "application/json",
        ...headers,
      },
      body: body === undefined ? undefined : JSON.stringify(body),
    }),
  );
beforeEach(reset);

describe("POST /api/speech", () => {
  test("the browser choice answers text, never audio", async () => {
    const a = app();
    const r = await send(a, "member", "POST", "/api/speech", { text: "Hello **there**. See `x`." });
    expect(r.status).toBe(200);
    expect(await r.json()).toEqual({
      mode: "browser",
      text: "Hello there. See.",
      truncated: false,
    });
    expect(synthCalls).toEqual([]);
  });

  test("a provider answers a wav of 16 kHz mono audio, with the bot's voice and language", async () => {
    saved = { ...saved, speechProvider: "openai" };
    const r = await send(app(), "member", "POST", "/api/speech", {
      text: "Olá. Tudo bem?",
      voice: "nova",
      language: "pt-BR",
    });
    expect(r.status).toBe(200);
    expect(r.headers.get("content-type")).toMatch(/^audio\/(x-)?wav/);
    expect(r.headers.get("cache-control")).toBe("no-store");
    const bytes = new Uint8Array(await r.arrayBuffer());
    expect(String.fromCharCode(...bytes.slice(0, 4))).toBe("RIFF");
    expect(bytes.length).toBe(44 + 32000);
    expect(synthCalls).toEqual([{ text: "Olá. Tudo bem?", voice: "nova", language: "pt-BR" }]);
  });

  test("a bot's saved voice is used when no voice is given, and an explicit voice wins", async () => {
    saved = { ...saved, speechProvider: "openai" };
    await send(app(), "member", "POST", "/api/speech", { text: "Olá.", botId: BOT });
    expect(synthCalls.at(-1)).toEqual({ text: "Olá.", voice: "shimmer", language: "pt-BR" });
    await send(app(), "member", "POST", "/api/speech", { text: "Olá.", botId: BOT, voice: "nova" });
    expect(synthCalls.at(-1)).toMatchObject({ voice: "nova" });
    // A bot the person may not see, or one with no saved voice, changes nothing.
    await send(app(), "other", "POST", "/api/speech", { text: "Olá.", botId: BOT });
    expect(synthCalls.at(-1)).toEqual({ text: "Olá.", voice: undefined, language: undefined });
    expect(
      (await send(app(), "member", "POST", "/api/speech", { text: "Olá.", botId: "nope" })).status,
    ).toBe(400);
  });

  test("off is a conflict, a signed-out caller and a foreign origin are refused", async () => {
    saved = { ...saved, speechProvider: "off" };
    expect((await send(app(), "member", "POST", "/api/speech", { text: "hi" })).status).toBe(409);
    expect((await send(app(), null, "POST", "/api/speech", { text: "hi" })).status).toBe(401);
    expect(
      (
        await send(
          app(),
          "member",
          "POST",
          "/api/speech",
          { text: "hi" },
          { origin: "https://evil.example.invalid" },
        )
      ).status,
    ).toBe(403);
  });

  test("bad input: empty, too long, unknown field, bad voice, nothing speakable", async () => {
    const a = app();
    expect((await send(a, "member", "POST", "/api/speech", { text: "" })).status).toBe(400);
    expect(
      (await send(a, "member", "POST", "/api/speech", { text: "x".repeat(20_001) })).status,
    ).toBe(400);
    expect((await send(a, "member", "POST", "/api/speech", { text: "hi", extra: 1 })).status).toBe(
      400,
    );
    expect(
      (await send(a, "member", "POST", "/api/speech", { text: "hi", voice: "a b;c" })).status,
    ).toBe(400);
    expect((await send(a, "member", "POST", "/api/speech", { text: "```js\nx\n```" })).status).toBe(
      400,
    );
  });

  test("a provider error is a fixed sentence", async () => {
    saved = { ...saved, speechProvider: "openai" };
    synthFails = new SpeechError(
      "PROVIDER_AUTH",
      "The text-to-speech provider did not accept the API key.",
    );
    const r = await send(app(), "member", "POST", "/api/speech", { text: "hi" });
    expect(r.status).toBe(502);
    expect(JSON.stringify(await r.json())).not.toContain(KEY);
  });

  test("at most 20 a minute per person, and per person", async () => {
    const a = app();
    for (let i = 0; i < SPEECH_PER_MINUTE; i++)
      expect((await send(a, "member", "POST", "/api/speech", { text: "hi" })).status).toBe(200);
    expect((await send(a, "member", "POST", "/api/speech", { text: "hi" })).status).toBe(429);
    expect((await send(a, "other", "POST", "/api/speech", { text: "hi" })).status).toBe(200);
  });

  test("a long message is cut at the end of a sentence", () => {
    const sentence = "This is one sentence of a fair length to count. ";
    const r = listenText(sentence.repeat(100));
    expect(r.truncated).toBe(true);
    expect(r.text.length).toBeLessThanOrEqual(LISTEN_MAX_CHARS);
    expect(r.text.endsWith(".")).toBe(true);
    expect(listenText("x".repeat(5000)).text.length).toBe(LISTEN_MAX_CHARS);
  });
});

describe("installation settings for text to speech", () => {
  const get = async (a: ReturnType<typeof app>, as = "member") =>
    (await (await send(a, as, "GET", "/api/installation")).json()) as Record<string, unknown>;

  test("the settings and the key state are shown, the key and its id never", async () => {
    keyState = "set";
    const body = await get(app());
    expect(body.speechProvider).toBe("browser");
    expect(body.speechKey).toBe("set");
    expect(JSON.stringify(body)).not.toContain("c0000000");
    expect(body).not.toHaveProperty("speechConnectionId");
  });

  test("only an administrator changes them; values are checked", async () => {
    const a = app();
    expect(
      (await send(a, "member", "PATCH", "/api/installation", { speechProvider: "openai" })).status,
    ).toBe(403);
    expect(
      (await send(a, "admin", "PATCH", "/api/installation", { speechProvider: "nope" })).status,
    ).toBe(400);
    expect(
      (await send(a, "admin", "PATCH", "/api/installation", { speechVoice: "a b" })).status,
    ).toBe(400);
    expect(
      (await send(a, "admin", "PATCH", "/api/installation", { speechLanguage: "klingon-xx" }))
        .status,
    ).toBe(400);
    expect(
      (await send(a, "admin", "PATCH", "/api/installation", { speechProvider: "compatible" }))
        .status,
    ).toBe(400);
    const ok = await send(a, "admin", "PATCH", "/api/installation", {
      speechProvider: "elevenlabs",
      speechModel: "eleven_flash_v2_5",
      speechVoice: "VOICE123",
      speechLanguage: "pt-BR",
    });
    expect(ok.status).toBe(200);
    expect(saved).toMatchObject({
      speechProvider: "elevenlabs",
      speechVoice: "VOICE123",
      speechLanguage: "pt",
    });
  });

  test("the address of a custom provider must be https and not private, unless the operator allowed it", async () => {
    const a = app();
    const patch = (url: string) =>
      send(a, "admin", "PATCH", "/api/installation", {
        speechProvider: "compatible",
        speechBaseUrl: url,
      });
    expect((await patch("http://tts.example.invalid/v1")).status).toBe(400);
    expect((await patch("https://user:pw@tts.example.invalid/v1")).status).toBe(400);
    expect((await patch("https://127.0.0.1/v1")).status).toBe(400);
    expect((await patch("not a url")).status).toBe(400);
  });

  test("Test: administrators only, speaks one sentence, fixed sentences on failure, rate limited", async () => {
    const a = app();
    expect((await send(a, "member", "POST", "/api/installation/speech/test")).status).toBe(403);
    expect(
      await (await send(a, "admin", "POST", "/api/installation/speech/test")).json(),
    ).toMatchObject({ ok: true, provider: "browser" });
    expect(synthCalls).toEqual([]);
    saved = { ...saved, speechProvider: "openai" };
    expect(await (await send(a, "admin", "POST", "/api/installation/speech/test")).json()).toEqual({
      ok: true,
      provider: "openai",
      seconds: 1,
    });
    expect(synthCalls).toHaveLength(1);
    synthFails = new SpeechError("PROVIDER_AUTH", "Fixed sentence.");
    expect(await (await send(a, "admin", "POST", "/api/installation/speech/test")).json()).toEqual({
      ok: false,
      message: "Fixed sentence.",
    });
    saved = { ...saved, speechProvider: "off" };
    expect(
      (
        (await (await send(a, "admin", "POST", "/api/installation/speech/test")).json()) as {
          ok: boolean;
        }
      ).ok,
    ).toBe(false);
    for (let i = 0; i < 6; i++) await send(a, "admin", "POST", "/api/installation/speech/test");
    expect(
      (
        (await (await send(a, "admin", "POST", "/api/installation/speech/test")).json()) as {
          message: string;
        }
      ).message,
    ).toContain("a lot of tests");
  });
});
