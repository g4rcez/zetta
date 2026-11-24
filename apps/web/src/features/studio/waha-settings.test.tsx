import { afterEach, describe, expect, test } from "bun:test";
import { generateTransportKeyPair, open } from "@zetta/core/sealed-transport";
import { act, createElement } from "react";
import { createRoot } from "react-dom/client";

import { setupDom } from "../skills/dom-env";
import { installationApi, type WahaTest } from "../onboarding/installation-api";
import { WahaForm } from "./waha-settings";

const win = setupDom();
afterEach(() => win.document.body.replaceChildren());

type KeyState = "none" | "set" | "unavailable";
async function mount(o: { address?: string; keyState?: KeyState; admin?: boolean } = {}) {
  win.document.body.replaceChildren();
  const el = win.document.createElement("div");
  win.document.body.append(el);
  const log = { addresses: [] as string[], keys: [] as string[], removed: 0, tests: 0 };
  let testResult: WahaTest = { ok: true, message: "The server answers and accepts the saved key." };
  const root = createRoot(el as unknown as Element);
  await act(async () => {
    root.render(
      createElement(WahaForm, {
        address: o.address ?? "",
        keyState: o.keyState ?? "none",
        admin: o.admin ?? true,
        onSaveAddress: async (a) => void log.addresses.push(a),
        onSaveKey: async (s) => void log.keys.push(s),
        onRemoveKey: async () => void log.removed++,
        onTest: async () => (log.tests++, testResult),
      }),
    );
  });
  return { el, log, setTest: (r: WahaTest) => (testResult = r) };
}
const field = (el: Element, name: string) =>
  el.querySelector(`[name="${name}"]`) as HTMLInputElement | null;
async function type(input: HTMLInputElement, value: string) {
  await act(async () => {
    Object.getOwnPropertyDescriptor(win.HTMLInputElement.prototype, "value")!.set!.call(
      input,
      value,
    );
    input.dispatchEvent(new win.Event("input", { bubbles: true }));
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

describe("the WhatsApp server card", () => {
  test("says the key is shared by everyone without their own server, and shows the built-in address as the hint", async () => {
    const { el } = await mount();
    expect(el.textContent).toContain("WhatsApp server (WAHA)");
    expect(el.textContent).toContain("shared by all of them");
    expect(el.textContent).toContain("never sent there");
    expect(field(el, "wahaUrl")!.placeholder).toBe("http://127.0.0.1:3010");
    expect(button(el, /^Save$/).disabled).toBe(true);
  });

  test("a member sees a sentence and no field", async () => {
    const { el } = await mount({ admin: false });
    expect(field(el, "wahaUrl")).toBeNull();
    expect(field(el, "wahaKey")).toBeNull();
    expect(el.textContent).toContain("Ask your administrator");
  });

  test("the address is saved trimmed, and emptied it is saved empty (the built-in one)", async () => {
    const { el, log } = await mount({ address: "http://waha.example.invalid:3000" });
    await type(field(el, "wahaUrl")!, " http://other.example.invalid ");
    await submit(el);
    expect(log.addresses).toEqual(["http://other.example.invalid"]);
    await type(field(el, "wahaUrl")!, "");
    await submit(el);
    expect(log.addresses).toEqual(["http://other.example.invalid", ""]);
  });

  test("the key is write-only: passed to the sealed callback, cleared at once, never shown", async () => {
    const { el, log } = await mount();
    const key = field(el, "wahaKey")!;
    expect(key.type).toBe("password");
    expect(button(el, /^Save key$/).disabled).toBe(true);
    await type(key, "waha-secret-value");
    await click(button(el, /^Save key$/));
    expect(log.keys).toEqual(["waha-secret-value"]);
    expect(field(el, "wahaKey")!.value).toBe("");
    expect(el.textContent).toContain("Key saved");
    expect(el.textContent).not.toContain("waha-secret-value");
  });

  test("a saved key is said to be there (not shown) and can be removed", async () => {
    const { el, log } = await mount({ keyState: "set" });
    expect(el.textContent).toContain("A key is saved");
    expect(field(el, "wahaKey")!.value).toBe("");
    await click(button(el, /^Remove key$/));
    expect(log.removed).toBe(1);
  });

  test("Test shows the verdict, and waits for unsaved changes", async () => {
    const { el, log, setTest } = await mount({ keyState: "set" });
    setTest({ ok: false, message: "The server answered but did not accept the saved key." });
    await click(button(el, /^Test$/));
    expect(log.tests).toBe(1);
    expect(
      [...el.querySelectorAll('p[role="alert"]')].map((n) => n.textContent).join(" "),
    ).toContain("did not accept the saved key");
    await type(field(el, "wahaUrl")!, "http://changed.example.invalid");
    expect(button(el, /^Test$/).disabled).toBe(true);
  });
});

describe("the key travels sealed", () => {
  test("the request holds no plain key; the server's key opens it for this user and purpose", async () => {
    const pair = await generateTransportKeyPair();
    const SECRET = "waha-plain-secret-0001";
    const sent: { path: string; method: string; body: string }[] = [];
    const saved = globalThis.fetch;
    globalThis.fetch = (async (input: URL | string, init?: RequestInit) => {
      const url = new URL(String(input));
      sent.push({
        path: url.pathname,
        method: init?.method ?? "GET",
        body: String(init?.body ?? ""),
      });
      if (url.pathname === "/api/connections/transport-key")
        return Response.json({
          kid: "k1",
          publicKey: pair.publicKey,
          userId: "me",
          serverTime: Date.now(),
        });
      return Response.json(
        url.pathname === "/api/installation" ? { wahaKey: "set" } : { ok: true },
      );
    }) as typeof fetch;
    try {
      await installationApi.saveWahaKey(SECRET);
    } finally {
      globalThis.fetch = saved;
    }
    const put = sent.find((r) => r.path === "/api/connections/waha-key")!;
    expect(put.method).toBe("PUT");
    expect(sent.map((r) => r.body).join("\n")).not.toContain(SECRET);
    const body = JSON.parse(put.body) as { sealed: never };
    expect(
      await open(
        pair.privateKey,
        body.sealed,
        { userId: "me", purpose: "installation.waha-key" },
        Date.now(),
      ),
    ).toEqual({ secret: SECRET });
  });
});
