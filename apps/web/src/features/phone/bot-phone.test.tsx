import { afterAll, afterEach, expect, test } from "bun:test";
import { QueryClientProvider } from "@tanstack/react-query";
import { act } from "react";
import { createRoot } from "react-dom/client";

import { setupDom } from "../skills/dom-env";

const win = setupDom();
const bunFormData = globalThis.FormData;
globalThis.FormData = win.FormData as never;
afterAll(() => {
  globalThis.FormData = bunFormData;
});

const BOT = "00000000-0000-7000-8000-0000000000c1";
const bot = (over: object = {}) => ({
  id: BOT,
  name: "Helper",
  kind: "specialist",
  canEdit: true,
  ...over,
});
const view = (over: object = {}) => ({
  id: "00000000-0000-7000-8000-0000000000d1",
  botId: BOT,
  number: "+15550100123",
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
  ...over,
});
const OFFER = { on: true, mode: "owner_request", countries: ["BR", "US"], maxNumbers: 5 };

let number: ReturnType<typeof view> | null = null;
let offer: typeof OFFER | { on: boolean; mode: string; countries: string[]; maxNumbers: number } =
  OFFER;
let refusal: { status: number; code: string; message: string } | undefined;
const writes: { method: string; path: string; body: Record<string, any> }[] = [];

globalThis.fetch = (async (input: URL | string, init?: RequestInit) => {
  const url = new URL(String(input));
  const method = init?.method ?? "GET";
  const body = init?.body ? JSON.parse(String(init.body)) : undefined;
  if (url.pathname === `/api/bots/${BOT}/phone` && method === "GET")
    return Response.json({ number, offer });
  if (method !== "GET") {
    writes.push({ method, path: url.pathname, body });
    if (refusal)
      return Response.json(
        { error: { code: refusal.code, message: refusal.message } },
        { status: refusal.status },
      );
    if (method === "DELETE") {
      number = null;
      return Response.json({ ok: true });
    }
    if (method === "POST")
      number = view({
        status: offer.mode === "operator_approval" ? "requested" : "active",
        number: offer.mode === "operator_approval" ? null : "+15550100123",
        note:
          offer.mode === "operator_approval"
            ? "Waiting for an administrator to approve this number."
            : "Ready.",
      });
    else if (url.pathname.endsWith("/pin")) number = view({ ...number, pinSet: body.pin !== null });
    else number = view({ ...number, ...body });
    return Response.json({ number });
  }
  return Response.json({ error: { code: "TEST", message: url.pathname } }, { status: 500 });
}) as typeof fetch;

const mounted: (() => Promise<void>)[] = [];
afterEach(async () => {
  for (const u of mounted.splice(0)) await u();
  number = null;
  offer = OFFER;
  refusal = undefined;
  writes.length = 0;
});
const settle = () => act(async () => void (await new Promise((r) => setTimeout(r, 60))));
const text = () => win.document.body.textContent ?? "";
async function mount(b: object = bot()) {
  const { BotPhoneSection } = await import("./bot-phone-section");
  const host = win.document.createElement("div");
  win.document.body.replaceChildren(host);
  const root = createRoot(host as unknown as Element);
  // The page's own writes refresh the shared client, so that is the one the section reads from.
  const { queryClient: client } = await import("@/lib/query-client");
  client.clear();
  await act(async () =>
    root.render(
      <QueryClientProvider client={client}>
        <BotPhoneSection bot={b as never} />
      </QueryClientProvider>,
    ),
  );
  await settle();
  mounted.push(() => act(async () => root.unmount()));
  return client;
}
const field = (name: string) =>
  win.document.querySelector(`[name="${name}"]`) as unknown as HTMLInputElement | null;
const press = async (label: string) => {
  const b = [...win.document.querySelectorAll("button")].find(
    (x) => x.textContent?.trim() === label,
  );
  if (!b) throw new Error(`no button "${label}" in: ${text()}`);
  await act(async () => void b.dispatchEvent(new win.MouseEvent("click", { bubbles: true })));
  await settle();
};
const submit = async (label: string) => {
  await act(
    async () =>
      void win.document
        .querySelector(`form[aria-label="${label}"]`)!
        .dispatchEvent(new win.Event("submit", { bubbles: true, cancelable: true }) as never),
  );
  await settle();
};

test("where nothing is set up it says so and offers nothing", async () => {
  offer = { on: false, mode: "off", countries: [], maxNumbers: 5 };
  await mount();
  expect(text()).toContain("This server does not give bots a phone number");
  expect(win.document.querySelector("button")).toBeNull();
});

test("Zetta can have a number like any other bot", async () => {
  await mount(bot({ kind: "chief", name: "Zetta" }));
  expect(text()).not.toContain("Only your other bots");
  expect(text()).toContain("Zetta has no phone number");
});

test("a bot with no number can ask for one in an allowed country, with an area code", async () => {
  await mount();
  expect(text()).toContain("Helper has no phone number");
  expect(text()).toContain("nothing is recorded");
  expect(text()).toContain("automated assistant");
  const area = field("phoneArea")!;
  await act(async () => {
    Object.getOwnPropertyDescriptor(win.HTMLInputElement.prototype, "value")!.set!.call(
      area,
      "415",
    );
    area.dispatchEvent(new win.Event("input", { bubbles: true }) as never);
  });
  await submit("Give this bot a phone number");
  expect(writes).toEqual([
    { method: "POST", path: `/api/bots/${BOT}/phone`, body: { country: "BR", areaCode: "415" } },
  ]);
});

test("in approval mode the button says it asks, and the request shows as waiting and can be withdrawn", async () => {
  offer = { ...OFFER, mode: "operator_approval" };
  await mount();
  expect(text()).toContain("An administrator approves the request");
  await press("Ask for a phone number");
  expect(text()).toContain("Waiting for an administrator to approve this number.");
  await press("Withdraw the request");
  expect(writes.at(-1)).toMatchObject({ method: "DELETE" });
});

test("a number under review shows the server's sentence about the three business days", async () => {
  number = view({
    status: "pending_review",
    country: "BR",
    note: "Being approved: this can take up to 3 business days.",
  });
  await mount();
  expect(text()).toContain("up to 3 business days");
  expect(text()).toContain("+15550100123");
});

test("an active number: who may call, calls out, the owner's number and the PIN", async () => {
  number = view();
  await mount();
  expect(text()).toContain("+15550100123");
  expect(text()).toContain("Your caller ID alone never proves it is you");
  const save = [...win.document.querySelectorAll("button")].find(
    (b) => b.textContent === "Save PIN",
  )!;
  expect(save.disabled).toBe(true);
  const owner = field("phoneOwner")!;
  await act(async () => {
    Object.getOwnPropertyDescriptor(win.HTMLInputElement.prototype, "value")!.set!.call(
      owner,
      "+1 555 0100 100",
    );
    owner.dispatchEvent(new win.Event("input", { bubbles: true }) as never);
  });
  await press("Save my number");
  expect(writes.at(-1)!.body).toEqual({ ownerNumber: "+1 555 0100 100" });
  const pin = field("phonePin")!;
  expect(pin.type).toBe("password");
  await act(async () => {
    Object.getOwnPropertyDescriptor(win.HTMLInputElement.prototype, "value")!.set!.call(
      pin,
      "4821",
    );
    pin.dispatchEvent(new win.Event("input", { bubbles: true }) as never);
  });
  await press("Save PIN");
  expect(writes.at(-1)).toMatchObject({
    method: "PUT",
    path: `/api/bots/${BOT}/phone/pin`,
    body: { pin: "4821" },
  });
  expect(field("phonePin")!.value).toBe("");
  expect(text()).not.toContain("4821");
});

test("a held number says it is not in service and offers no changes", async () => {
  number = view({
    status: "held",
    note: "This bot is archived. The number is kept for a while and answers that it is not in service.",
    heldUntil: "2026-12-23T10:00:00Z",
  });
  await mount();
  expect(text()).toContain("not in service");
  expect(text()).toContain("It is released on");
  expect(field("phoneInbound")).toBeNull();
  expect(
    [...win.document.querySelectorAll("button")].some((b) => /Release/.test(b.textContent ?? "")),
  ).toBe(false);
});

test("releasing and a refusal read plainly", async () => {
  number = view();
  await mount();
  refusal = {
    status: 502,
    code: "PHONE_PROVIDER",
    message: "The phone provider could not be reached. Try again in a moment.",
  };
  await press("Release this number");
  expect(
    [...win.document.querySelectorAll('[role="alert"]')].map((a) => a.textContent).join(" "),
  ).toContain("could not be reached");
});

const TWO = {
  ...OFFER,
  providers: [
    { id: "telnyx", countries: ["BR", "US"] },
    { id: "twilio", countries: ["BR", "US"] },
  ],
  defaultProvider: "twilio",
};
const choose = async (name: string, value: string) => {
  const el = field(name) as unknown as HTMLSelectElement;
  await act(async () => {
    el.value = value;
    el.dispatchEvent(new win.Event("change", { bubbles: true }) as never);
  });
};

test("with two ready providers the request shows a provider choice, the default chosen, and sends the choice", async () => {
  offer = TWO as never;
  await mount();
  const pick = field("phoneProvider") as unknown as HTMLSelectElement;
  expect(pick).not.toBeNull();
  expect(pick.value).toBe("twilio");
  expect([...pick.querySelectorAll("option")].map((o) => o.textContent).filter(Boolean)).toEqual([
    "Telnyx",
    "Twilio",
  ]);
  await choose("phoneProvider", "telnyx");
  await submit("Give this bot a phone number");
  expect(writes).toEqual([
    {
      method: "POST",
      path: `/api/bots/${BOT}/phone`,
      body: { country: "BR", areaCode: null, provider: "telnyx" },
    },
  ]);
});

test("the default provider goes with the request when the person leaves the choice alone", async () => {
  offer = TWO as never;
  await mount();
  await submit("Give this bot a phone number");
  expect(writes[0]!.body).toMatchObject({ provider: "twilio" });
});

test("with one ready provider, or an older server, there is no provider choice and none is sent", async () => {
  offer = {
    ...OFFER,
    providers: [{ id: "twilio", countries: ["US"] }],
    defaultProvider: "twilio",
  } as never;
  await mount();
  expect(field("phoneProvider")).toBeNull();
  await submit("Give this bot a phone number");
  expect(writes[0]!.body).not.toHaveProperty("provider");
});

test("a number says which provider holds it", async () => {
  number = view({ provider: "twilio" });
  await mount();
  expect(text()).toContain("Provider: Twilio");
});
