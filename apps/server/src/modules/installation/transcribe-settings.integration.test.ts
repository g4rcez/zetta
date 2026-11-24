import { uuidv7 } from "@zetta/core/uuid";
import { afterAll, beforeEach, describe, expect, test } from "bun:test";
import { createDb } from "@zetta/db";
import { createApp } from "../../app";
import { createIdentityAccess } from "../identity/access";
import { TranscribeError, type Transcriber } from "../transcribe/transcriber";
import { createInstallationService } from "./service";

const url = process.env.ZETTA_CHAT_TEST_DATABASE_URL;
const suite = url ? describe : describe.skip;
const origin = "https://app.example.invalid";

suite("speech-to-text settings of the installation", () => {
  const db = createDb({ DATABASE_URL: url ?? "postgresql://unused@localhost/unused" } as never);
  const installation = createInstallationService(db);
  let transcriber: Transcriber = { transcribe: async () => "" };
  let keyState: "none" | "set" | "unavailable" = "none";
  let allowPrivate = false;
  const calls: string[] = [];
  const access = createIdentityAccess(
    {
      api: {
        getSession: async ({ headers }: { headers: Headers }) => {
          const id = headers.get("cookie");
          return id
            ? { user: { id, name: id, email: `${id}@example.invalid` }, session: { id: "s" } }
            : null;
        },
      },
    } as never,
    async (id) => ({ isAdmin: id.startsWith("admin") }),
  );
  // One app per test: the limit of the test button lives in it. The fakes below are read at call time.
  let cached: ReturnType<typeof createApp> | undefined;
  const app = () =>
    (cached ??= createApp({
      auth: { api: { getSession: async () => null }, handler: () => new Response("n/a") } as never,
      installation: {
        access,
        installation,
        runningMode: "local",
        transcriber: { transcribe: (pcm, o) => transcriber.transcribe(pcm, o) },
        transcribeKey: { state: async () => keyState },
        allowPrivate,
      },
      webOrigin: origin,
      desktopOrigins: [],
    }));
  const call = async (as: string, method: string, path: string, body?: unknown) => {
    const r = await app().handle(
      new Request(`http://localhost${path}`, {
        method,
        headers: { origin, cookie: as, "content-type": "application/json" },
        body: body ? JSON.stringify(body) : undefined,
      }),
    );
    return { status: r.status, json: (await r.json().catch(() => ({}))) as any };
  };
  const ADMIN = `admin-${uuidv7().slice(-8)}`;
  const MEMBER = `member-${uuidv7().slice(-8)}`;
  const patch = (body: unknown, as = ADMIN) => call(as, "PATCH", "/api/installation", body);
  const RESET = {
    transcribeProvider: "local",
    transcribeModel: "",
    transcribeLanguage: "",
    transcribeBaseUrl: "",
    transcribeConnectionId: null,
  } as const;
  beforeEach(async () => {
    cached = undefined;
    allowPrivate = false;
    keyState = "none";
    calls.length = 0;
    transcriber = { transcribe: async () => "" };
    await installation.update({ ...RESET });
  });
  afterAll(async () => {
    await installation.update({ ...RESET });
  });

  test("everybody reads the choice, nobody reads the connection of the key, and only an administrator changes it", async () => {
    const before = await call(MEMBER, "GET", "/api/installation");
    expect(before.status).toBe(200);
    expect(before.json).toMatchObject({
      transcribeProvider: "local",
      transcribeModel: "",
      transcribeLanguage: "",
      transcribeBaseUrl: "",
      transcribeKey: "none",
    });
    expect(Object.keys(before.json)).not.toContain("transcribeConnectionId");
    expect((await patch({ transcribeProvider: "openai" }, MEMBER)).status).toBe(403);
    const set = await patch({
      transcribeProvider: "openai",
      transcribeModel: "gpt-4o-mini-transcribe",
    });
    expect(set.status).toBe(200);
    expect(set.json).toMatchObject({
      transcribeProvider: "openai",
      transcribeModel: "gpt-4o-mini-transcribe",
    });
    keyState = "set";
    expect((await call(MEMBER, "GET", "/api/installation")).json.transcribeKey).toBe("set");
    keyState = "unavailable";
    expect((await call(MEMBER, "GET", "/api/installation")).json.transcribeKey).toBe("unavailable");
  });

  test("the key's connection cannot be set through the settings: it only comes with a sealed key", async () => {
    const r = await patch({ transcribeConnectionId: uuidv7() });
    expect(r.status).toBe(400);
  });

  test("the language is stored as its two-letter code, and one nobody speaks is refused", async () => {
    expect((await patch({ transcribeLanguage: "pt-BR" })).json.transcribeLanguage).toBe("pt");
    expect((await patch({ transcribeLanguage: "Spanish" })).json.transcribeLanguage).toBe("es");
    expect((await patch({ transcribeLanguage: "" })).json.transcribeLanguage).toBe("");
    expect((await patch({ transcribeLanguage: "klingon" })).status).toBe(400);
    expect((await patch({ transcribeModel: "bad model; rm -rf" })).status).toBe(400);
    expect((await patch({ transcribeProvider: "elevenlabs" })).status).toBe(400);
  });

  test("a custom provider needs an https address that is not on a private network", async () => {
    const no = await patch({ transcribeProvider: "compatible" });
    expect(no.status).toBe(400);
    expect(no.json.error.message).toContain("needs its address");
    for (const bad of [
      "http://93.184.216.34/v1",
      "https://10.0.0.5/v1",
      "https://127.0.0.1/v1",
      "https://user:pass@93.184.216.34/v1",
      "https://93.184.216.34/v1?key=1",
      "ftp://93.184.216.34/v1",
      "not a url",
    ])
      expect(
        (await patch({ transcribeProvider: "compatible", transcribeBaseUrl: bad })).status,
      ).toBe(400);
    const ok = await patch({
      transcribeProvider: "compatible",
      transcribeBaseUrl: "https://93.184.216.34/v1",
    });
    expect(ok.status).toBe(200);
    expect(ok.json.transcribeBaseUrl).toBe("https://93.184.216.34/v1");
  });

  test("with private networks allowed by the operator, a provider on the local network works over http", async () => {
    allowPrivate = true;
    cached = undefined;
    const r = await patch({
      transcribeProvider: "compatible",
      transcribeBaseUrl: "http://127.0.0.1:9000/v1",
    });
    expect(r.status).toBe(200);
    expect(r.json.transcribeBaseUrl).toBe("http://127.0.0.1:9000/v1");
  });

  test("going back to the server model or to OpenAI drops the address of a custom provider", async () => {
    await patch({
      transcribeProvider: "compatible",
      transcribeBaseUrl: "https://93.184.216.34/v1",
    });
    const back = await patch({ transcribeProvider: "openai" });
    expect(back.json).toMatchObject({ transcribeProvider: "openai", transcribeBaseUrl: "" });
    expect((await installation.load()).transcribeBaseUrl).toBe("");
  });

  test("the test button: an administrator only, says whether it worked in the sentence of the error, and is limited", async () => {
    expect((await call(MEMBER, "POST", "/api/installation/transcribe/test")).status).toBe(403);
    transcriber = { transcribe: async (pcm) => (calls.push(`${pcm.length}`), "") };
    expect((await call(ADMIN, "POST", "/api/installation/transcribe/test")).json).toEqual({
      ok: true,
      provider: "local",
    });
    expect(calls).toEqual(["16000"]);
    transcriber = {
      transcribe: async () => {
        throw new TranscribeError(
          "PROVIDER_AUTH",
          "The speech-to-text provider did not accept the API key.",
        );
      },
    };
    const bad = await call(ADMIN, "POST", "/api/installation/transcribe/test");
    expect(bad.status).toBe(200);
    expect(bad.json).toEqual({
      ok: false,
      message: "The speech-to-text provider did not accept the API key.",
    });
    transcriber = {
      transcribe: async () => {
        throw new Error("secret detail sk-test-0123456789");
      },
    };
    const odd = await call(ADMIN, "POST", "/api/installation/transcribe/test");
    expect(JSON.stringify(odd.json)).not.toContain("sk-test");
    expect(odd.json.ok).toBe(false);
    // Six a minute, then a pause.
    for (let i = 0; i < 4; i++) await call(ADMIN, "POST", "/api/installation/transcribe/test");
    const limited = await call(ADMIN, "POST", "/api/installation/transcribe/test");
    expect(limited.json.message).toContain("Wait a minute");
  });
});
