import { describe, expect, test } from "bun:test";
import { DEFAULT_SPEECH_SETTINGS } from "@zetta/core/speech";
import { createApp } from "../../app";
import { createIdentityAccess } from "../identity/access";
import type { UpdateChecker } from "../updates/checker";
import type { InstallationSettings } from "./service";

const origin = "https://app.example.invalid";

function app(updates?: UpdateChecker) {
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
    installation: { access, installation, runningMode: "local", ...(updates ? { updates } : {}) },
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
