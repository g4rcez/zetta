// Phone numbers of bots against Postgres and the fake Telnyx (run with ZETTA_TEST_DB=embedded; without it this suite skips): asking for a
// number, the operator's approval, review, release, the hold after archiving, one per bot, another person's bot, the PIN and the
// do-not-call list.
import { uuidv7 } from "@zetta/core/uuid";
import { afterAll, beforeAll, beforeEach, describe, expect, test } from "bun:test";
import { createDb } from "@zetta/db";
import { eq } from "@zetta/db/query";
import { user } from "@zetta/db/schema/auth";
import { bot } from "@zetta/db/schema/chat";
import { membership } from "@zetta/db/schema/identity";
import { phoneNumber } from "@zetta/db/schema/phone";
import { voiceCall } from "@zetta/db/schema/voice";
import { cleanupTestUsers } from "../../test-support/db-cleanup";
import {
  AccessError,
  createMembershipLookup,
  issueBackgroundActor,
  type ActiveActor,
} from "../identity/access";
import type { PhoneOffer } from "./config";
import { startFakeTelnyx } from "./fake";
import { PhoneError, createPhoneService, withPhoneHold } from "./service";
import { createTelnyxProvider } from "./telnyx";

const url = process.env.ZETTA_CHAT_TEST_DATABASE_URL;
const suite = url ? describe : describe.skip;
const A = `ph-a-${uuidv7()}`;
const B = `ph-b-${uuidv7()}`;
const ADMIN = `ph-admin-${uuidv7()}`;
const ids = [A, B, ADMIN];

suite("bot phone numbers against postgres", () => {
  const db = createDb({ DATABASE_URL: url ?? "postgresql://unused@localhost/unused" } as never);
  const lookup = createMembershipLookup(db);
  const fake = startFakeTelnyx();
  const provider = createTelnyxProvider({
    apiKey: fake.apiKey,
    publicKey: fake.publicKey,
    connectionRef: fake.connectionRef,
    baseUrl: fake.baseUrl,
  });
  let offer: PhoneOffer = {
    on: true,
    mode: "owner_request",
    countries: ["US", "BR"],
    maxNumbers: 5,
  };
  let clock = new Date();
  const trail: string[] = [];
  const service = createPhoneService({
    db,
    reader: {
      offer: async () => offer,
      provider: async () => (offer.on ? provider : undefined),
      settings: async () => ({}) as never,
    },
    now: () => clock,
    audit: (e) => void trail.push(e.kind),
  });
  let a!: ActiveActor;
  let b!: ActiveActor;
  let admin!: ActiveActor;
  const mkBot = async (owner: string, name: string) => {
    const [row] = await db
      .insert(bot)
      .values({
        ownerUserId: owner,
        kind: "specialist",
        visibility: "private",
        name,
        slug: `${name.toLowerCase()}-${uuidv7().slice(-8)}`,
        onboarded: true,
      })
      .returning();
    return row!;
  };
  const denied = async (q: Promise<unknown>) => {
    const e = await q.then(
      () => undefined,
      (x: unknown) => x,
    );
    expect(e).toBeInstanceOf(AccessError);
  };
  const failsWith = async (q: Promise<unknown>, code: PhoneError["code"]) => {
    const e = await q.then(
      () => undefined,
      (x: unknown) => x,
    );
    expect(e).toBeInstanceOf(PhoneError);
    expect((e as PhoneError).code).toBe(code);
  };

  beforeAll(async () => {
    const now = new Date();
    await db.insert(user).values(
      ids.map((id) => ({
        id,
        name: id,
        email: `${id}@example.invalid`,
        emailVerified: true,
        createdAt: now,
        updatedAt: now,
      })),
    );
    await db
      .insert(membership)
      .values(
        ids.map((userId) => ({ userId, status: "active" as const, joinedAt: now, updatedAt: now })),
      );
    a = (await issueBackgroundActor(lookup, A))!;
    b = (await issueBackgroundActor(lookup, B))!;
    // A member who is not an administrator is the normal case; the administrator flag is set on a copy of the actor.
    admin = Object.freeze({ userId: ADMIN, isAdmin: true });
  });
  afterAll(async () => {
    await db.delete(phoneNumber);
    await cleanupTestUsers(db, ids);
    fake.stop();
  });
  beforeEach(async () => {
    offer = { on: true, mode: "owner_request", countries: ["US", "BR"], maxNumbers: 5 };
    clock = new Date();
    trail.length = 0;
    fake.held.clear();
    fake.orders.clear();
    fake.reviewCountries.clear();
    fake.calls.length = 0;
    await db.delete(phoneNumber);
  });

  describe("asking for a number", () => {
    test("in owner_request mode the number is ordered at once and the bot has it", async () => {
      const helper = await mkBot(A, "Helper");
      const view = await service.request(a, helper.id, { country: "us", areaCode: "415" });
      expect(view).toMatchObject({
        status: "active",
        country: "US",
        areaCode: "415",
        inbound: "owner_only",
        outbound: "on",
        pinSet: false,
      });
      expect(view.number).toMatch(/^\+1415555/);
      expect(fake.held.has(view.number!)).toBe(true);
      expect((await service.get(a, helper.id))?.id).toBe(view.id);
      expect(trail).toEqual(["phone:ordered"]);
    });

    test("Zetta (the Chief) can have a number like any other bot", async () => {
      const [zetta] = await db
        .insert(bot)
        .values({
          ownerUserId: A,
          kind: "chief",
          visibility: "private",
          name: "Zetta",
          slug: `zetta-${uuidv7().slice(-8)}`,
          onboarded: true,
        })
        .returning();
      const view = await service.request(a, zetta!.id, { country: "us" });
      expect(view.status).toBe("active");
      expect((await service.get(a, zetta!.id))?.id).toBe(view.id);
      await db.delete(phoneNumber);
      await db.delete(bot).where(eq(bot.id, zetta!.id));
    });

    test("a Brazilian number is pending review with the three business days sentence, and becomes active when the provider says so", async () => {
      fake.reviewCountries.add("BR");
      const helper = await mkBot(A, "Helper");
      const view = await service.request(a, helper.id, { country: "BR", areaCode: "11" });
      expect(view.status).toBe("pending_review");
      expect(view.note).toContain("up to 3 business days");
      expect(await service.syncPending()).toBe(0);
      const [row] = await db.select().from(phoneNumber).where(eq(phoneNumber.id, view.id));
      fake.approveOrder(row!.providerRef!);
      expect(await service.syncPending()).toBe(1);
      expect((await service.get(a, helper.id))?.status).toBe("active");
    });

    test("a review the provider rejects fails the number and gives it back", async () => {
      fake.reviewCountries.add("BR");
      const helper = await mkBot(A, "Helper");
      const view = await service.request(a, helper.id, { country: "BR" });
      const [row] = await db.select().from(phoneNumber).where(eq(phoneNumber.id, view.id));
      fake.rejectOrder(row!.providerRef!);
      await service.syncPending();
      expect((await service.get(a, helper.id))?.status).toBe("failed");
      // The owner may ask again.
      expect((await service.request(a, helper.id, { country: "US" })).status).toBe("active");
    });

    test("a bot has one number: a second request is refused and nothing is bought", async () => {
      const helper = await mkBot(A, "Helper");
      await service.request(a, helper.id, { country: "US" });
      const bought = fake.calls.filter((c) => c.method === "POST").length;
      await failsWith(service.request(a, helper.id, { country: "US" }), "HAVE_ONE");
      expect(fake.calls.filter((c) => c.method === "POST").length).toBe(bought);
    });

    test("another person's bot is not found, and so is its number", async () => {
      const mine = await mkBot(A, "Mine");
      await denied(service.request(b, mine.id, { country: "US" }));
      const v = await service.request(a, mine.id, { country: "US" });
      await denied(service.get(b, mine.id));
      await denied(service.update(b, mine.id, { inbound: "anyone" }));
      await denied(service.setPin(b, mine.id, "1234"));
      await denied(service.release(b, mine.id));
      expect((await service.get(a, mine.id))?.id).toBe(v.id);
    });

    test("not offered, a country that is not allowed, and the limit of numbers", async () => {
      const helper = await mkBot(A, "Helper");
      offer = { ...offer, on: false, mode: "off", countries: [] };
      await failsWith(service.request(a, helper.id, { country: "US" }), "NOT_OFFERED");
      offer = { on: true, mode: "owner_request", countries: ["US"], maxNumbers: 1 };
      await failsWith(service.request(a, helper.id, { country: "BR" }), "COUNTRY");
      await failsWith(service.request(a, helper.id, { country: "usa" }), "BAD_INPUT");
      await service.request(a, helper.id, { country: "US" });
      const second = await mkBot(A, "Second");
      await failsWith(service.request(a, second.id, { country: "US" }), "LIMIT");
    });

    test("a country with no free number buys nothing", async () => {
      const helper = await mkBot(A, "Helper");
      fake.failNext(503);
      await failsWith(service.request(a, helper.id, { country: "US" }), "PROVIDER");
      expect(await service.get(a, helper.id)).toBeNull();
    });
  });

  describe("operator approval", () => {
    test("the request waits, costs nothing, and an administrator approves it", async () => {
      offer = { ...offer, mode: "operator_approval" };
      const helper = await mkBot(A, "Helper");
      const view = await service.request(a, helper.id, { country: "US", areaCode: "212" });
      expect(view).toMatchObject({ status: "requested", number: null });
      expect(view.note).toContain("administrator");
      expect(fake.calls.length).toBe(0);
      await denied(service.list(a));
      await denied(service.approve(a, view.id));
      const listed = await service.list(admin);
      expect(listed[0]).toMatchObject({
        id: view.id,
        botName: "Helper",
        ownerUserId: A,
        status: "requested",
      });
      const approved = await service.approve(admin, view.id);
      expect(approved.status).toBe("active");
      expect(approved.number).toMatch(/^\+1212555/);
      await failsWith(service.approve(admin, view.id), "WRONG_STATE");
    });

    test("an administrator can turn a request down, and the owner can ask again", async () => {
      offer = { ...offer, mode: "operator_approval" };
      const helper = await mkBot(A, "Helper");
      const view = await service.request(a, helper.id, { country: "US" });
      await service.reject(admin, view.id);
      expect((await service.get(a, helper.id))?.status).toBe("failed");
      expect((await service.request(a, helper.id, { country: "US" })).status).toBe("requested");
    });

    test("a request that is withdrawn disappears; the limit is checked again at approval", async () => {
      offer = { ...offer, mode: "operator_approval", maxNumbers: 0 };
      const helper = await mkBot(A, "Helper");
      await failsWith(service.request(a, helper.id, { country: "US" }), "LIMIT");
      offer = { ...offer, maxNumbers: 1 };
      const view = await service.request(a, helper.id, { country: "US" });
      offer = { ...offer, maxNumbers: 0 };
      await failsWith(service.approve(admin, view.id), "LIMIT");
      await service.release(a, helper.id);
      expect(await service.get(a, helper.id)).toBeNull();
    });
  });

  describe("release, archive and hold", () => {
    test("the owner releases: the provider gets the number back and the bot may ask again", async () => {
      const helper = await mkBot(A, "Helper");
      const view = await service.request(a, helper.id, { country: "US" });
      await service.release(a, helper.id);
      expect(fake.held.size).toBe(0);
      expect(await service.get(a, helper.id)).toBeNull();
      const [row] = await db.select().from(phoneNumber).where(eq(phoneNumber.id, view.id));
      expect(row).toMatchObject({ status: "released", pinHash: null });
      expect(row!.releasedAt).toBeInstanceOf(Date);
      // The digits are free again, and so is the bot.
      expect((await service.request(a, helper.id, { country: "US" })).status).toBe("active");
    });

    test("archiving holds the number for 30 days; it is kept at the provider and released after that", async () => {
      const helper = await mkBot(A, "Helper");
      const chat = { archiveBot: async (_a: unknown, _id: string) => "archived" };
      withPhoneHold(chat, service);
      const view = await service.request(a, helper.id, { country: "US" });
      expect(await chat.archiveBot(a, helper.id)).toBe("archived");
      const held = await service.get(a, helper.id);
      expect(held?.status).toBe("held");
      expect(held?.note).toContain("not in service");
      expect(new Date(held!.heldUntil!).getTime() - clock.getTime()).toBe(30 * 86_400_000);
      expect(fake.held.has(view.number!)).toBe(true);
      // Not yet: 29 days later it is still held.
      clock = new Date(clock.getTime() + 29 * 86_400_000);
      expect(await service.releaseExpired()).toBe(0);
      clock = new Date(clock.getTime() + 2 * 86_400_000);
      expect(await service.releaseExpired()).toBe(1);
      expect(fake.held.size).toBe(0);
      expect(await service.get(a, helper.id)).toBeNull();
    });

    test("a held number cannot be changed, and an administrator can release it at once", async () => {
      const helper = await mkBot(A, "Helper");
      const view = await service.request(a, helper.id, { country: "US" });
      await service.holdForBot(helper.id);
      await failsWith(service.update(a, helper.id, { inbound: "anyone" }), "WRONG_STATE");
      await denied(service.operatorRelease(a, view.id));
      await service.operatorRelease(admin, view.id);
      expect(fake.held.size).toBe(0);
    });

    test("a request that was never approved is dropped when its bot is archived", async () => {
      offer = { ...offer, mode: "operator_approval" };
      const helper = await mkBot(A, "Helper");
      await service.request(a, helper.id, { country: "US" });
      await service.holdForBot(helper.id);
      expect((await service.get(a, helper.id))?.status).toBe("failed");
    });

    test("a provider that is down leaves the held number held for the next tick", async () => {
      const helper = await mkBot(A, "Helper");
      await service.request(a, helper.id, { country: "US" });
      await service.holdForBot(helper.id);
      clock = new Date(clock.getTime() + 31 * 86_400_000);
      fake.failNext(503);
      expect(await service.releaseExpired()).toBe(0);
      expect((await service.get(a, helper.id))?.status).toBe("held");
      expect(await service.releaseExpired()).toBe(1);
    });
  });

  describe("who may call, the owner's number and the PIN", () => {
    test("inbound, outbound and the owner's own number are saved; a bad number is refused", async () => {
      const helper = await mkBot(A, "Helper");
      const v = await service.request(a, helper.id, { country: "US" });
      const saved = await service.update(a, helper.id, {
        inbound: "anyone",
        outbound: "off",
        ownerNumber: "+1 (555) 010-0100",
      });
      expect(saved).toMatchObject({
        inbound: "anyone",
        outbound: "off",
        ownerNumber: "+15550100100",
      });
      await failsWith(service.update(a, helper.id, { ownerNumber: "12" }), "BAD_INPUT");
      await failsWith(service.update(a, helper.id, { ownerNumber: v.number }), "BAD_INPUT");
    });

    test("a PIN needs the owner's number, is stored hashed, never returned, and changes when the number changes", async () => {
      const helper = await mkBot(A, "Helper");
      const v = await service.request(a, helper.id, { country: "US" });
      await failsWith(service.setPin(a, helper.id, "4821"), "BAD_INPUT");
      await service.update(a, helper.id, { ownerNumber: "+15550100100" });
      await failsWith(service.setPin(a, helper.id, "12"), "BAD_INPUT");
      const withPin = await service.setPin(a, helper.id, "4821");
      expect(withPin.pinSet).toBe(true);
      expect(JSON.stringify(withPin)).not.toContain("4821");
      expect(JSON.stringify(withPin)).not.toContain("scrypt");
      const [row] = await db.select().from(phoneNumber).where(eq(phoneNumber.id, v.id));
      expect(row!.pinHash!.startsWith("scrypt$")).toBe(true);
      const moved = await service.update(a, helper.id, { ownerNumber: "+15550100101" });
      expect(moved.pinSet).toBe(false);
    });

    test("three wrong PIN tries lock it; the lock shows on the view and ends by itself", async () => {
      const helper = await mkBot(A, "Helper");
      const v = await service.request(a, helper.id, { country: "US" });
      expect(await service.checkPin(v.id, "4821")).toBe("none");
      await service.update(a, helper.id, { ownerNumber: "+15550100100" });
      await service.setPin(a, helper.id, "4821");
      expect(await service.checkPin(v.id, "0000")).toBe("wrong");
      expect(await service.checkPin(v.id, "0000")).toBe("wrong");
      expect(await service.checkPin(v.id, "0000")).toBe("wrong");
      expect(await service.checkPin(v.id, "4821")).toBe("locked");
      expect((await service.get(a, helper.id))?.pinLockedUntil).not.toBeNull();
      clock = new Date(clock.getTime() + 31 * 60_000);
      expect(await service.checkPin(v.id, "4821")).toBe("ok");
    });

    test("a right PIN in between resets the count", async () => {
      const helper = await mkBot(A, "Helper");
      const v = await service.request(a, helper.id, { country: "US" });
      await service.update(a, helper.id, { ownerNumber: "+15550100100" });
      await service.setPin(a, helper.id, "4821");
      await service.checkPin(v.id, "0000");
      await service.checkPin(v.id, "0000");
      expect(await service.checkPin(v.id, "4821")).toBe("ok");
      expect(await service.checkPin(v.id, "0000")).toBe("wrong");
      expect(await service.checkPin(v.id, "0000")).toBe("wrong");
      expect(await service.checkPin(v.id, "4821")).toBe("ok");
    });
  });

  describe("the do-not-call list", () => {
    test("administrators add and remove numbers; any form of the number matches; a caller may add themselves", async () => {
      await denied(service.addOptout(a, "+15550100777"));
      await service.addOptout(admin, "+1 555 010 0777");
      await service.addOptout(admin, "+15550100777");
      const list = await service.optouts(admin);
      expect(list.filter((o) => o.number === "+15550100777").length).toBe(1);
      expect(await service.isOptedOut("+15550100777")).toBe(true);
      expect(await service.isOptedOut("+15550100778")).toBe(false);
      // A number that is not one is never called.
      expect(await service.isOptedOut("nonsense")).toBe(true);
      await service.optOutCaller("+15550100778");
      expect((await service.optouts(admin)).find((o) => o.number === "+15550100778")?.reason).toBe(
        "caller_request",
      );
      for (const o of await service.optouts(admin)) await service.removeOptout(admin, o.id);
      expect(await service.isOptedOut("+15550100777")).toBe(false);
      await failsWith(service.addOptout(admin, "12"), "BAD_INPUT");
    });
  });
  describe("a number the account already owns", () => {
    // Fictional numbers in the reserved +1 202 555 01xx range, valid for libphonenumber.
    const OWN = "+12025550101";
    const held = (e164 = OWN, route: string | null = null) => {
      fake.held.set(e164, `num-own-${e164.slice(-4)}`);
      fake.routes.set(`num-own-${e164.slice(-4)}`, route);
    };
    const mkChief = async (owner: string) => {
      const [row] = await db
        .insert(bot)
        .values({
          ownerUserId: owner,
          kind: "chief",
          visibility: "private",
          name: "Zetta",
          slug: `zetta-${uuidv7().slice(-8)}`,
          onboarded: true,
        })
        .returning();
      return row!;
    };

    test("attach routes the number to the call application and gives it to the bot's owner, active", async () => {
      held();
      const helper = await mkBot(A, "Helper");
      const view = await service.attach(admin, { botId: helper.id, number: "+1 202 555 0101" });
      expect(view).toMatchObject({
        botId: helper.id,
        number: OWN,
        country: "US",
        status: "active",
        inbound: "owner_only",
        outbound: "on",
        ownerNumber: null,
        pinSet: false,
      });
      expect(fake.routes.get("num-own-0101")).toBe(fake.connectionRef);
      expect(fake.calls.some((c) => c.path === "/number_orders")).toBe(false);
      const [row] = await db.select().from(phoneNumber).where(eq(phoneNumber.id, view.id));
      expect(row).toMatchObject({ ownerUserId: A, providerRef: "num-own-0101", country: "US" });
      expect(trail).toEqual(["phone:attached"]);
      expect((await service.get(a, helper.id))?.number).toBe(OWN);
    });

    test("Zetta (the Chief) can be the target", async () => {
      held();
      const chief = await mkChief(ADMIN);
      const view = await service.attach(admin, { botId: chief.id, number: OWN });
      expect(view.status).toBe("active");
      expect((await service.assignableBots(admin)).find((x) => x.id === chief.id)).toMatchObject({
        kind: "chief",
        hasNumber: true,
      });
    });

    test("a number the account does not hold, or a malformed one, is refused and nothing is saved", async () => {
      const helper = await mkBot(A, "Helper");
      await failsWith(service.attach(admin, { botId: helper.id, number: OWN }), "NO_NUMBER");
      await failsWith(service.attach(admin, { botId: helper.id, number: "hello" }), "BAD_INPUT");
      await failsWith(
        service.attach(admin, { botId: helper.id, number: "+15550101" }),
        "BAD_INPUT",
      );
      expect(await db.select().from(phoneNumber)).toEqual([]);
    });

    test("the country must be one the operator offers; the provider is not asked first", async () => {
      held();
      offer = { ...offer, countries: ["BR"] };
      const helper = await mkBot(A, "Helper");
      await failsWith(service.attach(admin, { botId: helper.id, number: OWN }), "COUNTRY");
      expect(fake.calls.length).toBe(0);
    });

    test("a number already used by a bot is refused", async () => {
      held();
      const one = await mkBot(A, "One");
      const two = await mkBot(B, "Two");
      await service.attach(admin, { botId: one.id, number: OWN });
      await failsWith(service.attach(admin, { botId: two.id, number: OWN }), "WRONG_STATE");
    });

    test("a bot that already has a number or a request, and an archived bot, are refused", async () => {
      held();
      held("+12025550102");
      const one = await mkBot(A, "One");
      await service.attach(admin, { botId: one.id, number: OWN });
      await failsWith(service.attach(admin, { botId: one.id, number: "+12025550102" }), "HAVE_ONE");
      const asked = await mkBot(B, "Asked");
      offer = { ...offer, mode: "operator_approval" };
      await service.request(b, asked.id, { country: "US" });
      await failsWith(
        service.attach(admin, { botId: asked.id, number: "+12025550102" }),
        "HAVE_ONE",
      );
      const old = await mkBot(A, "Old");
      await db.update(bot).set({ archived: true }).where(eq(bot.id, old.id));
      await failsWith(
        service.attach(admin, { botId: old.id, number: "+12025550102" }),
        "BAD_INPUT",
      );
      await denied(service.attach(admin, { botId: uuidv7(), number: "+12025550102" }));
    });

    test("only an administrator attaches, moves or lists other people's bots", async () => {
      held();
      const helper = await mkBot(A, "Helper");
      await denied(service.attach(a, { botId: helper.id, number: OWN }));
      await denied(service.assignableBots(a));
      await denied(service.reassign(a, uuidv7(), helper.id));
      const view = await service.attach(admin, { botId: helper.id, number: OWN });
      await denied(service.reassign(b, view.id, helper.id));
    });

    test("a provider failure while finding is a plain error and saves nothing", async () => {
      held();
      const helper = await mkBot(A, "Helper");
      fake.failNext(500);
      await failsWith(service.attach(admin, { botId: helper.id, number: OWN }), "PROVIDER");
      expect(await db.select().from(phoneNumber)).toEqual([]);
    });

    test("assignableBots lists every bot that is not archived with its owner's name and whether it has a number", async () => {
      held();
      const mine = await mkBot(A, "Mine");
      const theirs = await mkBot(B, "Theirs");
      const old = await mkBot(A, "Retired");
      await db.update(bot).set({ archived: true }).where(eq(bot.id, old.id));
      await service.attach(admin, { botId: mine.id, number: OWN });
      const list = await service.assignableBots(admin);
      expect(list.find((x) => x.id === mine.id)).toMatchObject({
        name: "Mine",
        kind: "specialist",
        ownerUserId: A,
        ownerName: A,
        hasNumber: true,
      });
      expect(list.find((x) => x.id === theirs.id)).toMatchObject({
        ownerName: B,
        hasNumber: false,
      });
      expect(list.some((x) => x.id === old.id)).toBe(false);
      expect(JSON.stringify(list)).not.toContain("example.invalid");
    });

    describe("reassign", () => {
      const setup = async () => {
        held();
        const from = await mkBot(A, "From");
        const to = await mkBot(B, "To");
        const view = await service.attach(admin, { botId: from.id, number: OWN });
        await service.update(a, from.id, { ownerNumber: "+12025550188" });
        await service.setPin(a, from.id, "4821");
        return { from, to, view };
      };

      test("moves the number, the owner and the bot, and clears what belonged to the old owner", async () => {
        const { from, to, view } = await setup();
        await db
          .update(phoneNumber)
          .set({ pinFailures: 2, pinLockedUntil: new Date(Date.now() + 60_000) })
          .where(eq(phoneNumber.id, view.id));
        trail.length = 0;
        const moved = await service.reassign(admin, view.id, to.id);
        expect(moved).toMatchObject({
          id: view.id,
          botId: to.id,
          status: "active",
          ownerNumber: null,
          pinSet: false,
          pinLockedUntil: null,
          heldUntil: null,
        });
        const [row] = await db.select().from(phoneNumber).where(eq(phoneNumber.id, view.id));
        expect(row).toMatchObject({ ownerUserId: B, botId: to.id, pinFailures: 0, pinHash: null });
        expect(await service.get(a, from.id)).toBeNull();
        expect((await service.get(b, to.id))?.number).toBe(OWN);
        expect(trail).toEqual(["phone:reassigned"]);
      });

      test("a held number (its bot was archived) becomes active on the new bot", async () => {
        const { from, to, view } = await setup();
        await db.update(bot).set({ archived: true }).where(eq(bot.id, from.id));
        await service.holdForBot(from.id);
        expect((await service.list(admin)).find((x) => x.id === view.id)?.status).toBe("held");
        const moved = await service.reassign(admin, view.id, to.id);
        expect(moved).toMatchObject({ status: "active", heldUntil: null, botId: to.id });
      });

      test("refused when the number is in the old owner's own account, allowed when the installation holds it", async () => {
        const { to, view } = await setup();
        const elsewhere = startFakeTelnyx();
        const other = createTelnyxProvider({
          apiKey: elsewhere.apiKey,
          publicKey: elsewhere.publicKey,
          connectionRef: elsewhere.connectionRef,
          baseUrl: elsewhere.baseUrl,
        });
        // `provider` holds the number. With `own`, that is the account only A reaches; otherwise it is the installation's.
        const withAccounts = (own: boolean) =>
          createPhoneService({
            db,
            reader: {
              offer: async () => offer,
              provider: async (_id: unknown, owner?: string) =>
                (owner === A) === own ? provider : other,
              settings: async () => ({}) as never,
            },
            now: () => clock,
          });
        try {
          await failsWith(withAccounts(true).reassign(admin, view.id, to.id), "WRONG_STATE");
          expect((await withAccounts(false).reassign(admin, view.id, to.id)).botId).toBe(to.id);
        } finally {
          elsewhere.stop();
        }
      });

      test("refused when the target has a number, is archived or is the same bot", async () => {
        const { from, to, view } = await setup();
        await failsWith(service.reassign(admin, view.id, from.id), "HAVE_ONE");
        const busy = await mkBot(B, "Busy");
        held("+12025550103");
        await service.attach(admin, { botId: busy.id, number: "+12025550103" });
        await failsWith(service.reassign(admin, view.id, busy.id), "HAVE_ONE");
        await db.update(bot).set({ archived: true }).where(eq(bot.id, to.id));
        await failsWith(service.reassign(admin, view.id, to.id), "BAD_INPUT");
        await denied(service.reassign(admin, view.id, uuidv7()));
      });

      test("refused while a call is running on the number, allowed once it ended", async () => {
        const { from, to, view } = await setup();
        const [call] = await db
          .insert(voiceCall)
          .values({
            ownerUserId: A,
            botId: from.id,
            numberId: view.id,
            channel: "phone",
            direction: "in",
            status: "active",
          })
          .returning();
        try {
          await failsWith(service.reassign(admin, view.id, to.id), "WRONG_STATE");
          await db
            .update(voiceCall)
            .set({ status: "ended", endedAt: new Date() })
            .where(eq(voiceCall.id, call!.id));
          expect((await service.reassign(admin, view.id, to.id)).botId).toBe(to.id);
        } finally {
          await db.delete(voiceCall).where(eq(voiceCall.id, call!.id));
        }
      });

      test("a number that is not ready (a request) cannot be moved", async () => {
        const { to } = await setup();
        offer = { ...offer, mode: "operator_approval" };
        const asking = await mkBot(A, "Asking");
        const req = await service.request(a, asking.id, { country: "US" });
        await failsWith(service.reassign(admin, req.id, to.id), "WRONG_STATE");
        await denied(service.reassign(admin, uuidv7(), to.id));
      });
    });
  });
});
