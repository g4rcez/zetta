// The phone routes: who may call what, how errors read, and that the public health route needs no sign-in. The rules of numbers
// themselves are in service.integration.test.ts.
import { describe, expect, test } from "bun:test";
import { Elysia } from "elysia";
import { AccessError, createIdentityAccess } from "../identity/access";
import type { PhoneCalls } from "./calls";
import { createPhoneRoutes } from "./routes";
import { PhoneError, type PhoneService } from "./service";

const origin = "https://app.example.invalid";
const BOT = "00000000-0000-7000-8000-0000000000b1";
const NUM = "00000000-0000-7000-8000-0000000000c1";
const CALL = "00000000-0000-7000-8000-0000000000d1";
const access = createIdentityAccess(
  {
    api: {
      getSession: async ({ headers }: { headers: Headers }) => {
        const id = headers.get("cookie");
        return id ? { user: { id } } : null;
      },
    },
  } as never,
  async (id) => ({ isAdmin: id === "admin" }),
);
const seen: string[] = [];
const view = { id: NUM, status: "active" };
const stub = {
  offer: async () => ({ on: true, mode: "owner_request", countries: ["US"], maxNumbers: 5 }),
  get: async () => view,
  request: async (_a: unknown, bot: string, input: { country: string }) => {
    seen.push(`request:${bot}:${input.country}`);
    if (input.country === "XX")
      throw new PhoneError("COUNTRY", "Numbers in that country are not offered here.");
    return view;
  },
  update: async (_a: unknown, _b: string, patch: unknown) => (
    seen.push(`update:${JSON.stringify(patch)}`),
    view
  ),
  setPin: async (_a: unknown, _b: string, pin: string | null) => (seen.push(`pin:${pin}`), view),
  release: async () => {
    seen.push("release");
    throw new AccessError("NOT_FOUND");
  },
  list: async () => [],
  approve: async () => view,
  reject: async () => undefined,
  operatorRelease: async () => undefined,
  attach: async (_a: unknown, i: { botId: string; number: string }) => {
    seen.push(`attach:${i.botId}:${i.number}`);
    if (i.number === "+12025550100")
      throw new PhoneError("NO_NUMBER", "The provider account does not hold that number.");
    return view;
  },
  reassign: async (_a: unknown, id: string, botId: string) => (
    seen.push(`reassign:${id}:${botId}`),
    view
  ),
  assignableBots: async () => [
    {
      id: BOT,
      name: "Helper",
      kind: "specialist",
      ownerUserId: "u",
      ownerName: "Ana",
      hasNumber: false,
    },
  ],
  optouts: async () => [],
  addOptout: async (_a: unknown, n: string, r?: string) => (
    seen.push(`optout:${n}:${r}`),
    { number: n }
  ),
  removeOptout: async () => undefined,
  liveCalls: async (a: { userId: string }) => [
    {
      id: CALL,
      botName: "Caller",
      number: "+12025550123",
      status: "active",
      requestedIn: null,
      startedAt: "x",
      who: a.userId,
    },
  ],
} as unknown as PhoneService;
const hung: string[] = [];
const calls = {
  hangUp: async (userId: string, id: string) => (hung.push(`${userId}:${id}`), userId === "member"),
} as unknown as PhoneCalls;
const app = new Elysia().use(createPhoneRoutes({ access, phone: stub, calls }, [origin]));
const call = async (
  as: string | null,
  method: string,
  path: string,
  body?: unknown,
  o = origin,
) => {
  const r = await app.handle(
    new Request(`http://localhost${path}`, {
      method,
      headers: { ...(as ? { cookie: as } : {}), origin: o, "content-type": "application/json" },
      body: body === undefined ? undefined : JSON.stringify(body),
    }),
  );
  return { status: r.status, json: await r.json().catch(() => null) };
};

describe("access", () => {
  test("health needs no sign-in and says nothing else", async () => {
    expect(await call(null, "GET", "/api/phone/health")).toEqual({
      status: 200,
      json: { ok: true },
    });
  });
  test("everything else needs a signed-in person", async () => {
    for (const [m, p] of [
      ["GET", "/api/phone/offer"],
      ["GET", `/api/bots/${BOT}/phone`],
      ["POST", `/api/bots/${BOT}/phone`],
      ["GET", "/api/phone/numbers"],
    ] as const)
      expect((await call(null, m, p, m === "POST" ? { country: "US" } : undefined)).status).toBe(
        401,
      );
  });
  test("the administrator routes refuse a member and do not touch the service", async () => {
    const before = seen.length;
    for (const [m, p, b] of [
      ["GET", "/api/phone/numbers", undefined],
      ["POST", `/api/phone/numbers/${NUM}/approve`, {}],
      ["POST", `/api/phone/numbers/${NUM}/reject`, {}],
      ["POST", `/api/phone/numbers/${NUM}/release`, {}],
      ["POST", "/api/phone/numbers/attach", { botId: BOT, number: "+12025550123" }],
      ["POST", `/api/phone/numbers/${NUM}/reassign`, { botId: BOT }],
      ["GET", "/api/phone/bots", undefined],
      ["GET", "/api/phone/optouts", undefined],
      ["POST", "/api/phone/optouts", { number: "+15550100777" }],
      ["DELETE", `/api/phone/optouts/${NUM}`, undefined],
    ] as const)
      expect((await call("member", m, p, b)).status).toBe(403);
    expect(seen.length).toBe(before);
    expect((await call("admin", "GET", "/api/phone/numbers")).status).toBe(200);
    expect(
      (
        await call("admin", "POST", "/api/phone/optouts", {
          number: "+15550100777",
          reason: "complaint",
        })
      ).status,
    ).toBe(200);
    expect(seen.at(-1)).toBe("optout:+15550100777:complaint");
  });
  test("a write from another site is refused", async () => {
    expect(
      (
        await call(
          "member",
          "POST",
          `/api/bots/${BOT}/phone`,
          { country: "US" },
          "https://evil.example.invalid",
        )
      ).status,
    ).toBe(403);
  });
});

describe("the owner's routes", () => {
  test("ask, change, set a PIN, and see the offer with the number", async () => {
    expect(
      (await call("member", "POST", `/api/bots/${BOT}/phone`, { country: "US", areaCode: "415" }))
        .status,
    ).toBe(200);
    expect(seen.at(-1)).toBe(`request:${BOT}:US`);
    await call("member", "PATCH", `/api/bots/${BOT}/phone`, {
      inbound: "anyone",
      ownerNumber: "+15550100100",
    });
    expect(seen.at(-1)).toBe('update:{"inbound":"anyone","ownerNumber":"+15550100100"}');
    await call("member", "PUT", `/api/bots/${BOT}/phone/pin`, { pin: "4821" });
    expect(seen.at(-1)).toBe("pin:4821");
    const read = await call("member", "GET", `/api/bots/${BOT}/phone`);
    expect(read.json).toMatchObject({
      number: { id: NUM },
      offer: { on: true, mode: "owner_request" },
    });
  });
  test("bad input and a number's own errors read plainly", async () => {
    expect(
      (await call("member", "POST", `/api/bots/${BOT}/phone`, { country: "USA" })).status,
    ).toBe(400);
    expect(
      (await call("member", "PATCH", `/api/bots/${BOT}/phone`, { inbound: "everyone" })).status,
    ).toBe(400);
    expect((await call("member", "PATCH", `/api/bots/${BOT}/phone`, { unknown: 1 })).status).toBe(
      400,
    );
    expect((await call("member", "GET", "/api/bots/not-an-id/phone")).status).toBe(400);
    const refused = await call("member", "POST", `/api/bots/${BOT}/phone`, { country: "XX" });
    expect(refused.status).toBe(400);
    expect(refused.json).toMatchObject({
      error: { code: "PHONE_COUNTRY", message: "Numbers in that country are not offered here." },
    });
    expect((await call("member", "DELETE", `/api/bots/${BOT}/phone`)).status).toBe(404);
  });
});

describe("attaching and moving a number (administrators)", () => {
  test("attach, reassign and the bot picker work for an administrator", async () => {
    expect(
      (
        await call("admin", "POST", "/api/phone/numbers/attach", {
          botId: BOT,
          number: "+12025550123",
        })
      ).status,
    ).toBe(200);
    expect(seen.at(-1)).toBe(`attach:${BOT}:+12025550123`);
    expect(
      (await call("admin", "POST", `/api/phone/numbers/${NUM}/reassign`, { botId: BOT })).status,
    ).toBe(200);
    expect(seen.at(-1)).toBe(`reassign:${NUM}:${BOT}`);
    const bots = await call("admin", "GET", "/api/phone/bots");
    expect(bots.json).toMatchObject({ bots: [{ id: BOT, ownerName: "Ana", hasNumber: false }] });
  });
  test("strict input and plain errors", async () => {
    for (const body of [
      { botId: "nope", number: "+12025550123" },
      { botId: BOT },
      { botId: BOT, number: "+12025550123", extra: 1 },
    ])
      expect((await call("admin", "POST", "/api/phone/numbers/attach", body)).status).toBe(400);
    expect((await call("admin", "POST", `/api/phone/numbers/${NUM}/reassign`, {})).status).toBe(
      400,
    );
    expect(
      (await call("admin", "POST", "/api/phone/numbers/not-an-id/reassign", { botId: BOT })).status,
    ).toBe(400);
    const gone = await call("admin", "POST", "/api/phone/numbers/attach", {
      botId: BOT,
      number: "+12025550100",
    });
    expect(gone.status).toBe(404);
    expect(gone.json).toMatchObject({ error: { code: "PHONE_NO_NUMBER" } });
  });
  test("a write from another site is refused", async () => {
    expect(
      (
        await call(
          "admin",
          "POST",
          "/api/phone/numbers/attach",
          { botId: BOT, number: "+12025550123" },
          "https://evil.example.invalid",
        )
      ).status,
    ).toBe(403);
  });
});

describe("calls a bot placed", () => {
  test("the live list and Hang up need a signed-in person from this site", async () => {
    expect((await call(null, "GET", "/api/phone/calls/live")).status).toBe(401);
    expect((await call(null, "POST", `/api/phone/calls/${CALL}/hangup`, {})).status).toBe(401);
    expect(
      (
        await call(
          "member",
          "POST",
          `/api/phone/calls/${CALL}/hangup`,
          {},
          "https://evil.example.invalid",
        )
      ).status,
    ).toBe(403);
    expect(hung).toEqual([]);
  });
  test("Hang up goes to the call of this person only; another person gets not found", async () => {
    expect(
      ((await call("member", "GET", "/api/phone/calls/live")).json as any).calls[0],
    ).toMatchObject({ id: CALL, who: "member" });
    expect(await call("member", "POST", `/api/phone/calls/${CALL}/hangup`, {})).toEqual({
      status: 200,
      json: { ok: true },
    });
    expect((await call("other", "POST", `/api/phone/calls/${CALL}/hangup`, {})).status).toBe(404);
    expect(hung).toEqual([`member:${CALL}`, `other:${CALL}`]);
    expect((await call("member", "POST", "/api/phone/calls/not-an-id/hangup", {})).status).toBe(
      400,
    );
  });
});
