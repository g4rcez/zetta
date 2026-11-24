import { describe, expect, test } from "bun:test";
import { DEFAULT_MAIL_SETTINGS } from "@zetta/core/mail-provision";
import { DEFAULT_PHONE_SETTINGS, DEFAULT_PHONE_TWILIO_SETTINGS } from "@zetta/core/phone";
import { DEFAULT_SPEECH_SETTINGS } from "@zetta/core/speech";
import { createApp } from "../../app";
import { createIdentityAccess } from "../identity/access";
import type { UpdateChecker } from "../updates/checker";
import type { InstallationSettings } from "./service";
import type { InstallationServices } from "./routes";

const origin = "https://app.example.invalid";

function app(updates?: UpdateChecker, extra: Partial<InstallationServices> = {}) {
  let saved: InstallationSettings = {
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
    speechConnectionId: null,
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
  const auth = {
    api: {
      getSession: async ({ headers }: { headers: Headers }) => {
        const id = headers.get("cookie");
        return id
          ? {
              user: { id, name: "Fixture", email: "fixture@example.invalid" },
              session: { id: "s" },
            }
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
      if (next.networkMode === "network" && !next.publicUrl)
        throw new (await import("./service")).InvalidInstallationError("url");
      return (saved = next);
    },
  };
  return createApp({
    auth,
    installation: {
      access,
      installation,
      runningMode: "local",
      ...(updates ? { updates } : {}),
      ...extra,
    },
    webOrigin: origin,
    desktopOrigins: [],
  });
}
const patch = (a: ReturnType<typeof app>, user: string, body: unknown) =>
  a.handle(
    new Request("http://localhost/api/installation", {
      method: "PATCH",
      headers: { origin, cookie: user, "content-type": "application/json" },
      body: JSON.stringify(body),
    }),
  );

describe("installation settings", () => {
  test("members read settings and see that a mode change needs a restart", async () => {
    const a = app();
    await patch(a, "admin", { networkMode: "network", publicUrl: "https://zetta.example.invalid" });
    const response = await a.handle(
      new Request("http://localhost/api/installation", { headers: { cookie: "member" } }),
    );
    expect(await response.json()).toEqual({
      networkMode: "network",
      publicUrl: "https://zetta.example.invalid",
      onboarding: "pending",
      laya: "off",
      layaLanguages: ["en"],
      layaModel: "english",
      transcribeProvider: "local",
      transcribeModel: "",
      transcribeLanguage: "",
      transcribeBaseUrl: "",
      transcribeKey: "none",
      // Speech out starts on the device's own voice; push has no key yet. The ids of the sealed keys are never in the answer.
      ...DEFAULT_SPEECH_SETTINGS,
      // Bot addresses start off, with no key; the cursor of the poller is never in the answer.
      ...DEFAULT_MAIL_SETTINGS,
      // Phone numbers start off, with no key; the id of the key's connection is never in the answer.
      ...DEFAULT_PHONE_SETTINGS,
      ...DEFAULT_PHONE_TWILIO_SETTINGS,
      phoneKey: "none",
      phoneTwilioKey: "none",
      wahaKey: "none",
      mailKey: "none",
      speechKey: "none",
      pushPublicKey: null,
      updateCheck: "on",
      restartRequired: true,
    });
  });
  test("only an administrator can turn Laya on, with a valid value", async () => {
    const a = app();
    const read = async () =>
      (
        (await (
          await a.handle(
            new Request("http://localhost/api/installation", { headers: { cookie: "member" } }),
          )
        ).json()) as { laya: string }
      ).laya;
    expect(await read()).toBe("off");
    expect((await patch(a, "member", { laya: "on" })).status).toBe(403);
    expect((await patch(a, "admin", { laya: "maybe" })).status).toBe(400);
    expect((await patch(a, "admin", { laya: "on" })).status).toBe(200);
    expect(await read()).toBe("on");
  });
  test("Laya languages: other languages select the multilingual model, bad tags are refused", async () => {
    const a = app();
    const read = async () =>
      (await (
        await a.handle(
          new Request("http://localhost/api/installation", { headers: { cookie: "member" } }),
        )
      ).json()) as { layaLanguages: string[]; layaModel: string };
    expect((await patch(a, "member", { layaLanguages: ["en", "pt-BR"] })).status).toBe(403);
    expect((await patch(a, "admin", { layaLanguages: ["pt_BR"] })).status).toBe(400);
    expect((await patch(a, "admin", { layaLanguages: ["en", "pt-BR"] })).status).toBe(200);
    expect(await read()).toMatchObject({
      layaLanguages: ["en", "pt-BR"],
      layaModel: "multilingual",
    });
    expect((await patch(a, "admin", { layaLanguages: ["en"] })).status).toBe(200);
    expect(await read()).toMatchObject({ layaLanguages: ["en"], layaModel: "english" });
  });
  test("only the admin changes settings", async () => {
    expect((await patch(app(), "member", { onboarding: "done" })).status).toBe(403);
  });
  test("network mode needs an https URL", async () => {
    expect((await patch(app(), "admin", { networkMode: "network" })).status).toBe(400);
    expect(
      (
        await patch(app(), "admin", {
          networkMode: "network",
          publicUrl: "http://zetta.example.invalid",
        })
      ).status,
    ).toBe(400);
  });
  test("only an administrator turns the update check off, with a valid value", async () => {
    const a = app();
    expect((await patch(a, "member", { updateCheck: "off" })).status).toBe(403);
    expect((await patch(a, "admin", { updateCheck: "never" })).status).toBe(400);
    const res = await patch(a, "admin", { updateCheck: "off" });
    expect(res.status).toBe(200);
    expect(((await res.json()) as { updateCheck: string }).updateCheck).toBe("off");
  });
});

describe("GET /api/installation/version", () => {
  const status = {
    build: { commit: "abc1234", date: "2026-11-10T12:00:00.000Z" },
    state: "behind",
    latest: { date: "2026-11-12" },
    changes: [],
    checkedAt: "2026-11-16T00:00:00.000Z",
    check: "on",
  };
  const checker = { tick: async () => {}, status: async () => status } as unknown as UpdateChecker;
  const read = (a: ReturnType<typeof app>, cookie?: string) =>
    a.handle(
      new Request("http://localhost/api/installation/version", {
        headers: cookie ? { cookie } : {},
      }),
    );
  test("it is for signed-in members only", async () => {
    expect((await read(app(checker))).status).toBe(401);
  });
  test("a member reads the build and the state", async () => {
    const res = await read(app(checker), "member");
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual(status);
  });
  test("a server without the checker says it does not know and that nothing is checked", async () => {
    const res = await read(app(), "member");
    expect(await res.json()).toMatchObject({ build: null, state: "unknown", check: "off" });
  });
  test("the public meta route still carries no version", async () => {
    const res = await app(checker).handle(new Request("http://localhost/api/meta"));
    const text = JSON.stringify(await res.json());
    expect(text).not.toContain("abc1234");
    expect(text.toLowerCase()).not.toContain("version");
  });
});

describe("the address of a provider on the private network", () => {
  test("is refused while the setting is off, accepted when it is turned on, refused again when off, with no restart", async () => {
    let allowed = false;
    const a = app(undefined, { allowPrivate: async () => allowed });
    const save = async () =>
      (
        await patch(a, "admin", {
          speechProvider: "compatible",
          speechBaseUrl: "http://127.0.0.1:9000/v1",
        })
      ).status;
    expect(await save()).toBe(400);
    allowed = true;
    expect(await save()).toBe(200);
    allowed = false;
    expect(await save()).toBe(400);
  });
  test("a policy that cannot answer refuses", async () => {
    const a = app(undefined, {
      allowPrivate: async () => {
        throw new Error("settings unreadable");
      },
    });
    expect(
      (
        await patch(a, "admin", {
          speechProvider: "compatible",
          speechBaseUrl: "http://127.0.0.1:9000/v1",
        })
      ).status,
    ).toBe(400);
  });
});

describe("the shared WhatsApp server", () => {
  const waha = (check: () => Promise<{ ok: boolean; message: string }>) => ({
    key: { state: async () => "set" as const },
    check,
  });
  const post = (a: ReturnType<typeof app>, user: string) =>
    a.handle(
      new Request("http://localhost/api/installation/waha/test", {
        method: "POST",
        headers: { origin, cookie: user, "content-type": "application/json" },
        body: "{}",
      }),
    );
  test("the installation shows only that a key is saved, never the key or its connection id", async () => {
    const a = app(undefined, { waha: waha(async () => ({ ok: true, message: "ok" })) });
    const r = await a.handle(
      new Request("http://localhost/api/installation", { headers: { cookie: "member" } }),
    );
    const text = await r.text();
    expect(JSON.parse(text)).toMatchObject({ wahaKey: "set" });
    expect(text).not.toContain("wahaConnectionId");
  });
  test("Test is for administrators and answers with the check's sentence", async () => {
    let calls = 0;
    const a = app(undefined, {
      waha: waha(async () => (calls++, { ok: false, message: "The server could not be reached." })),
    });
    expect((await post(a, "member")).status).toBe(403);
    expect(calls).toBe(0);
    const r = await post(a, "admin");
    expect(r.status).toBe(200);
    expect(await r.json()).toEqual({ ok: false, message: "The server could not be reached." });
  });
});
