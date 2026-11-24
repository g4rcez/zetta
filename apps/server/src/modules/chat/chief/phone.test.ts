// The Chief's `zetta:phone` block against a stub of the phone service: what it reads, which changes are cards, what an administrator alone
// may do, and that no action touches a PIN.
import { describe, expect, test } from "bun:test";
import { parseTools } from "../tools";
import { applyPhone, runPhone } from "./phone";
import { actionKeyOf, NEVER_REMEMBERED_TOOLS } from "../approval-rules";
import { chiefSchemas } from "./schemas";

const BOT = "018f0000-0000-7000-8000-0000000000b1";
const fence = (body: string) => "```zetta:phone\n" + body + "\n```";

function setup(o: { admin?: boolean; have?: object | null; offer?: object } = {}) {
  const calls: string[] = [];
  const bots = [
    { id: BOT, name: "Helper", kind: "specialist", archived: false },
    { id: "c", name: "Chief", kind: "chief", archived: false },
  ];
  const db = { select: () => ({ from: () => ({ where: () => ({ orderBy: async () => bots }) }) }) };
  const view = (over: object = {}) => ({
    id: "n1",
    botId: BOT,
    botName: "Helper",
    number: "+15550100123",
    country: "US",
    areaCode: null,
    status: "active",
    note: "Ready.",
    inbound: "owner_only",
    outbound: "on",
    ownerNumber: null,
    pinSet: false,
    ...over,
  });
  const phone = {
    offer: async () => ({
      on: true,
      mode: "owner_request",
      countries: ["BR", "US"],
      maxNumbers: 5,
      ...o.offer,
    }),
    get: async () => (o.have === undefined ? null : o.have),
    list: async () => [
      view({ status: "requested", number: null, country: "BR", areaCode: "11" }),
      view({ id: "n2", botName: "Old", botId: "old" }),
    ],
    request: async (_a: unknown, b: string, i: unknown) =>
      void calls.push(`request:${b}:${JSON.stringify(i)}`),
    release: async (_a: unknown, b: string) => void calls.push(`release:${b}`),
    update: async (_a: unknown, b: string, p: unknown) =>
      void calls.push(`update:${b}:${JSON.stringify(p)}`),
    assignableBots: async () => [
      {
        id: BOT,
        name: "Helper",
        kind: "specialist",
        ownerUserId: "u2",
        ownerName: "Ana",
        hasNumber: false,
      },
      {
        id: "c",
        name: "Zetta",
        kind: "chief",
        ownerUserId: "u",
        ownerName: "Bia",
        hasNumber: false,
      },
      {
        id: "t",
        name: "Busy",
        kind: "specialist",
        ownerUserId: "u",
        ownerName: "Bia",
        hasNumber: true,
      },
      {
        id: "d1",
        name: "Twin",
        kind: "specialist",
        ownerUserId: "u",
        ownerName: "Bia",
        hasNumber: false,
      },
      {
        id: "d2",
        name: "Twin",
        kind: "specialist",
        ownerUserId: "u2",
        ownerName: "Ana",
        hasNumber: false,
      },
    ],
    attach: async (_a: unknown, i: unknown) => void calls.push(`attach:${JSON.stringify(i)}`),
    reassign: async (_a: unknown, id: string, b: string) => void calls.push(`reassign:${id}:${b}`),
    approve: async (_a: unknown, id: string) => void calls.push(`approve:${id}`),
    reject: async (_a: unknown, id: string) => void calls.push(`reject:${id}`),
    addOptout: async (_a: unknown, n: string) => void calls.push(`optout:${n}`),
    calls: async (_a: unknown, o: { botId?: string; limit?: number }) => {
      calls.push(`calls:${o.botId ?? "all"}:${o.limit}`);
      return [
        {
          id: "c1",
          botId: BOT,
          botName: "Helper",
          direction: "out",
          peer: "+12025550123",
          status: "ended",
          outcome: "done",
          endReason: "hangup",
          durationSeconds: 61,
          startedAt: "2026-11-23T18:00:00.000Z",
          conversationId: "conv-1",
        },
      ];
    },
  };
  const ctx = { actor: { userId: "u", isAdmin: o.admin ?? false }, deps: { db, phone } } as never;
  return { ctx, calls, view };
}
const run = (ctx: never, body: object) => runPhone(ctx, chiefSchemas.phone.parse(body));

describe("reading", () => {
  test("get says whether phone is offered and what the bot has, never a PIN", async () => {
    const t = setup({
      have: {
        number: "+15550100123",
        country: "US",
        status: "active",
        note: "Ready.",
        inbound: "owner_only",
        outbound: "on",
        ownerNumber: "+15550100100",
        pinSet: true,
        pinHash: "scrypt$x",
      },
    });
    const r = (await run(t.ctx, { action: "get", bot: "helper" })) as { read: string };
    expect(r.read).toContain("+15550100123");
    expect(r.read).toContain('"pinSet":true');
    expect(r.read).not.toContain("scrypt");
  });
  test("list is for administrators", async () => {
    expect(await run(setup().ctx, { action: "list" })).toEqual({
      error: "only an administrator sees every number.",
    });
    expect(
      ((await run(setup({ admin: true }).ctx, { action: "list" })) as { read: string }).read,
    ).toContain("Helper");
  });
  test("a bot that does not exist is refused, and the Chief (Zetta) is a bot like any other", async () => {
    expect(await run(setup().ctx, { action: "get", bot: "Nobody" })).toMatchObject({
      error: expect.stringContaining("no bot called"),
    });
    const zetta = await run(setup().ctx, { action: "get", bot: "Chief" });
    expect(zetta).not.toHaveProperty("error");
  });
});

describe("call history", () => {
  test("calls is a read for the owner: number, outcome and length, never a transcript or a conversation", async () => {
    const t = setup();
    const r = (await run(t.ctx, { action: "calls", bot: "helper", limit: 5 })) as { read: string };
    expect(t.calls).toEqual([`calls:${BOT}:5`]);
    expect(r.read).toContain("+12025550123");
    expect(r.read).toContain('"outcome":"done"');
    expect(r.read).toContain('"seconds":61');
    expect(r.read).not.toContain("conv-1");
    expect(r.read).not.toContain("endReason");
    expect(t.calls.some((c) => !c.startsWith("calls:"))).toBe(false);
  });
  test("without a bot it lists all; an unknown bot is an error; there is no way to place a call here", async () => {
    const t = setup();
    await run(t.ctx, { action: "calls" });
    expect(t.calls).toEqual(["calls:all:20"]);
    expect(await run(t.ctx, { action: "calls", bot: "Nobody" })).toMatchObject({
      error: expect.stringContaining("no bot called"),
    });
    for (const bad of [
      '{"action":"call","bot":"Helper","number":"+12025550123"}',
      '{"action":"dial","number":"+12025550123"}',
    ]) {
      const r = parseTools(fence(bad));
      expect(r.calls).toEqual([]);
      expect(r.rejected).toHaveLength(1);
    }
  });
});

describe("changes are cards", () => {
  test("a request is a plan that names the cost, or the approval step", async () => {
    const r = (await run(setup().ctx, {
      action: "request",
      bot: "Helper",
      country: "us",
      area_code: "415",
    })) as any;
    expect(r.plan.title).toBe("Give Helper a phone number");
    expect(r.plan.diff[0].to).toContain("costs a monthly fee");
    expect(r.plan.patch).toEqual({
      tool: "phone",
      op: "request",
      botId: BOT,
      country: "US",
      areaCode: "415",
    });
    const approval = (await run(setup({ offer: { mode: "operator_approval" } }).ctx, {
      action: "request",
      bot: "Helper",
      country: "US",
    })) as any;
    expect(approval.plan.diff[0].to).toContain("an administrator approves it");
  });
  test("not offered, a country that is not allowed, and a bot that already has one are errors", async () => {
    expect(
      await run(setup({ offer: { on: false, mode: "off", countries: [] } }).ctx, {
        action: "request",
        bot: "Helper",
        country: "US",
      }),
    ).toMatchObject({ error: expect.stringContaining("does not hand out") });
    expect(
      await run(setup().ctx, { action: "request", bot: "Helper", country: "FR" }),
    ).toMatchObject({ error: expect.stringContaining("not offered here") });
    expect(
      await run(setup({ have: { status: "active", number: "+15550100123" } }).ctx, {
        action: "request",
        bot: "Helper",
        country: "US",
      }),
    ).toMatchObject({ error: expect.stringContaining("already has") });
  });
  test("settings show only what changes; no change is an error", async () => {
    const have = {
      status: "active",
      number: "+15550100123",
      inbound: "owner_only",
      outbound: "on",
      ownerNumber: null,
    };
    const r = (await run(setup({ have }).ctx, {
      action: "settings",
      bot: "Helper",
      inbound: "anyone",
      outbound: "on",
    })) as any;
    expect(r.plan.diff).toEqual([{ field: "who may call", from: "owner_only", to: "anyone" }]);
    expect(
      await run(setup({ have }).ctx, { action: "settings", bot: "Helper", outbound: "on" }),
    ).toMatchObject({ error: expect.stringContaining("already has") });
    expect(await run(setup().ctx, { action: "release", bot: "Helper" })).toMatchObject({
      error: expect.stringContaining("has no phone number"),
    });
  });
  test("approve, reject and optout are administrators' cards", async () => {
    for (const body of [
      { action: "approve", bot: "Helper" },
      { action: "reject", bot: "Helper" },
      { action: "optout", number: "+15550100777" },
    ])
      expect(await run(setup().ctx, body)).toMatchObject({
        error: expect.stringContaining("administrator"),
      });
    const t = setup({ admin: true });
    const r = (await run(t.ctx, { action: "approve", bot: "Helper" })) as any;
    expect(r.plan.patch).toEqual({ tool: "phone", op: "approve", id: "n1", bot: "Helper" });
    expect(await run(t.ctx, { action: "approve", bot: "Nobody" })).toMatchObject({
      error: expect.stringContaining("no request"),
    });
  });
});

describe("attach and reassign", () => {
  test("only an administrator gets a card, with the owner shown, and never an always-allow", async () => {
    for (const body of [
      { action: "attach", bot: "Helper", number: "+12025550123" },
      { action: "reassign", number: "+15550100123", bot: "Helper" },
    ])
      expect(await run(setup().ctx, body)).toMatchObject({
        error: expect.stringContaining("administrator"),
      });
    const t = setup({ admin: true });
    const r = (await run(t.ctx, {
      action: "attach",
      bot: "Helper",
      number: "+1 202 555 0123",
    })) as any;
    expect(r.plan.patch).toEqual({
      tool: "phone",
      op: "attach",
      botId: BOT,
      number: "+12025550123",
      bot: "Helper",
    });
    expect(r.plan.diff[0].to).toContain("owner Ana");
    expect(t.calls).toEqual([]);
    const z = (await run(t.ctx, { action: "attach", bot: "Zetta", number: "+12025550123" })) as any;
    expect(z.plan.patch.botId).toBe("c");
    const m = (await run(t.ctx, {
      action: "reassign",
      number: "+15550100123",
      bot: "Helper",
    })) as any;
    expect(m.plan.patch).toEqual({
      tool: "phone",
      op: "reassign",
      id: "n2",
      botId: BOT,
      bot: "Helper",
    });
    expect(m.plan.diff.map((d: { field: string }) => d.field)).toContain("owner's number and PIN");
    expect(actionKeyOf("chief_action", r.plan.patch)).toBe("phone");
    expect(NEVER_REMEMBERED_TOOLS.has("phone")).toBe(true);
  });
  test("refuses a busy bot, an ambiguous name, a bad number and an unknown number", async () => {
    const t = setup({ admin: true });
    expect(
      await run(t.ctx, { action: "attach", bot: "Busy", number: "+12025550123" }),
    ).toMatchObject({
      error: expect.stringContaining("already has"),
    });
    expect(
      await run(t.ctx, { action: "attach", bot: "Twin", number: "+12025550123" }),
    ).toMatchObject({
      error: expect.stringContaining("owner Ana"),
    });
    expect(await run(t.ctx, { action: "attach", bot: "Helper", number: "hello" })).toMatchObject({
      error: expect.stringContaining("country code"),
    });
    expect(
      await run(t.ctx, { action: "attach", bot: "Nobody", number: "+12025550123" }),
    ).toMatchObject({
      error: expect.stringContaining("no bot called"),
    });
    expect(
      await run(t.ctx, { action: "reassign", number: "+19998887777", bot: "Helper" }),
    ).toMatchObject({
      error: expect.stringContaining("no number"),
    });
  });
  test("applying calls the service as the person", async () => {
    const t = setup({ admin: true });
    await applyPhone(t.ctx, { tool: "phone", op: "attach", botId: BOT, number: "+12025550123" });
    await applyPhone(t.ctx, { tool: "phone", op: "reassign", id: "n2", botId: BOT });
    expect(t.calls).toEqual([
      `attach:{"botId":"${BOT}","number":"+12025550123"}`,
      `reassign:n2:${BOT}`,
    ]);
  });
});

describe("applying an approved card", () => {
  test("each operation calls the service as the person", async () => {
    const t = setup({ admin: true });
    await applyPhone(t.ctx, {
      tool: "phone",
      op: "request",
      botId: BOT,
      country: "US",
      areaCode: null,
    });
    await applyPhone(t.ctx, { tool: "phone", op: "settings", botId: BOT, inbound: "off" });
    await applyPhone(t.ctx, { tool: "phone", op: "release", botId: BOT });
    await applyPhone(t.ctx, { tool: "phone", op: "approve", id: "n1" });
    await applyPhone(t.ctx, { tool: "phone", op: "reject", id: "n1" });
    await applyPhone(t.ctx, { tool: "phone", op: "optout", number: "+15550100777" });
    expect(t.calls).toEqual([
      `request:${BOT}:{"country":"US","areaCode":null}`,
      `update:${BOT}:{"inbound":"off"}`,
      `release:${BOT}`,
      "approve:n1",
      "reject:n1",
      "optout:+15550100777",
    ]);
    await expect(applyPhone(t.ctx, { tool: "phone", op: "pin" })).rejects.toThrow(
      "unknown phone change",
    );
  });
});

describe("the block", () => {
  test("parses, and has no action for a PIN", () => {
    const ok = parseTools(
      fence('{"action":"request","bot":"Helper","country":"BR","area_code":"11"}'),
    );
    expect(ok.rejected).toEqual([]);
    expect(ok.calls[0]!.kind).toBe("phone");
    for (const bad of [
      '{"action":"pin","bot":"Helper","pin":"1234"}',
      '{"action":"settings","bot":"Helper","pin":"1234"}',
    ]) {
      const r = parseTools(fence(bad));
      expect(r.calls).toEqual([]);
      expect(r.rejected).toHaveLength(1);
    }
  });
});
