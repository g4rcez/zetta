import { DEFAULT_SPEECH_SETTINGS } from "@zetta/core/speech";
import { afterEach, describe, expect, test } from "bun:test";
import { act, createElement } from "react";
import { createRoot } from "react-dom/client";

import { setupDom } from "../skills/dom-env";
import type { Installation, MailSettingsPatch, MailTest } from "../onboarding/installation-api";
import { BotMailForm, draftOfMail } from "./bot-mail-settings";

const win = setupDom();
afterEach(() => win.document.body.replaceChildren());

const base = (over: Partial<Installation> = {}): Installation => ({
  networkMode: "local",
  publicUrl: null,
  onboarding: "done",
  laya: "off",
  layaLanguages: ["en"],
  layaModel: "english",
  restartRequired: false,
  transcribeProvider: "local",
  transcribeModel: "",
  transcribeLanguage: "",
  transcribeBaseUrl: "",
  transcribeKey: "none",
  ...DEFAULT_SPEECH_SETTINGS,
  mailProvider: "off",
  mailDomain: "",
  mailKey: "none",
  pushPublicKey: null,
  ...over,
});

async function mount(saved: Installation, admin = true) {
  win.document.body.replaceChildren();
  const el = win.document.createElement("div");
  win.document.body.append(el);
  const log = { saved: [] as MailSettingsPatch[], keys: [] as string[], removed: 0, tests: 0 };
  let testResult: MailTest = { ok: true, message: "The domain can send and receive." };
  const root = createRoot(el as unknown as Element);
  await act(async () => {
    root.render(
      createElement(BotMailForm, {
        saved,
        admin,
        onSave: async (p) => void log.saved.push(p),
        onSaveKey: async (s) => void log.keys.push(s),
        onRemoveKey: async () => void log.removed++,
        onTest: async () => (log.tests++, testResult),
      }),
    );
  });
  return { el, log, setTest: (r: MailTest) => (testResult = r) };
}
const field = (el: Element, name: string) =>
  el.querySelector(`[name="${name}"]`) as HTMLInputElement | HTMLSelectElement | null;
async function type(input: HTMLInputElement, value: string) {
  await act(async () => {
    Object.getOwnPropertyDescriptor(win.HTMLInputElement.prototype, "value")!.set!.call(
      input,
      value,
    );
    input.dispatchEvent(new win.Event("input", { bubbles: true }));
  });
}
async function choose(select: HTMLSelectElement, value: string) {
  await act(async () => {
    select.value = value;
    select.dispatchEvent(new win.Event("change", { bubbles: true }));
  });
}
const button = (el: Element, match: RegExp) =>
  [...el.querySelectorAll("button")].find((b) =>
    match.test(b.textContent?.trim() ?? ""),
  ) as HTMLButtonElement;
async function click(b: HTMLButtonElement) {
  await act(async () => {
    b.dispatchEvent(new win.MouseEvent("click", { bubbles: true }));
  });
}
async function submit(el: Element) {
  await act(async () => {
    el.querySelector("form")!.dispatchEvent(
      new win.Event("submit", { bubbles: true, cancelable: true }),
    );
  });
}

describe("a server older than this page", () => {
  test("sends none of the fields: they read as off, never as a crash", () => {
    const old = base();
    delete old.mailProvider;
    delete old.mailDomain;
    delete old.mailKey;
    expect(draftOfMail(old)).toEqual({ provider: "off", domain: "" });
  });
});

describe("the bot e-mail settings of the installation", () => {
  test("off: it says what it is for, shows no domain or key, and nothing to save", async () => {
    const { el } = await mount(base());
    expect(el.textContent).toContain("Bot e-mail addresses");
    expect(el.textContent).toContain("mailbox connected in Mail still works");
    expect(field(el, "mailDomain")).toBeNull();
    expect(field(el, "mailKey")).toBeNull();
    expect(button(el, /^Save$/).disabled).toBe(true);
    expect(button(el, /^Test$/)).toBeUndefined();
  });

  test("choosing Resend says what it costs and that mail passes through it, and needs a domain", async () => {
    const { el, log } = await mount(base());
    await choose(field(el, "mailProvider") as HTMLSelectElement, "resend");
    expect(el.textContent).toContain("passes through Resend");
    expect(el.textContent).toContain("Zetta keeps its own copy");
    const pricing = el.querySelector('a[href="https://resend.com/pricing"]') as HTMLAnchorElement;
    expect(pricing.target).toBe("_blank");
    expect(pricing.rel).toContain("noopener");
    expect(button(el, /^Save$/).disabled).toBe(true);
    await type(field(el, "mailDomain") as HTMLInputElement, " bots.example.com ");
    expect(button(el, /^Save$/).disabled).toBe(false);
    await submit(el);
    expect(log.saved).toEqual([{ mailProvider: "resend", mailDomain: "bots.example.com" }]);
  });

  test("the key is write-only: saved sealed by the page's callback, cleared at once, never shown", async () => {
    const { el, log } = await mount(
      base({ mailProvider: "resend", mailDomain: "bots.example.com" }),
    );
    const key = field(el, "mailKey") as HTMLInputElement;
    expect(key.type).toBe("password");
    expect(button(el, /^Save key$/).disabled).toBe(true);
    await type(key, "re_secret_value_123");
    await click(button(el, /^Save key$/));
    expect(log.keys).toEqual(["re_secret_value_123"]);
    expect((field(el, "mailKey") as HTMLInputElement).value).toBe("");
    expect(el.textContent).toContain("Key saved");
    expect(el.textContent).not.toContain("re_secret_value_123");
  });

  test("a saved key is said to be there (not shown) and can be removed", async () => {
    const { el, log } = await mount(
      base({ mailProvider: "resend", mailDomain: "bots.example.com", mailKey: "set" }),
    );
    expect(el.textContent).toContain("A key is saved");
    expect((field(el, "mailKey") as HTMLInputElement).value).toBe("");
    await click(button(el, /^Remove key$/));
    expect(log.removed).toBe(1);
  });

  test("Test shows the provider's verdict and the DNS records to add", async () => {
    const { el, log, setTest } = await mount(
      base({ mailProvider: "resend", mailDomain: "bots.example.com", mailKey: "set" }),
    );
    setTest({
      ok: false,
      message: "Receiving is not enabled for this domain yet.",
      records: [
        {
          purpose: "MX",
          type: "MX",
          name: "bots",
          value: "inbound.example.invalid",
          priority: 10,
          verified: false,
        },
        {
          purpose: "DKIM",
          type: "TXT",
          name: "resend._domainkey.bots",
          value: "p=abc",
          verified: true,
        },
      ],
    });
    await click(button(el, /^Test$/));
    expect(log.tests).toBe(1);
    expect(
      [...el.querySelectorAll('p[role="alert"]')].map((n) => n.textContent).join(" "),
    ).toContain("Receiving is not enabled");
    expect(el.textContent).toContain("DNS records for this domain");
    expect(el.textContent).toContain("inbound.example.invalid");
    expect(el.textContent).toContain("not seen yet");
    expect(el.textContent).toContain("seen");
  });

  test("Test waits until unsaved changes are saved: it uses what is saved", async () => {
    const { el } = await mount(
      base({ mailProvider: "resend", mailDomain: "bots.example.com", mailKey: "set" }),
    );
    await type(field(el, "mailDomain") as HTMLInputElement, "other.example.com");
    expect(button(el, /^Test$/).disabled).toBe(true);
  });

  test("turning it off keeps the saved domain", async () => {
    const { el, log } = await mount(
      base({ mailProvider: "resend", mailDomain: "bots.example.com", mailKey: "set" }),
    );
    await choose(field(el, "mailProvider") as HTMLSelectElement, "off");
    await submit(el);
    expect(log.saved).toEqual([{ mailProvider: "off", mailDomain: "bots.example.com" }]);
  });

  test("a member sees only what is set, with no field and no key", async () => {
    const { el } = await mount(
      base({ mailProvider: "resend", mailDomain: "bots.example.com", mailKey: "set" }),
      false,
    );
    expect(el.textContent).toContain("Bots get an address on bots.example.com");
    expect(el.textContent).toContain("Resend");
    expect(el.textContent).toContain("Ask your administrator");
    expect(el.querySelector("input")).toBeNull();
    expect(el.querySelector("button")).toBeNull();
  });
});
