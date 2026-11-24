import { describe, expect, test } from "bun:test";
import { createApp } from "../../app";
import { createIdentityAccess } from "../identity/access";
import { createSettingsService, type SettingChange } from "./service";
import { createMemorySettingsStore } from "./testing";

const origin = "https://app.example.invalid";
const ORG = "0192f3a0-0000-7000-8000-00000000000a";

export function settingsApp() {
  const audits: SettingChange[] = [];
  const settings = createSettingsService({
    store: createMemorySettingsStore(),
    now: () => 0,
    audit: (_u, c) => audits.push(c),
  });
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
  const access = createIdentityAccess(auth, async (id) =>
    id === "outsider" ? null : { isAdmin: id === "admin" },
  );
  const app = createApp({
    auth,
    settings: { access, settings },
    webOrigin: origin,
    desktopOrigins: [],
  });
  const call = (
    method: string,
    path: string,
    user?: string,
    body?: unknown,
    from: string | null = origin,
  ) =>
    app.handle(
      new Request(`http://localhost/api/settings${path}`, {
        method,
        headers: {
          ...(from ? { origin: from } : {}),
          ...(user ? { cookie: user } : {}),
          ...(body !== undefined ? { "content-type": "application/json" } : {}),
        },
        ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
      }),
    );
  return { call, settings, audits };
}

describe("settings routes", () => {
  test("GET is for administrators only", async () => {
    const { call } = settingsApp();
    expect((await call("GET", "", undefined)).status).toBe(401);
    expect((await call("GET", "", "member")).status).toBe(403);
    expect((await call("GET", "", "outsider")).status).toBe(403);
    expect((await call("GET", "", "admin")).status).toBe(200);
  });

  test("GET lists every key with metadata, the value that counts, the source and the sensitive flag", async () => {
    const { call } = settingsApp();
    const body = (await (await call("GET", "", "admin")).json()) as {
      groups: Record<string, string>;
      settings: {
        key: string;
        label: string;
        help: string;
        value: unknown;
        source: string;
        sensitive: boolean;
        default: unknown;
      }[];
    };
    expect(body.settings.length).toBe(21);
    expect(body.groups.limits).toBeTruthy();
    const by = Object.fromEntries(body.settings.map((s) => [s.key, s]));
    expect(by.harnessMax).toMatchObject({
      value: 8,
      source: "default",
      default: 8,
      sensitive: false,
    });
    expect(by.codeAccess?.sensitive).toBe(true);
    expect(by.lightRuns?.label.length).toBeGreaterThan(3);
  });

  test("PUT saves, GET shows it, DELETE resets", async () => {
    const { call, audits } = settingsApp();
    const put = await call("PUT", "/harnessMax", "admin", { value: 12 });
    expect(put.status).toBe(200);
    expect(await put.json()).toMatchObject({
      key: "harnessMax",
      value: 12,
      source: "installation",
    });
    const list = (await (await call("GET", "", "admin")).json()) as {
      settings: { key: string; value: unknown }[];
    };
    expect(list.settings.find((s) => s.key === "harnessMax")?.value).toBe(12);
    const del = await call("DELETE", "/harnessMax", "admin");
    expect(del.status).toBe(200);
    expect(await del.json()).toMatchObject({ value: 8, source: "default" });
    expect(audits.map((a) => a.change)).toEqual(["set", "reset"]);
  });

  test("writes are for administrators and trusted origins only", async () => {
    const { call, settings } = settingsApp();
    expect((await call("PUT", "/harnessMax", undefined, { value: 3 })).status).toBe(401);
    expect((await call("PUT", "/harnessMax", "member", { value: 3 })).status).toBe(403);
    expect((await call("DELETE", "/harnessMax", "member")).status).toBe(403);
    expect(
      (await call("PUT", "/harnessMax", "admin", { value: 3 }, "https://evil.example.invalid"))
        .status,
    ).toBe(403);
    expect((await call("PUT", "/harnessMax", "admin", { value: 3 }, null)).status).toBe(403);
    expect(await settings.get("harnessMax")).toBe(8);
  });

  test("validation: range, type, booleans, extra fields, unknown keys", async () => {
    const { call } = settingsApp();
    const bad = await call("PUT", "/harnessMax", "admin", { value: 0 });
    expect(bad.status).toBe(400);
    expect(await bad.json()).toMatchObject({
      error: { code: "INVALID_REQUEST", message: expect.stringContaining("between 1 and 1000") },
    });
    expect((await call("PUT", "/lightRuns", "admin", { value: true })).status).toBe(400);
    expect((await call("PUT", "/lightRuns", "admin", { value: "maybe" })).status).toBe(400);
    expect((await call("PUT", "/harnessMax", "admin", { value: 5, extra: 1 })).status).toBe(400);
    expect((await call("PUT", "/harnessMax", "admin", {})).status).toBe(400);
    expect((await call("PUT", "/harnessMax", "admin", { value: "7" })).status).toBe(400);
    expect((await call("PUT", "/nope", "admin", { value: 1 })).status).toBe(404);
    expect((await call("DELETE", "/nope", "admin")).status).toBe(404);
    expect((await call("PUT", `/${"k".repeat(100)}`, "admin", { value: 1 })).status).toBe(400);
    expect((await call("GET", "?bogus=1", "admin")).status).toBe(400);
  });

  test("organization values: an override, a narrow refusal, an installation-only key", async () => {
    const { call } = settingsApp();
    const put = await call("PUT", "/claudeLiveInput", "admin", {
      value: "off",
      organizationId: ORG,
    });
    expect(put.status).toBe(200);
    expect(await put.json()).toMatchObject({
      value: "off",
      source: "organization",
      organizationValue: "off",
    });
    const list = (await (await call("GET", `?organizationId=${ORG}`, "admin")).json()) as {
      settings: { key: string; value: unknown }[];
    };
    expect(list.settings.find((s) => s.key === "claudeLiveInput")?.value).toBe("off");
    const narrow = await call("PUT", "/artifactsQuota", "admin", {
      value: 99_999_999_999,
      organizationId: ORG,
    });
    expect(narrow.status).toBe(400);
    expect(
      (await call("PUT", "/harnessMax", "admin", { value: 3, organizationId: ORG })).status,
    ).toBe(400);
    expect(
      (await call("PUT", "/claudeLiveInput", "admin", { value: "off", organizationId: "nope" }))
        .status,
    ).toBe(400);
    const reset = await call("DELETE", `/claudeLiveInput?organizationId=${ORG}`, "admin");
    expect(await reset.json()).toMatchObject({ value: "on", source: "default" });
  });

  test("the answers are never cached", async () => {
    const { call } = settingsApp();
    expect((await call("GET", "", "admin")).headers.get("cache-control")).toBe("no-store");
  });
});
