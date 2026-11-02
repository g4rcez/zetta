import { describe, expect, test } from "bun:test";
import { createApp } from "../../app";
import { createIdentityAccess } from "../identity/access";
import type { InstallationSettings } from "./service";

const origin = "https://app.example.invalid";

function app() {
  let saved: InstallationSettings = {
    networkMode: "local",
    publicUrl: null,
    onboarding: "pending",
    laya: "off",
    layaLanguages: ["en"],
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
    installation: { access, installation, runningMode: "local" },
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
      restartRequired: true,
    });
  });
  test("Laya is off until the admin turns it on", async () => {
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
});
