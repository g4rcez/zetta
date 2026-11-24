import { afterAll, afterEach, describe, expect, test } from "bun:test";
import { QueryClientProvider } from "@tanstack/react-query";
import { act, useState } from "react";
import { createRoot } from "react-dom/client";

import { setupDom } from "../skills/dom-env";
import type { PhoneSearch } from "./phone-filters";

const win = setupDom();
// The router restores scroll on load; the test DOM has no `scrollTo`.
Object.assign(globalThis, { scrollTo: () => {} });
// The library builds `new Event("change")` from the global, and happy-dom only takes its own Event class.
const realEvent = globalThis.Event;
globalThis.Event = win.Event as unknown as typeof Event;
const bunFormData = globalThis.FormData;
globalThis.FormData = win.FormData as never;
afterAll(() => {
  sharedClient.setDefaultOptions(previousDefaults);
  globalThis.Event = realEvent;
  globalThis.FormData = bunFormData;
});

const { queryClient: sharedClient } = await import("@/lib/query-client");
// A failed read is reported at once here, not retried.
const previousDefaults = sharedClient.getDefaultOptions();
sharedClient.setDefaultOptions({ queries: { ...previousDefaults.queries, retry: false } });

const id = (n: number) => `00000000-0000-7000-8000-${String(n).padStart(12, "0")}`;
const BOTS = [
  {
    id: id(1),
    name: "Helper",
    kind: "specialist",
    ownerUserId: "u1",
    ownerName: "Ana Souza",
    hasNumber: true,
  },
  {
    id: id(2),
    name: "Zetta",
    kind: "chief",
    ownerUserId: "u2",
    ownerName: "Bruno Lima",
    hasNumber: true,
  },
  {
    id: id(3),
    name: "Scout",
    kind: "specialist",
    ownerUserId: "u2",
    ownerName: "Bruno Lima",
    hasNumber: true,
  },
  {
    id: id(4),
    name: "Spare",
    kind: "specialist",
    ownerUserId: "u1",
    ownerName: "Ana Souza",
    hasNumber: false,
  },
];
const num = (n: number, over: object = {}) => ({
  id: id(100 + n),
  botId: BOTS[n - 1]!.id,
  provider: "telnyx",
  number: `+1202555010${n}`,
  country: "US",
  areaCode: null,
  status: "active",
  note: "Ready.",
  inbound: "owner_only",
  outbound: "on",
  ownerNumber: null,
  pinSet: false,
  pinLockedUntil: null,
  heldUntil: null,
  createdAt: "2026-11-23T10:00:00Z",
  ownerUserId: BOTS[n - 1]!.ownerUserId,
  botName: BOTS[n - 1]!.name,
  ...over,
});
const NUMBERS = [
  num(1, { status: "requested", number: null, provider: "twilio" }),
  num(2, { provider: "twilio", inbound: "anyone" }),
  num(3, { status: "held", heldUntil: "2026-12-23T10:00:00Z" }),
];
const OFFER_TWO = {
  on: true,
  mode: "operator_approval",
  countries: ["US"],
  maxNumbers: 5,
  providers: [
    { id: "telnyx", countries: ["US"] },
    { id: "twilio", countries: ["US"] },
  ],
  defaultProvider: "telnyx",
};
const OFFER_ONE = { ...OFFER_TWO, providers: [{ id: "telnyx", countries: ["US"] }] };
const OFFER_OFF = { on: false, mode: "off", countries: [], maxNumbers: 5, providers: [] };

const INSTALLATION_OFF = {
  networkMode: "local",
  onboarding: "done",
  phoneProvider: "off",
  phoneKey: "none",
};
const INSTALLATION_BOTH = {
  ...INSTALLATION_OFF,
  phoneProvider: "telnyx",
  phoneKey: "set",
  phonePublicKey: "pub",
  phoneApplicationId: "1234",
  phoneTwilio: "on",
  phoneTwilioKey: "set",
  phoneTwilioAccountSid: "AC00000000000000000000000000000000",
  phonePublicUrl: "https://zetta.example.invalid",
};
let installation: object = INSTALLATION_BOTH;
let numbers: object[] = NUMBERS;
let offer: object = OFFER_TWO;
let optouts: object[] = [
  {
    id: id(900),
    number: "+12025550900",
    reason: "caller_request",
    createdAt: "2026-11-23T10:00:00Z",
  },
];
let refusal: { status: number; code: string; message: string } | undefined;
const reads: string[] = [];
const writes: { method: string; path: string; body: Record<string, unknown> | undefined }[] = [];

globalThis.fetch = (async (input: URL | string, init?: RequestInit) => {
  const url = new URL(String(input));
  const method = init?.method ?? "GET";
  const body = init?.body ? JSON.parse(String(init.body)) : undefined;
  if (method === "GET") {
    reads.push(url.pathname);
    if (url.pathname === "/api/installation") return Response.json(installation);
    if (url.pathname === "/api/phone/numbers") return Response.json({ numbers });
    if (url.pathname === "/api/phone/bots") return Response.json({ bots: BOTS });
    if (url.pathname === "/api/phone/offer") return Response.json(offer);
    if (url.pathname === "/api/phone/optouts") return Response.json({ optouts });
    return Response.json({ error: { code: "TEST", message: url.pathname } }, { status: 500 });
  }
  writes.push({ method, path: url.pathname, body });
  if (refusal)
    return Response.json(
      { error: { code: refusal.code, message: refusal.message } },
      { status: refusal.status },
    );
  if (method === "PATCH" && url.pathname === "/api/installation") {
    installation = { ...installation, ...body };
    return Response.json(installation);
  }
  return Response.json({ ok: true, number: {} });
}) as typeof fetch;

const mounted: (() => Promise<void>)[] = [];
afterEach(async () => {
  for (const u of mounted.splice(0)) await u();
  win.document.body.replaceChildren();
  numbers = NUMBERS;
  installation = INSTALLATION_BOTH;
  offer = OFFER_TWO;
  refusal = undefined;
  reads.length = 0;
  writes.length = 0;
});
const settle = (ms = 60) => act(async () => void (await new Promise((r) => setTimeout(r, ms))));

type SearchCall = { next: PhoneSearch; how: string };
async function mount(search: PhoneSearch = {}, admin = true) {
  const { createMemoryHistory, createRootRoute, createRouter, RouterProvider } =
    await import("@tanstack/react-router");
  const { PhoneNumbersPage } = await import("./phone-admin");
  const { queryClient } = await import("@/lib/query-client");
  queryClient.clear();
  const calls: SearchCall[] = [];
  function Harness() {
    const [current, setCurrent] = useState(search);
    return (
      <QueryClientProvider client={queryClient}>
        <PhoneNumbersPage
          admin={admin}
          search={current}
          setSearch={(next, how) => {
            calls.push({ next, how });
            setCurrent(next);
          }}
        />
      </QueryClientProvider>
    );
  }
  const router = createRouter({
    routeTree: createRootRoute({ component: Harness }),
    history: createMemoryHistory({ initialEntries: ["/"] }),
  });
  await router.load();
  const host = win.document.createElement("div");
  win.document.body.replaceChildren(host);
  const root = createRoot(host as unknown as Element);
  await act(async () => root.render(<RouterProvider router={router} />));
  await settle();
  mounted.push(() => act(async () => root.unmount()));
  return { host: host as unknown as Element, calls };
}

const text = () => win.document.body.textContent ?? "";
const rowsText = () =>
  [...win.document.querySelectorAll("tbody tr")]
    .filter((r) => r.querySelector("td:nth-child(2)"))
    .map((r) => r.textContent ?? "");
const button = (label: RegExp, within: ParentNode = win.document) =>
  [...within.querySelectorAll("button")].find((b) => label.test(b.textContent?.trim() ?? "")) as
    | HTMLButtonElement
    | undefined;
const press = async (b: Element | undefined | null) => {
  if (!b) throw new Error(`nothing to press in: ${text()}`);
  await act(async () => {
    for (const type of ["pointerdown", "mousedown", "pointerup", "mouseup", "click"])
      b.dispatchEvent(new win.MouseEvent(type, { bubbles: true, button: 0 }) as never);
  });
  await settle();
};
const field = (name: string) =>
  win.document.querySelector(`[name="${name}"]`) as unknown as HTMLInputElement | null;
async function type(name: string, value: string) {
  const el = field(name)!;
  await act(async () => {
    Object.getOwnPropertyDescriptor(win.HTMLInputElement.prototype, "value")!.set!.call(el, value);
    el.dispatchEvent(new win.Event("input", { bubbles: true }) as never);
  });
}
async function choose(name: string, value: string) {
  const el = field(name) as unknown as HTMLSelectElement;
  await act(async () => {
    el.value = value;
    el.dispatchEvent(new win.Event("change", { bubbles: true }) as never);
  });
}
const submit = async (label: string) => {
  await act(
    async () =>
      void win.document
        .querySelector(`form[aria-label="${label}"]`)!
        .dispatchEvent(new win.Event("submit", { bubbles: true, cancelable: true }) as never),
  );
  await settle();
};
/** Opens the bot picker named `name` and chooses the option that reads `bot`. */
async function pickBot(name: string, bot: string) {
  const box = field(name)!.parentElement!.querySelector('[role="combobox"]')!;
  await press(box);
  const option = [...win.document.querySelectorAll('[role="option"]')].find((o) =>
    o.textContent?.includes(bot),
  );
  await press(option);
}
const alerts = () =>
  [...win.document.querySelectorAll('[role="alert"]')].map((a) => a.textContent).join(" ");

describe("who sees the page", () => {
  test("a member sees one sentence and nothing is asked of the server", async () => {
    await mount({}, false);
    expect(text()).toContain("Only administrators");
    expect(reads).toEqual([]);
    expect(win.document.querySelector('section[aria-label="Telnyx"]')).toBeNull();
    expect(win.document.querySelector("table")).toBeNull();
    expect(field("attachNumber")).toBeNull();
  });
  test("it says it is loading, then shows the numbers", async () => {
    const { createMemoryHistory, createRootRoute, createRouter, RouterProvider } =
      await import("@tanstack/react-router");
    const { PhoneNumbersPage } = await import("./phone-admin");
    const { queryClient } = await import("@/lib/query-client");
    queryClient.clear();
    const router = createRouter({
      routeTree: createRootRoute({
        component: () => (
          <QueryClientProvider client={queryClient}>
            <PhoneNumbersPage admin search={{}} setSearch={() => {}} />
          </QueryClientProvider>
        ),
      }),
      history: createMemoryHistory({ initialEntries: ["/"] }),
    });
    await router.load();
    const host = win.document.createElement("div");
    win.document.body.replaceChildren(host);
    const root = createRoot(host as unknown as Element);
    mounted.push(() => act(async () => root.unmount()));
    await act(async () => root.render(<RouterProvider router={router} />));
    expect(text()).toContain("Loading");
    await settle();
    expect(text()).not.toContain("Loading");
    expect(rowsText()).toHaveLength(3);
  });
});

describe("states", () => {
  test("phone not set up and no numbers: the cards are the way in, no attach form, no link to Decisions", async () => {
    numbers = [];
    offer = OFFER_OFF;
    installation = INSTALLATION_OFF;
    await mount();
    expect(text()).toContain("Once a provider is connected");
    expect(win.document.querySelector('section[aria-label="Telnyx"]')).not.toBeNull();
    expect(win.document.querySelector('section[aria-label="Twilio"]')).not.toBeNull();
    expect(win.document.querySelector("a[href='/studio/decisions']")).toBeNull();
    expect(text()).not.toContain("Decisions");
    expect(field("attachNumber")).toBeNull();
    expect(win.document.querySelector("table")).toBeNull();
  });
  test("set up and no numbers yet: says so and offers to attach one", async () => {
    numbers = [];
    await mount();
    expect(text()).toContain("No bot has a number or a request yet");
    expect(field("attachNumber")).not.toBeNull();
  });
  test("a failure to load reads in words", async () => {
    const real = globalThis.fetch;
    globalThis.fetch = (async (input: URL | string, init?: RequestInit) =>
      new URL(String(input)).pathname === "/api/phone/numbers"
        ? Response.json(
            { error: { code: "UNAVAILABLE", message: "Something went wrong. Please retry." } },
            { status: 500 },
          )
        : real(input, init)) as typeof fetch;
    try {
      await mount();
      expect(alerts()).toContain("Something went wrong");
    } finally {
      globalThis.fetch = real;
    }
  });
});

describe("setup on the page", () => {
  test("both providers connected: the setup sits above the numbers", async () => {
    await mount();
    const html = win.document.body.innerHTML;
    expect(html.indexOf('aria-label="Telnyx"')).toBeLessThan(html.indexOf("<table"));
    expect(html.indexOf('aria-label="How people get numbers"')).toBeLessThan(
      html.indexOf("<table"),
    );
    expect(win.document.querySelectorAll("[data-status].inline-flex")).toHaveLength(2);
    expect(win.document.querySelector("img[data-provider-logo=telnyx]")).not.toBeNull();
  });
  test("Disconnect from the page sends one PATCH and no key in the open", async () => {
    await mount();
    await press(button(/^Edit$/, win.document.querySelector('section[aria-label="Telnyx"]')!));
    await press(
      button(/^Disconnect$/, win.document.querySelector('section[aria-label="Telnyx"]')!),
    );
    await press(button(/^Yes, disconnect$/));
    const patch = writes.find((w) => w.method === "PATCH");
    expect(patch?.path).toBe("/api/installation");
    expect(patch?.body).toEqual({ phoneProvider: "off", phoneDefaultProvider: "twilio" });
    expect(
      writes.some((w) => w.method === "DELETE" && w.path === "/api/connections/phone-key"),
    ).toBe(true);
    expect(JSON.stringify(writes)).not.toMatch(/secret|"key"/);
  });
});

describe("the table", () => {
  test("each number: formatted, provider, bot, owner, status and who may call; Zetta as such", async () => {
    await mount();
    const rows = rowsText();
    expect(rows).toHaveLength(3);
    expect(rows[0]).toContain("US");
    expect(rows[0]).toContain("Twilio");
    expect(rows[0]).toContain("Helper");
    expect(rows[0]).toContain("Ana Souza");
    expect(rows[0]).toContain("Requested");
    expect(rows[1]).toContain("+1 (202) 555-0102");
    expect(rows[1]).toContain("Zetta");
    expect(rows[1]).toContain("Bruno Lima");
    expect(rows[1]).toContain("Active");
    expect(rows[1]).toContain("Anyone");
    expect(rows[2]).toContain("Telnyx");
    expect(rows[2]).toContain("Scout");
    expect(rows[2]).toMatch(/Held until .*2026|Held until .*12/);
    expect(text()).toContain("3 numbers");
  });
});

describe("filters in the address", () => {
  test("a status in the address shows only those numbers, with no click", async () => {
    await mount({ status: "held" });
    expect(rowsText()).toHaveLength(1);
    expect(rowsText()[0]).toContain("Scout");
    expect((field("status") as unknown as HTMLSelectElement).value).toBe("held");
    expect(text()).toContain("1 of 3 numbers");
  });
  test("a provider and a text in the address", async () => {
    await mount({ provider: "twilio" });
    expect(rowsText()).toHaveLength(2);
    await mount({ provider: "twilio", q: "bruno" });
    expect(rowsText()).toHaveLength(1);
    expect((field("q") as unknown as HTMLInputElement).value).toBe("bruno");
    await mount({ q: "555 0103" });
    expect(rowsText()[0]).toContain("Scout");
  });
  test("nothing matches: a sentence and a way back", async () => {
    await mount({ status: "failed" });
    expect(text()).toContain("No number matches");
    expect(rowsText()).toHaveLength(0);
    expect(win.document.querySelector("a[href='/studio/phone']")).not.toBeNull();
  });
  test("choosing a filter writes it to the address (a history entry); typing replaces; all drops it", async () => {
    const { calls } = await mount({ q: "a" });
    await choose("status", "active");
    expect(calls.at(-1)).toEqual({ next: { q: "a", status: "active" }, how: "push" });
    await choose("provider", "twilio");
    expect(calls.at(-1)).toEqual({
      next: { q: "a", status: "active", provider: "twilio" },
      how: "push",
    });
    await choose("status", "all");
    expect(calls.at(-1)).toEqual({ next: { q: "a", provider: "twilio" }, how: "push" });
    await type("q", "zet");
    expect(calls.at(-1)).toEqual({ next: { provider: "twilio", q: "zet" }, how: "replace" });
    await type("q", "");
    expect(calls.at(-1)).toEqual({ next: { provider: "twilio" }, how: "replace" });
  });
});

describe("actions on a row", () => {
  test("approve and turn down act on a request", async () => {
    await mount();
    await press(button(/^Approve and buy$/));
    expect(writes.at(-1)).toMatchObject({
      method: "POST",
      path: `/api/phone/numbers/${NUMBERS[0]!.id}/approve`,
    });
    await press(button(/^Turn down$/));
    expect(writes.at(-1)).toMatchObject({
      method: "POST",
      path: `/api/phone/numbers/${NUMBERS[0]!.id}/reject`,
    });
  });
  test("release asks first and keeps the number when told to", async () => {
    await mount();
    const row = win.document.querySelectorAll("tbody tr")[1]!;
    await press(button(/^Release$/, row));
    expect(writes).toEqual([]);
    expect(text()).toContain("Release +1 (202) 555-0102 now?");
    await press(button(/^Keep it$/));
    expect(writes).toEqual([]);
    await press(button(/^Release$/, row));
    await press(button(/^Release now$/));
    expect(writes.at(-1)).toMatchObject({
      method: "POST",
      path: `/api/phone/numbers/${NUMBERS[1]!.id}/release`,
    });
  });
  test("reassign: a picker with each bot's owner and whether it has a number, Zetta a normal choice", async () => {
    await mount();
    const row = win.document.querySelectorAll("tbody tr")[2]!;
    await press(button(/^Reassign$/, row));
    expect(button(/^Move the number$/)!.disabled).toBe(true);
    const form = win.document.querySelector('form[aria-label^="Reassign"]')!;
    await press(form.querySelector('[role="combobox"]'));
    const options = [...win.document.querySelectorAll('[role="option"]')].map(
      (o) => o.textContent ?? "",
    );
    // The bot that holds the number is not offered to itself.
    expect(options.some((o) => o.includes("Scout"))).toBe(false);
    expect(options.find((o) => o.includes("Zetta"))).toContain("Bruno Lima");
    expect(options.find((o) => o.includes("Zetta"))).toContain("has a number");
    expect(options.find((o) => o.includes("Spare"))).toContain("Ana Souza");
    expect(options.find((o) => o.includes("Spare"))).not.toContain("has a number");
    await press(
      [...win.document.querySelectorAll('[role="option"]')].find((o) =>
        o.textContent?.includes("Spare"),
      ),
    );
    await press(button(/^Move the number$/));
    expect(writes.at(-1)).toEqual({
      method: "POST",
      path: `/api/phone/numbers/${NUMBERS[2]!.id}/reassign`,
      body: { botId: BOTS[3]!.id },
    });
    expect(text()).toContain("The number was moved.");
  });
  test("a refusal from the server is shown as the server wrote it", async () => {
    await mount();
    refusal = {
      status: 409,
      code: "PHONE_WRONG_STATE",
      message: "A call is running on that number. Move it after the call.",
    };
    await press(button(/^Approve and buy$/));
    expect(alerts()).toContain("A call is running on that number");
  });
});

describe("attach a number I own", () => {
  async function fill(number: string, bot: string) {
    await type("attachNumber", number);
    await pickBot("attachBot", bot);
  }
  test("with two ready providers it asks which, the default chosen, and sends number, bot and provider", async () => {
    await mount();
    const pick = field("attachProvider") as unknown as HTMLSelectElement;
    expect(pick.value).toBe("telnyx");
    expect(button(/^Attach the number$/)!.disabled).toBe(true);
    await choose("attachProvider", "twilio");
    await fill("+1 202 555 0150", "Spare");
    await submit("Attach a number I own");
    expect(writes.at(-1)).toEqual({
      method: "POST",
      path: "/api/phone/numbers/attach",
      body: { number: "+1 202 555 0150", botId: BOTS[3]!.id, provider: "twilio" },
    });
    expect(text()).toContain("The number is attached.");
    expect((field("attachNumber") as unknown as HTMLInputElement).value).toBe("");
  });
  test("with one ready provider there is no provider choice and none is sent", async () => {
    offer = OFFER_ONE;
    await mount();
    expect(field("attachProvider")).toBeNull();
    await fill("+1 202 555 0150", "Zetta");
    await submit("Attach a number I own");
    expect(writes.at(-1)!.body).toEqual({ number: "+1 202 555 0150", botId: BOTS[1]!.id });
  });
  for (const [what, status, code, message] of [
    [
      "the number is not in the account",
      404,
      "PHONE_NO_NUMBER",
      "That number is not on your Twilio account.",
    ],
    [
      "the country is not allowed",
      400,
      "PHONE_COUNTRY",
      "Numbers in that country are not allowed on this server.",
    ],
    [
      "the bot already has one",
      409,
      "PHONE_HAVE_ONE",
      "That bot already has a number or a request for one.",
    ],
  ] as const)
    test(`refused because ${what}: the server's sentence is shown and the form is kept`, async () => {
      await mount();
      refusal = { status, code, message };
      await fill("+1 202 555 0151", "Helper");
      await submit("Attach a number I own");
      expect(alerts()).toContain(message);
      expect(text()).not.toContain("The number is attached.");
    });
});

describe("the do-not-call list", () => {
  test("lists, adds and removes", async () => {
    await mount();
    expect(text()).toContain("+12025550900");
    await type("optoutNumber", "+1 202 555 0777");
    await act(
      async () =>
        void field("optoutNumber")!
          .closest("form")!
          .dispatchEvent(new win.Event("submit", { bubbles: true, cancelable: true }) as never),
    );
    await settle();
    expect(writes.at(-1)).toEqual({
      method: "POST",
      path: "/api/phone/optouts",
      body: { number: "+1 202 555 0777" },
    });
    const list = win.document.querySelector('section[aria-label="Do not call"]')!;
    await press(button(/^Remove$/, list));
    expect(writes.at(-1)).toMatchObject({
      method: "DELETE",
      path: `/api/phone/optouts/${id(900)}`,
    });
  });
});
