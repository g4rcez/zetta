// The "Bot e-mail addresses" settings of the installation, through the real routes: who may change them, what is checked, what the
// answer holds (never a key id or the poller's cursor), and what the Test button reports.
import { describe, expect, test } from "bun:test";
import {
  DEFAULT_MAIL_SETTINGS,
  mailSettingsIssue,
  normalizeMailDomain,
} from "@zetta/core/mail-provision";
import { createApp } from "../../app";
import { createIdentityAccess } from "../identity/access";
import { MailConnectError } from "../mail/imap-connect";
import { createFakeProvider } from "../mail/providers/fake";
import { createMailProviderReader } from "../mail/provider-config";
import { fakeInstallationKeys, fakeInstallationSettings } from "./testing";
import { InvalidInstallationError, type InstallationSettings } from "./service";

const origin = "https://app.example.invalid";

function app(o: { key?: string | null } = {}) {
  let saved: InstallationSettings = fakeInstallationSettings({
    mailConnectionId:
      o.key === undefined ? "11111111-1111-7111-8111-111111111111" : o.key === null ? null : "k",
    mailCursor: "cursor-that-stays-private",
  });
  const provider = createFakeProvider();
  const keys = fakeInstallationKeys({
    keys: { "11111111-1111-7111-8111-111111111111": "re_key", k: "re_key" },
  });
  const reader = createMailProviderReader({
    load: async () => saved,
    key: keys,
    create: () => provider,
  });
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
  const access = createIdentityAccess(auth as never, async (id) => ({ isAdmin: id === "admin" }));
  const installation = {
    load: async () => saved,
    update: async (patch: Partial<InstallationSettings>) => {
      const next = { ...saved, ...patch };
      // The real service stores the domain as a plain lower case name.
      next.mailDomain = normalizeMailDomain(next.mailDomain);
      const issue = mailSettingsIssue(next);
      if (issue) throw new InvalidInstallationError(issue);
      return (saved = next);
    },
  };
  const a = createApp({
    auth: auth as never,
    installation: {
      access,
      installation: installation as never,
      runningMode: "local",
      mail: { reader, key: keys },
    },
    webOrigin: origin,
    desktopOrigins: [],
  });
  const call = async (as: string, method: string, path: string, body?: unknown) => {
    const r = await a.handle(
      new Request(`http://localhost${path}`, {
        method,
        headers: { origin, cookie: as, "content-type": "application/json" },
        body: body ? JSON.stringify(body) : undefined,
      }),
    );
    return { status: r.status, text: await r.text() };
  };
  return { call, provider, current: () => saved };
}

describe("reading", () => {
  test("members read the choice and whether a key is there, never the key's connection or the cursor", async () => {
    const t = app();
    const r = await t.call("member", "GET", "/api/installation");
    expect(r.status).toBe(200);
    const body = JSON.parse(r.text);
    expect(body).toMatchObject({ ...DEFAULT_MAIL_SETTINGS, mailKey: "set" });
    expect(r.text).not.toContain("11111111-1111");
    expect(r.text).not.toContain("cursor-that-stays-private");
    expect(Object.keys(body).filter((k) => /connection|cursor/i.test(k))).toEqual([]);
  });
  test("no key reads as none", async () => {
    expect(
      JSON.parse((await app({ key: null }).call("member", "GET", "/api/installation")).text)
        .mailKey,
    ).toBe("none");
  });
});

describe("saving", () => {
  test("an administrator chooses Resend and a domain, saved lower case", async () => {
    const t = app();
    const r = await t.call("admin", "PATCH", "/api/installation", {
      mailProvider: "resend",
      mailDomain: " Bots.Example.invalid ",
    });
    expect(r.status).toBe(200);
    expect(JSON.parse(r.text)).toMatchObject({
      mailProvider: "resend",
      mailDomain: "bots.example.invalid",
    });
    expect(r.text).not.toContain("cursor-that-stays-private");
  });
  test("a member cannot", async () => {
    const t = app();
    expect(
      (
        await t.call("member", "PATCH", "/api/installation", {
          mailProvider: "resend",
          mailDomain: "bots.example.invalid",
        })
      ).status,
    ).toBe(403);
    expect(t.current().mailProvider).toBe("off");
  });
  test("a provider needs a real domain; an unknown provider is refused", async () => {
    const t = app();
    expect(
      (await t.call("admin", "PATCH", "/api/installation", { mailProvider: "resend" })).status,
    ).toBe(400);
    expect(
      (
        await t.call("admin", "PATCH", "/api/installation", {
          mailProvider: "resend",
          mailDomain: "not a domain",
        })
      ).status,
    ).toBe(400);
    expect(
      (await t.call("admin", "PATCH", "/api/installation", { mailProvider: "sendgrid" })).status,
    ).toBe(400);
    expect((await t.call("admin", "PATCH", "/api/installation", { mailCursor: "x" })).status).toBe(
      400,
    );
    expect(t.current().mailProvider).toBe("off");
  });
  test("turning it off keeps the domain", async () => {
    const t = app();
    await t.call("admin", "PATCH", "/api/installation", {
      mailProvider: "resend",
      mailDomain: "bots.example.invalid",
    });
    await t.call("admin", "PATCH", "/api/installation", { mailProvider: "off" });
    expect(t.current()).toMatchObject({ mailProvider: "off", mailDomain: "bots.example.invalid" });
  });
});

describe("the Test button", () => {
  const on = async (t: ReturnType<typeof app>) =>
    t.call("admin", "PATCH", "/api/installation", {
      mailProvider: "resend",
      mailDomain: "bots.example.invalid",
    });
  test("administrators only", async () => {
    const t = app();
    await on(t);
    expect((await t.call("member", "POST", "/api/installation/mail/test", {})).status).toBe(403);
    expect(
      (await t.call("anonymous-none", "POST", "/api/installation/mail/test", {})).status,
    ).not.toBe(200);
  });
  test("a domain that sends and receives is ready, with its records", async () => {
    const t = app();
    await on(t);
    t.provider.domain = {
      found: true,
      state: "verified",
      sending: true,
      receiving: true,
      records: [
        {
          purpose: "MX",
          type: "MX",
          name: "bots",
          value: "inbound.example.invalid",
          priority: 10,
          verified: true,
        },
      ],
    };
    const r = JSON.parse((await t.call("admin", "POST", "/api/installation/mail/test", {})).text);
    expect(r).toMatchObject({ ok: true, sending: true, receiving: true });
    expect(r.records).toHaveLength(1);
  });
  test("receiving not enabled says so, with the records still to add", async () => {
    const t = app();
    await on(t);
    t.provider.domain = {
      found: true,
      state: "pending",
      sending: true,
      receiving: false,
      records: [],
    };
    const r = JSON.parse((await t.call("admin", "POST", "/api/installation/mail/test", {})).text);
    expect(r.ok).toBe(false);
    expect(r.message).toContain("Receiving is not enabled");
  });
  test("an unknown domain, no provider chosen and no key are each said plainly", async () => {
    const t = app();
    expect(
      JSON.parse((await t.call("admin", "POST", "/api/installation/mail/test", {})).text).message,
    ).toContain("Choose a provider");
    await on(t);
    t.provider.domain = { found: false };
    expect(
      JSON.parse((await t.call("admin", "POST", "/api/installation/mail/test", {})).text).message,
    ).toContain("does not know bots.example.invalid");
    const none = app({ key: null });
    await none.call("admin", "PATCH", "/api/installation", {
      mailProvider: "resend",
      mailDomain: "bots.example.invalid",
    });
    expect(
      JSON.parse((await none.call("admin", "POST", "/api/installation/mail/test", {})).text)
        .message,
    ).toContain("key");
  });
  test("a provider failure shows the fixed sentence, never its words", async () => {
    const t = app();
    await on(t);
    t.provider.domainStatus = async () => {
      throw new MailConnectError("AUTH", "The mail provider did not accept the saved key.");
    };
    const r = await t.call("admin", "POST", "/api/installation/mail/test", {});
    expect(JSON.parse(r.text)).toEqual({
      ok: false,
      message: "The mail provider did not accept the saved key.",
    });
  });
  test("at most six a minute", async () => {
    const t = app();
    await on(t);
    for (let i = 0; i < 6; i++) await t.call("admin", "POST", "/api/installation/mail/test", {});
    expect(
      JSON.parse((await t.call("admin", "POST", "/api/installation/mail/test", {})).text).message,
    ).toContain("a lot of tests");
  });
});
