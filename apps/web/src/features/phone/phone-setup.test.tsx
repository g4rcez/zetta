import { afterAll, afterEach, describe, expect, test } from "bun:test";
import { QueryClientProvider } from "@tanstack/react-query";
import { act } from "react";
import { createRoot } from "react-dom/client";

import { setupDom } from "../skills/dom-env";
import {
  installationQueries,
  type Installation,
  type PhoneSettingsPatch,
  type PhoneTest,
} from "../onboarding/installation-api";
import type { PhoneProviderId } from "@zetta/core/phone";
import type { PhoneSetupApi } from "./use-phone-settings";

const win = setupDom();
// The router restores scroll on load; the test DOM has no `scrollTo`.
Object.assign(globalThis, { scrollTo: () => {} });
// The library builds `new Event("change")` from the global, and happy-dom only takes its own Event class.
const realEvent = globalThis.Event;
globalThis.Event = win.Event as unknown as typeof Event;
const bunFormData = globalThis.FormData;
globalThis.FormData = win.FormData as never;
afterAll(() => {
  globalThis.Event = realEvent;
  globalThis.FormData = bunFormData;
});

const { queryClient } = await import("@/lib/query-client");
const KEY = installationQueries.get().queryKey;

const SID = "AC00000000000000000000000000000000";
const ADDRESS = "https://zetta.example.invalid";
const base = (over: Partial<Installation> = {}): Installation =>
  ({
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
    pushPublicKey: null,
    phoneProvider: "off",
    phoneKey: "none",
    ...over,
  }) as Installation;
const TELNYX_ON = {
  phoneProvider: "telnyx" as const,
  phoneKey: "set" as const,
  phonePublicKey: "pub",
  phoneApplicationId: "1234",
  phonePublicUrl: ADDRESS,
};
const TWILIO_ON = {
  phoneTwilio: "on" as const,
  phoneTwilioKey: "set" as const,
  phoneTwilioAccountSid: SID,
  phonePublicUrl: ADDRESS,
};

type Log = {
  patches: PhoneSettingsPatch[];
  keys: [PhoneProviderId, string][];
  removed: PhoneProviderId[];
  tests: PhoneProviderId[];
  order: string[];
};
type Mount = {
  log: Log;
  results: Record<string, PhoneTest>;
  failNextPatch: (message: string) => void;
};

const mounted: (() => Promise<void>)[] = [];
afterEach(async () => {
  for (const u of mounted.splice(0)) await u();
  win.document.body.replaceChildren();
});
const settle = (ms = 30) => act(async () => void (await new Promise((r) => setTimeout(r, ms))));

/** The setup, with a fake api that does what the server does: it changes the cached installation. */
async function mount(saved: Installation): Promise<Mount> {
  const { createMemoryHistory, createRootRoute, createRouter, RouterProvider } =
    await import("@tanstack/react-router");
  const { PhoneSetup } = await import("./phone-setup");
  queryClient.clear();
  queryClient.setQueryData(KEY, saved);
  const log: Log = { patches: [], keys: [], removed: [], tests: [], order: [] };
  const results: Record<string, PhoneTest> = {
    telnyx: { ok: true, message: "The key and the call application work.", balance: "10.00 USD" },
    twilio: { ok: true, message: "Twilio accepted the Account SID and Auth Token." },
  };
  let failure: string | undefined;
  const current = () => queryClient.getQueryData<Installation>(KEY)!;
  const api: PhoneSetupApi = {
    patch: async (p) => {
      if (failure) {
        const m = failure;
        failure = undefined;
        throw new Error(m);
      }
      log.patches.push(p);
      log.order.push("patch");
      queryClient.setQueryData(KEY, { ...current(), ...p });
    },
    saveKey: async (id, secret) => {
      log.keys.push([id, secret]);
      log.order.push("key");
      queryClient.setQueryData(KEY, {
        ...current(),
        [id === "telnyx" ? "phoneKey" : "phoneTwilioKey"]: "set",
      });
    },
    removeKey: async (id) => {
      log.removed.push(id);
      log.order.push("remove");
      queryClient.setQueryData(KEY, {
        ...current(),
        [id === "telnyx" ? "phoneKey" : "phoneTwilioKey"]: "none",
      });
    },
    test: async (id) => (log.tests.push(id), results[id]!),
  };
  const router = createRouter({
    routeTree: createRootRoute({
      component: () => (
        <QueryClientProvider client={queryClient}>
          <PhoneSetup api={api} />
        </QueryClientProvider>
      ),
    }),
    history: createMemoryHistory({ initialEntries: ["/"] }),
  });
  await router.load();
  const host = win.document.createElement("div");
  win.document.body.replaceChildren(host);
  const root = createRoot(host as unknown as Element);
  await act(async () => root.render(<RouterProvider router={router} />));
  await settle();
  mounted.push(() => act(async () => root.unmount()));
  return { log, results, failNextPatch: (m) => (failure = m) };
}

const text = () => win.document.body.textContent ?? "";
const card = (name: string) =>
  win.document.querySelector(`section[aria-label="${name}"]`) as unknown as HTMLElement;
const chip = (name: string) => card(name).querySelector("[data-status].inline-flex")?.textContent;
const field = (within: ParentNode, name: string) =>
  within.querySelector(`[name="${name}"]`) as unknown as
    | HTMLInputElement
    | HTMLSelectElement
    | null;
const button = (within: ParentNode, label: RegExp) =>
  [...within.querySelectorAll("button")].find((b) =>
    label.test(b.textContent?.trim() || b.getAttribute("aria-label") || ""),
  ) as HTMLButtonElement | undefined;
async function click(b: Element | undefined | null) {
  if (!b) throw new Error(`nothing to press in: ${text()}`);
  await act(async () => void b.dispatchEvent(new win.MouseEvent("click", { bubbles: true })));
  await settle();
}
async function type(el: HTMLInputElement | HTMLSelectElement | null, value: string) {
  await act(async () => {
    Object.getOwnPropertyDescriptor(win.HTMLInputElement.prototype, "value")!.set!.call(el, value);
    el!.dispatchEvent(new win.Event("input", { bubbles: true }) as never);
  });
}
async function choose(el: HTMLSelectElement | null, value: string) {
  await act(async () => {
    el!.value = value;
    el!.dispatchEvent(new win.Event("change", { bubbles: true }) as never);
  });
}
async function submit(within: ParentNode) {
  await act(
    async () =>
      void (
        within instanceof win.HTMLFormElement ? within : within.querySelector("form")!
      ).dispatchEvent(new win.Event("submit", { bubbles: true, cancelable: true }) as never),
  );
  await settle();
}
const alertsIn = (el: ParentNode) =>
  [...el.querySelectorAll('[role="alert"]')]
    .map((a) => a.textContent?.trim())
    .join(" ")
    .trim();
const open = (name: string) => click(button(card(name), /^(Connect|Edit)$/));

describe("nothing connected", () => {
  test("two cards with a logo, a chip and a Connect button; nothing else to set", async () => {
    await mount(base());
    for (const name of ["Telnyx", "Twilio"]) {
      expect(chip(name)).toBe("Not connected");
      expect(button(card(name), /^Connect$/)).toBeDefined();
      expect(card(name).querySelector("img[data-provider-logo]")).not.toBeNull();
      expect(field(card(name), "phonePublicUrl")).toBeNull();
    }
    expect(text()).toContain("Connect a provider to choose who can ask");
    expect(win.document.querySelector('section[aria-label="How people get numbers"]')).toBeNull();
    expect(win.document.querySelector('form[aria-label="Limits"]')).toBeNull();
    // The old "Off: … numbers are not offered" selects are gone.
    expect(text()).not.toContain("are not offered");
    expect(win.document.querySelector("select[name=phoneProvider]")).toBeNull();
  });

  test("About costs keeps the facts of the old note", async () => {
    await mount(base());
    const t = text();
    expect(t).toContain("About costs");
    expect(t).toContain("You pay each provider");
    expect(t).toContain("held in the name of whoever holds the account");
    expect(t).toContain("Calls are not recorded");
    expect(t).toContain("automated assistant");
    expect(t).toContain("3 business days");
  });

  test("Connect opens the form in the card; the prices link out safely", async () => {
    await mount(base());
    await open("Telnyx");
    const k = field(card("Telnyx"), "phoneKey") as HTMLInputElement;
    expect(k.type).toBe("password");
    expect(field(card("Telnyx"), "phonePublicKey")).not.toBeNull();
    expect(field(card("Telnyx"), "phoneApplicationId")).not.toBeNull();
    expect(field(card("Telnyx"), "phonePublicUrl")).not.toBeNull();
    expect(field(card("Telnyx"), "phoneTwilioAccountSid")).toBeNull();
    const pricing = card("Telnyx").querySelector(
      'a[href="https://telnyx.com/pricing/numbers"]',
    ) as unknown as HTMLAnchorElement;
    expect(pricing.target).toBe("_blank");
    expect(pricing.rel).toContain("noopener");
    expect(field(card("Twilio"), "phoneKey")).toBeNull();
  });
});

describe("connecting Telnyx", () => {
  test("an incomplete form is refused, each sentence under its own field, and nothing is sent", async () => {
    const t = await mount(base());
    await open("Telnyx");
    await submit(card("Telnyx"));
    expect(alertsIn(card("Telnyx")) + card("Telnyx").textContent).toContain(
      "Paste the Telnyx API key",
    );
    await type(field(card("Telnyx"), "phoneKey"), "KEY-secret-value-123");
    await submit(card("Telnyx"));
    expect(card("Telnyx").textContent).toContain("public key");
    await type(field(card("Telnyx"), "phonePublicKey"), " pub ");
    await type(field(card("Telnyx"), "phoneApplicationId"), "1234");
    await type(field(card("Telnyx"), "phonePublicUrl"), "http://zetta.example.invalid");
    await submit(card("Telnyx"));
    expect(card("Telnyx").textContent).toContain("https://");
    expect(t.log.patches).toEqual([]);
    expect(t.log.keys).toEqual([]);
  });

  test("the key goes only through the sealed call and is cleared at once; the settings follow in one patch", async () => {
    const t = await mount(base());
    await open("Telnyx");
    await type(field(card("Telnyx"), "phoneKey"), "KEY-secret-value-123");
    await type(field(card("Telnyx"), "phonePublicKey"), " pub ");
    await type(field(card("Telnyx"), "phoneApplicationId"), "1234");
    await type(field(card("Telnyx"), "phonePublicUrl"), `${ADDRESS}/`);
    await submit(card("Telnyx"));
    expect(t.log.keys).toEqual([["telnyx", "KEY-secret-value-123"]]);
    expect(t.log.order).toEqual(["key", "patch"]);
    expect(t.log.patches).toEqual([
      {
        phoneProvider: "telnyx",
        phonePublicKey: "pub",
        phoneApplicationId: "1234",
        phonePublicUrl: `${ADDRESS}/`,
      },
    ]);
    // Only Telnyx's own fields and the shared address travel: no Twilio field.
    expect(Object.keys(t.log.patches[0]!).some((k) => /twilio|default/i.test(k))).toBe(false);
    expect(text()).not.toContain("KEY-secret-value-123");
    expect(chip("Telnyx")).toBe("Connected");
    expect(chip("Twilio")).toBe("Not connected");
    // The card folded to a summary and the next part of the page appeared.
    expect(field(card("Telnyx"), "phoneKey")).toBeNull();
    expect(card("Telnyx").textContent).toContain("Saved");
    expect(
      win.document.querySelector('section[aria-label="How people get numbers"]'),
    ).not.toBeNull();
  });

  test("a failed save keeps what was typed and shows the sentence in its own card", async () => {
    const t = await mount(base());
    await open("Telnyx");
    await open("Twilio");
    await type(field(card("Telnyx"), "phoneKey"), "KEY-secret-value-123");
    await type(field(card("Telnyx"), "phonePublicKey"), "pub");
    await type(field(card("Telnyx"), "phoneApplicationId"), "1234");
    await type(field(card("Telnyx"), "phonePublicUrl"), ADDRESS);
    await type(field(card("Twilio"), "phoneTwilioAccountSid"), "ACdraft");
    t.failNextPatch("The provider refused that.");
    // The key is sealed first, then the patch fails.
    await submit(card("Telnyx"));
    expect(alertsIn(card("Telnyx"))).toContain("The provider refused that.");
    expect(alertsIn(card("Twilio"))).toBe("");
    expect((field(card("Telnyx"), "phonePublicKey") as HTMLInputElement).value).toBe("pub");
    expect((field(card("Telnyx"), "phonePublicUrl") as HTMLInputElement).value).toBe(ADDRESS);
    // Both cards still show the shared address, and Twilio's own draft was not touched.
    expect((field(card("Twilio"), "phonePublicUrl") as HTMLInputElement).value).toBe(ADDRESS);
    expect((field(card("Twilio"), "phoneTwilioAccountSid") as HTMLInputElement).value).toBe(
      "ACdraft",
    );
  });
});

describe("connecting Twilio", () => {
  test("it asks for the Account SID and the Auth Token, and checks the SID before sending", async () => {
    const t = await mount(base());
    await open("Twilio");
    expect(field(card("Twilio"), "phoneApplicationId")).toBeNull();
    expect((field(card("Twilio"), "phoneTwilioKey") as HTMLInputElement).type).toBe("password");
    const pricing = card("Twilio").querySelector(
      'a[href^="https://www.twilio.com/"]',
    ) as unknown as HTMLAnchorElement;
    expect(pricing.rel).toContain("noopener");
    await type(field(card("Twilio"), "phoneTwilioKey"), "twilio-token-secret-123");
    await type(field(card("Twilio"), "phoneTwilioAccountSid"), "ACnope");
    await type(field(card("Twilio"), "phonePublicUrl"), "https://zetta.example.com");
    await submit(card("Twilio"));
    expect(t.log.patches).toEqual([]);
    expect(card("Twilio").textContent).toContain("Account SID");
    await type(field(card("Twilio"), "phoneTwilioAccountSid"), ` ${SID} `);
    await submit(card("Twilio"));
    expect(t.log.keys).toEqual([["twilio", "twilio-token-secret-123"]]);
    expect(t.log.patches).toEqual([
      {
        phoneTwilio: "on",
        phoneTwilioAccountSid: SID,
        phonePublicUrl: "https://zetta.example.com",
      },
    ]);
    expect(chip("Twilio")).toBe("Connected");
    expect(text()).not.toContain("twilio-token-secret-123");
  });
});

describe("the shared public address", () => {
  test("it shows in both cards and an edit in either one shows in the other at once", async () => {
    const t = await mount(base({ ...TELNYX_ON, ...TWILIO_ON }));
    await open("Telnyx");
    await open("Twilio");
    const a = () => field(card("Telnyx"), "phonePublicUrl") as HTMLInputElement;
    const b = () => field(card("Twilio"), "phonePublicUrl") as HTMLInputElement;
    expect(a().value).toBe(ADDRESS);
    expect(b().value).toBe(ADDRESS);
    await type(a(), "https://one.example.invalid");
    expect(b().value).toBe("https://one.example.invalid");
    await type(b(), "https://two.example.invalid");
    expect(a().value).toBe("https://two.example.invalid");
    // One value saved from either card: the PATCH carries it, the other card then reads it as saved.
    await submit(card("Twilio"));
    expect(t.log.patches).toEqual([
      {
        phoneTwilio: "on",
        phoneTwilioAccountSid: SID,
        phonePublicUrl: "https://two.example.invalid",
      },
    ]);
    expect(a().value).toBe("https://two.example.invalid");
  });
});

describe("states of a connected provider", () => {
  test("one connected: a summary, Edit and Test, and the parts below; no default provider", async () => {
    await mount(base(TELNYX_ON));
    expect(chip("Telnyx")).toBe("Connected");
    expect(chip("Twilio")).toBe("Not connected");
    expect(card("Telnyx").textContent).toContain(ADDRESS);
    expect(button(card("Telnyx"), /^Edit$/)).toBeDefined();
    expect(button(card("Telnyx"), /^Test$/)).toBeDefined();
    expect(button(card("Twilio"), /^Test$/)).toBeUndefined();
    expect(field(win.document, "phoneDefaultProvider")).toBeNull();
    expect(win.document.querySelector('form[aria-label="Limits"]')).not.toBeNull();
  });

  test("a key that cannot be read, and a connection without a key, say so", async () => {
    await mount(
      base({ ...TELNYX_ON, phoneKey: "unavailable", ...TWILIO_ON, phoneTwilioKey: "none" }),
    );
    expect(chip("Telnyx")).toBe("Key unavailable");
    expect(chip("Twilio")).toBe("Needs attention");
  });

  test("Test runs per provider, shows the server's sentence with a mark, and a failure marks the card", async () => {
    const t = await mount(base({ ...TELNYX_ON, ...TWILIO_ON }));
    await click(button(card("Twilio"), /^Test$/));
    expect(t.log.tests).toEqual(["twilio"]);
    expect(card("Twilio").textContent).toContain("Twilio accepted");
    expect(card("Telnyx").textContent).not.toContain("Twilio accepted");
    await click(button(card("Telnyx"), /^Test$/));
    expect(card("Telnyx").textContent).toContain("Account balance: 10.00 USD");
    t.results.twilio = {
      ok: false,
      message: "Twilio did not accept the Account SID and Auth Token.",
    };
    await click(button(card("Twilio"), /^Test$/));
    expect(alertsIn(card("Twilio"))).toContain("did not accept");
    expect(chip("Twilio")).toBe("Needs attention");
    expect(chip("Telnyx")).toBe("Connected");
  });

  test("Test waits for Save: it checks what is saved", async () => {
    await mount(base({ ...TELNYX_ON, ...TWILIO_ON }));
    await open("Telnyx");
    expect(button(card("Telnyx"), /^Test$/)!.disabled).toBe(false);
    await type(field(card("Telnyx"), "phonePublicUrl"), "https://other.example.invalid");
    expect(button(card("Telnyx"), /^Test$/)!.disabled).toBe(true);
    // The address is shared, so Twilio's Test waits too.
    expect(button(card("Twilio"), /^Test$/)!.disabled).toBe(true);
  });

  test("a connected card saves only when something changed, and keeps its key when none is typed", async () => {
    const t = await mount(base(TELNYX_ON));
    await open("Telnyx");
    expect(button(card("Telnyx"), /^Save$/)!.disabled).toBe(true);
    await type(field(card("Telnyx"), "phoneApplicationId"), "9999");
    await submit(card("Telnyx"));
    expect(t.log.keys).toEqual([]);
    expect(t.log.patches).toHaveLength(1);
    expect(t.log.patches[0]).toMatchObject({ phoneApplicationId: "9999" });
  });
});

describe("disconnecting", () => {
  test("it asks first; Keep it changes nothing", async () => {
    const t = await mount(base(TELNYX_ON));
    await open("Telnyx");
    await click(button(card("Telnyx"), /^Disconnect$/));
    expect(card("Telnyx").textContent).toContain("Disconnect Telnyx?");
    await click(button(card("Telnyx"), /^Keep it$/));
    expect(t.log.patches).toEqual([]);
    expect(t.log.removed).toEqual([]);
    expect(chip("Telnyx")).toBe("Connected");
  });

  test("Yes switches the provider off and removes its key, and nothing else", async () => {
    const t = await mount(base(TELNYX_ON));
    await open("Telnyx");
    await click(button(card("Telnyx"), /^Disconnect$/));
    await click(button(card("Telnyx"), /^Yes, disconnect$/));
    expect(t.log.patches).toEqual([{ phoneProvider: "off" }]);
    expect(t.log.removed).toEqual(["telnyx"]);
    expect(chip("Telnyx")).toBe("Not connected");
    expect(text()).toContain("Connect a provider to choose who can ask");
  });

  test("with both connected, the other becomes the default", async () => {
    const t = await mount(base({ ...TELNYX_ON, ...TWILIO_ON, phoneDefaultProvider: "telnyx" }));
    await open("Telnyx");
    await click(button(card("Telnyx"), /^Disconnect$/));
    await click(button(card("Telnyx"), /^Yes, disconnect$/));
    expect(t.log.patches).toEqual([{ phoneProvider: "off", phoneDefaultProvider: "twilio" }]);
    expect(t.log.removed).toEqual(["telnyx"]);
    expect(chip("Twilio")).toBe("Connected");
  });
});

describe("how people get numbers", () => {
  test("who can ask, the countries as chips with a picker, saved in one patch", async () => {
    const t = await mount(base({ ...TELNYX_ON, phoneRequestMode: "off", phoneCountries: "BR" }));
    const area = win.document.querySelector('section[aria-label="How people get numbers"]')!;
    const radios = [...area.querySelectorAll('[role="radio"]')];
    expect(radios.map((r) => r.textContent)).toEqual([
      expect.stringContaining("Nobody"),
      expect.stringContaining("Owners ask"),
      expect.stringContaining("Administrator approves"),
    ]);
    expect(radios[0]!.getAttribute("aria-checked")).toBe("true");
    expect(button(area, /^Save$/)!.disabled).toBe(true);
    await click(radios[2]);
    await choose(field(area, "phoneCountryPicker") as HTMLSelectElement, "US");
    const chips = () => area.querySelector('ul[aria-label="Countries"]')!.textContent;
    expect(chips()).toContain("United States");
    expect(chips()).toContain("Brazil");
    await click(button(area, /Remove Brazil/));
    expect(chips()).not.toContain("Brazil");
    await click(button(area, /^Save$/));
    expect(t.log.patches).toEqual([
      { phoneRequestMode: "operator_approval", phoneCountries: "US" },
    ]);
    expect(area.textContent).toContain("Saved.");
  });

  test("the default provider is asked only when both are connected, and is saved", async () => {
    const t = await mount(base({ ...TELNYX_ON, ...TWILIO_ON, phoneDefaultProvider: "telnyx" }));
    const area = win.document.querySelector('section[aria-label="How people get numbers"]')!;
    const pick = field(area, "phoneDefaultProvider") as HTMLSelectElement;
    expect(pick.value).toBe("telnyx");
    await choose(pick, "twilio");
    await click(button(area, /^Save$/));
    expect(t.log.patches.at(-1)).toMatchObject({ phoneDefaultProvider: "twilio" });
  });

  test("saving a key keeps what is typed in this part", async () => {
    const t = await mount(base({ ...TELNYX_ON, phoneRequestMode: "off" }));
    const area = win.document.querySelector('section[aria-label="How people get numbers"]')!;
    await click(area.querySelectorAll('[role="radio"]')[1]);
    await open("Telnyx");
    await type(field(card("Telnyx"), "phoneKey"), "KEY-second-secret-123");
    await submit(card("Telnyx"));
    expect(t.log.keys).toEqual([["telnyx", "KEY-second-secret-123"]]);
    expect(area.querySelectorAll('[role="radio"]')[1]!.getAttribute("aria-checked")).toBe("true");
    expect(button(area, /^Save$/)!.disabled).toBe(false);
  });
});

describe("advanced", () => {
  test("the four limits are folded, checked as whole numbers and saved together", async () => {
    const t = await mount(base(TELNYX_ON));
    const form = win.document.querySelector('form[aria-label="Limits"]')!;
    expect(form.closest("details")).not.toBeNull();
    expect(form.closest("details")!.hasAttribute("open")).toBe(false);
    await type(field(form, "phoneMaxNumbers"), "many");
    await submit(form);
    expect(form.textContent).toContain("whole number");
    expect(t.log.patches).toEqual([]);
    await type(field(form, "phoneMaxNumbers"), "2");
    await submit(form);
    expect(t.log.patches).toEqual([
      {
        phoneMaxNumbers: 2,
        phoneMaxCallMinutes: 30,
        phoneDailyMinutesPerBot: 60,
        phoneDailyCallsPerBot: 20,
      },
    ]);
  });
});

describe("the logos", () => {
  test("each provider has its own mark, an image with no alt text", async () => {
    const { ProviderLogo } = await import("./provider-logo");
    const host = win.document.createElement("div");
    win.document.body.replaceChildren(host);
    const root = createRoot(host as unknown as Element);
    await act(async () =>
      root.render(
        <>
          <ProviderLogo provider="telnyx" />
          <ProviderLogo provider="twilio" />
        </>,
      ),
    );
    const imgs = [...host.querySelectorAll("img")];
    expect(imgs.map((i) => i.getAttribute("data-provider-logo"))).toEqual(["telnyx", "twilio"]);
    expect(imgs[0]!.getAttribute("src")).not.toBe(imgs[1]!.getAttribute("src"));
    expect(
      imgs.every((i) => i.getAttribute("alt") === "" && i.getAttribute("aria-hidden") === "true"),
    ).toBe(true);
    await act(async () => root.unmount());
  });
});
