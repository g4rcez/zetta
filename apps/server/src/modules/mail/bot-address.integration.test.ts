// Bot e-mail addresses against Postgres (run with ZETTA_TEST_DB=embedded; without it this suite skips): handing out an address, the
// poller that stores received mail, who may start a turn, the driver that reads and sends it, retiring and removing.
import { uuidv7 } from "@zetta/core/uuid";
import { afterAll, beforeAll, beforeEach, describe, expect, test } from "bun:test";
import { createDb } from "@zetta/db";
import { and, eq } from "@zetta/db/query";
import { user } from "@zetta/db/schema/auth";
import { bot } from "@zetta/db/schema/chat";
import { membership } from "@zetta/db/schema/identity";
import { installationSettings } from "@zetta/db/schema/installation";
import { inboundEvent, inboundRoute, inboundThread } from "@zetta/db/schema/inbound";
import { mailbox, mailboxMessage } from "@zetta/db/schema/mail";
import { cleanupTestUsers } from "../../test-support/db-cleanup";
import { hasUniqueViolation } from "../pg-error";
import { createInbound } from "../inbound/service";
import { issueBackgroundActor, createMembershipLookup, type ActiveActor } from "../identity/access";
import type { InboundEvent } from "../integrations/plugins/registry";
import {
  botMailPlugin,
  configureBotMail,
  resetBotMailLimits,
} from "../integrations/plugins/botmail";
import { MailServiceError, createMailService } from "./service";
import { createMessageStore } from "./messages";
import { createMailPoller, BOTMAIL_PLUGIN } from "./poller";
import { addressFor, createProvisioning, ProvisionError, withProvisioning } from "./provision";
import { createFakeProvider } from "./providers/fake";
import { createMailboxStore } from "./store";

const url = process.env.ZETTA_CHAT_TEST_DATABASE_URL;
const suite = url ? describe : describe.skip;
const A = `ba-a-${uuidv7()}`;
const B = `ba-b-${uuidv7()}`;
const ids = [A, B];
const DOMAIN = "bots.example.invalid";

suite("bot e-mail addresses against postgres", () => {
  const db = createDb({ DATABASE_URL: url ?? "postgresql://unused@localhost/unused" } as never);
  const lookup = createMembershipLookup(db);
  const store = createMailboxStore(db);
  const messages = createMessageStore(db);
  const fake = createFakeProvider();
  let offer = { on: true, domain: DOMAIN };
  const reader = {
    enabled: async () => offer,
    provider: async () => (offer.on ? fake : undefined),
  };
  const fixedRandom = () => "0192f000-0000-7000-8000-0123456789ab";
  let random: (() => string) | undefined;
  const provisioning = createProvisioning({
    db,
    store,
    reader,
    random: () => (random ?? uuidv7)(),
  });
  const names = new Map<string, string>();
  const service = createMailService({
    store,
    secrets: {} as never,
    provisioned: {
      messages,
      provider: () => reader.provider(),
      displayName: async (botId, fallback) => {
        const [row] = botId
          ? await db.select({ name: bot.name }).from(bot).where(eq(bot.id, botId))
          : [];
        return row?.name ?? fallback;
      },
    },
  });
  const turns: { routeId: string; events: InboundEvent[] }[] = [];
  const inbound = {
    async ingestMailbox(routeId: string, events: InboundEvent[]) {
      turns.push({ routeId, events });
      return events.length;
    },
  };
  const poller = () => createMailPoller({ db, store, messages, reader, inbound, log: () => {} });

  let a!: ActiveActor;
  let b!: ActiveActor;
  const mkBot = async (owner: string, name: string, o: { archived?: boolean } = {}) => {
    const [row] = await db
      .insert(bot)
      .values({
        ownerUserId: owner,
        kind: "specialist",
        visibility: "private",
        name,
        slug: `${name.toLowerCase()}-${uuidv7().slice(-8)}`,
        onboarded: true,
        archived: o.archived ?? false,
      })
      .returning();
    names.set(row!.id, name);
    return row!;
  };
  const resetCursor = () =>
    db.update(installationSettings).set({ mailCursor: null }).where(eq(installationSettings.id, 1));
  /** The statement fails with a unique violation (the driver wraps the database's error, so the cause is looked at). */
  const uniqueViolation = async (q: PromiseLike<unknown>) => {
    const e = await Promise.resolve(q).then(
      () => undefined,
      (x: unknown) => x,
    );
    expect(hasUniqueViolation(e)).toBe(true);
  };
  const countMsgs = async (id: string) => messages.count(id);

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
    await db.insert(installationSettings).values({ id: 1 }).onConflictDoNothing();
  });
  afterAll(async () => {
    await resetCursor();
    await cleanupTestUsers(db, ids);
  });
  beforeEach(async () => {
    offer = { on: true, domain: DOMAIN };
    random = undefined;
    fake.inbox.length = 0;
    fake.sent.length = 0;
    fake.failNext = null;
    fake.delayMs = 0;
    fake.calls.poll = fake.calls.fetchRaw = fake.calls.send = 0;
    turns.length = 0;
    resetBotMailLimits();
    await resetCursor();
  });

  describe("handing out an address", () => {
    test("a bot gets <slug>-<4 characters>@<domain>, owned by the bot, sending on", async () => {
      const helper = await mkBot(A, "Helper");
      const box = await provisioning.giveAddress(a, helper.id);
      expect(box.address).toMatch(new RegExp(`^${helper.slug}-[0-9a-f]{4}@${DOMAIN}$`));
      expect(box).toMatchObject({
        kind: "provisioned",
        botId: helper.id,
        state: "active",
        sending: "on",
        label: "Helper",
      });
      // One address per bot: asking again returns it.
      expect((await provisioning.giveAddress(a, helper.id)).id).toBe(box.id);
    });

    test("a taken address retries with 6 and then 8 characters, and gives up after that", async () => {
      random = fixedRandom;
      const helper = await mkBot(A, "Retry");
      const taken = async (length: number) =>
        db
          .insert(mailbox)
          .values({
            ownerUserId: B,
            kind: "provisioned",
            address: addressFor(helper.slug, DOMAIN, length, fixedRandom()),
          })
          .returning();
      await taken(4);
      const six = await provisioning.giveAddress(a, helper.id);
      expect(six.address).toBe(addressFor(helper.slug, DOMAIN, 6, fixedRandom()));
      expect(six.address.split("@")[0]!.endsWith("-6789ab")).toBe(true);

      const second = await mkBot(A, "Retrytwo");
      for (const n of [4, 6])
        await db.insert(mailbox).values({
          ownerUserId: B,
          kind: "provisioned",
          address: addressFor(second.slug, DOMAIN, n, fixedRandom()),
        });
      const eight = await provisioning.giveAddress(a, second.id);
      expect(eight.address.split("@")[0]!.endsWith("-456789ab")).toBe(true);

      const third = await mkBot(A, "Retrythree");
      for (const n of [4, 6, 8])
        await db.insert(mailbox).values({
          ownerUserId: B,
          kind: "provisioned",
          address: addressFor(third.slug, DOMAIN, n, fixedRandom()),
        });
      await expect(provisioning.giveAddress(a, third.id)).rejects.toBeInstanceOf(ProvisionError);
    });

    test("with the provider off nothing is offered and nothing changes", async () => {
      offer = { on: false, domain: "" };
      const helper = await mkBot(A, "Quiet");
      await expect(provisioning.giveAddress(a, helper.id)).rejects.toMatchObject({
        code: "NOT_OFFERED",
      });
      expect(await provisioning.forNewBot(a, helper.id)).toBeUndefined();
      expect(await store.provisionedOf(a, helper.id)).toBeUndefined();
      expect(await db.select().from(mailbox).where(eq(mailbox.botId, helper.id))).toHaveLength(0);
    });

    test("another person's bot is not found", async () => {
      const theirs = await mkBot(B, "Theirs");
      await expect(provisioning.giveAddress(a, theirs.id)).rejects.toMatchObject({
        code: "NOT_FOUND",
      });
    });

    test("creating a bot never fails because of provisioning", async () => {
      const calls: string[] = [];
      const chat = {
        async createBot(_a: ActiveActor, input: { name: string }) {
          calls.push(`create:${input.name}`);
          return { id: (await mkBot(A, input.name)).id };
        },
        async archiveBot(_a: ActiveActor, id: string) {
          calls.push(`archive:${id}`);
          return { id };
        },
      };
      const broken = createProvisioning({
        db,
        store,
        reader: {
          enabled: async () => {
            throw new Error("the settings table is gone");
          },
        },
      });
      withProvisioning(chat, broken);
      const made = await chat.createBot(a, { name: "Survivor" } as never);
      expect(made.id).toBeTruthy();
      expect(await chat.archiveBot(a, made.id)).toEqual({ id: made.id });
      // With provisioning working, the same hook gives the new bot an address.
      const good = { ...chat };
      withProvisioning(good, provisioning);
      const withAddress = await good.createBot(a, { name: "Addressed" } as never);
      expect(await store.provisionedOf(a, withAddress.id)).toBeDefined();
    });
  });

  describe("receiving", () => {
    test("stores mail once per provider reference, however often it is polled", async () => {
      const helper = await mkBot(A, "Dedupe");
      const box = await provisioning.giveAddress(a, helper.id);
      const ref = await fake.receive({
        to: [box.address],
        from: "ana@example.invalid",
        subject: "Hello",
        text: "Hi",
      });
      const first = await poller().tick();
      expect(first).toMatchObject({ status: "ran", stats: { stored: 1 } });
      expect(await countMsgs(box.id)).toBe(1);
      // A replay from the start finds it again and stores nothing.
      await resetCursor();
      const again = await poller().tick();
      expect(again).toMatchObject({ status: "ran", stats: { stored: 0, duplicates: 1 } });
      expect(await countMsgs(box.id)).toBe(1);
      expect(fake.calls.fetchRaw).toBe(1);
      const [row] = await db
        .select()
        .from(mailboxMessage)
        .where(eq(mailboxMessage.mailboxId, box.id));
      expect(row).toMatchObject({
        providerRef: ref,
        direction: "in",
        subject: "Hello",
        fromAddress: "ana@example.invalid",
        attachments: "none",
      });
      expect(row!.authentication).toEqual({ spf: "pass", dkim: "pass", dmarc: "pass" });
      expect(row!.rawMime!.length).toBeGreaterThan(50);
    });

    test("routes by recipient and drops mail to addresses nobody has, counted and never stored", async () => {
      const one = await provisioning.giveAddress(a, (await mkBot(A, "Routeone")).id);
      const two = await provisioning.giveAddress(a, (await mkBot(A, "Routetwo")).id);
      await fake.receive({
        to: [one.address, two.address],
        from: "ana@example.invalid",
        subject: "Both",
        text: "x",
      });
      await fake.receive({
        to: [`ghost-0000@${DOMAIN}`],
        from: "ana@example.invalid",
        subject: "Nobody",
        text: "x",
      });
      await fake.receive({
        to: ["someone@elsewhere.example.invalid"],
        from: "ana@example.invalid",
        subject: "Other domain",
        text: "x",
      });
      const out = await poller().tick();
      expect(out).toMatchObject({ status: "ran", stats: { stored: 2, droppedUnknown: 1 } });
      expect(await countMsgs(one.id)).toBe(1);
      expect(await countMsgs(two.id)).toBe(1);
      // The mail to nobody was not even downloaded.
      expect(fake.calls.fetchRaw).toBe(1);
    });

    test("mail to a retired address is dropped and counted; what was stored stays readable", async () => {
      const gone = await mkBot(A, "Retiring");
      const box = await provisioning.giveAddress(a, gone.id);
      await fake.receive({
        to: [box.address],
        from: "ana@example.invalid",
        subject: "Before",
        text: "kept",
      });
      await poller().tick();
      await db.update(bot).set({ archived: true }).where(eq(bot.id, gone.id));
      await provisioning.retireForBot(gone.id);
      expect((await store.get(a, box.id)).state).toBe("retired");
      await fake.receive({
        to: [box.address],
        from: "ana@example.invalid",
        subject: "After",
        text: "dropped",
      });
      const out = await poller().tick();
      expect(out).toMatchObject({ status: "ran", stats: { stored: 0, droppedRetired: 1 } });
      expect(await countMsgs(box.id)).toBe(1);
      // The person still reads it, but nothing is sent from it.
      const page = await service.conversations(a, box.id, {});
      expect(page.conversations.map((c) => c.subject)).toEqual(["Before"]);
      await expect(
        service.send(a, box.id, { to: ["ana@example.invalid"], subject: "x", text: "y" }),
      ).rejects.toMatchObject({ code: "RETIRED" });
      // The address is still reserved: no new bot can be given it.
      await uniqueViolation(
        db
          .insert(mailbox)
          .values({ ownerUserId: B, kind: "provisioned", address: box.address.toUpperCase() }),
      );
    });

    test("the cursor moves past stored mail and a failed download repeats from the same place", async () => {
      const box = await provisioning.giveAddress(a, (await mkBot(A, "Cursor")).id);
      await fake.receive({
        to: [box.address],
        from: "ana@example.invalid",
        subject: "One",
        text: "1",
      });
      await fake.receive({
        to: [box.address],
        from: "ana@example.invalid",
        subject: "Two",
        text: "2",
      });
      fake.failNext = "fetchRaw";
      const p = poller();
      const failed = await p.tick();
      expect(failed).toMatchObject({ status: "failed" });
      expect(await countMsgs(box.id)).toBe(0);
      // Backing off: the next tick does nothing at all, and the failure is remembered.
      expect(await p.tick()).toEqual({ status: "backoff" });
      expect(fake.calls.poll).toBeGreaterThan(0);
      // A fresh poller (no backoff) repeats the same pass and stores both.
      const ok = await poller().tick();
      expect(ok).toMatchObject({ status: "ran", stats: { stored: 2 } });
      const [row] = await db
        .select({ c: installationSettings.mailCursor })
        .from(installationSettings)
        .where(eq(installationSettings.id, 1));
      expect(row!.c).toBe(fake.inbox[1]!.ref);
    });

    test("only one instance polls at a time", async () => {
      await provisioning.giveAddress(a, (await mkBot(A, "Single")).id);
      fake.delayMs = 150;
      const [x, y, z] = await Promise.all([poller().tick(), poller().tick(), poller().tick()]);
      const statuses = [x.status, y.status, z.status].sort();
      expect(statuses).toEqual(["ran", "skipped", "skipped"]);
      // The same poller called again while it still runs is skipped too.
      const one = poller();
      const [first, second] = await Promise.all([one.tick(), one.tick()]);
      expect([first.status, second.status].sort()).toEqual(["ran", "skipped"]);
    });

    test("with the provider off the poller does nothing", async () => {
      offer = { on: false, domain: "" };
      expect(await poller().tick()).toEqual({ status: "off" });
      expect(fake.calls.poll).toBe(0);
    });
  });

  describe("who may start a turn of the owner bot", () => {
    let box: Awaited<ReturnType<typeof provisioning.giveAddress>>;
    beforeEach(async () => {
      const owner = await mkBot(A, `Talker${uuidv7().slice(-5)}`);
      box = await provisioning.giveAddress(a, owner.id);
      await store.update(a, box.id, {
        allowedSenders: ["ana@example.invalid", "@partner.example.invalid"],
      });
    });
    const send = (o: {
      from?: string;
      auth?: { spf?: string; dkim?: string };
      headers?: Record<string, string>;
      subject?: string;
      to?: string;
    }) =>
      fake.receive({
        to: [o.to ?? box.address],
        from: o.from ?? "ana@example.invalid",
        subject: o.subject ?? "Question",
        text: "Can you help?\n\nOn Mon Ana wrote:\n> old",
        ...(o.auth ? { authentication: o.auth } : {}),
        ...(o.headers ? { headers: o.headers } : {}),
      });

    test("an allowed sender with dkim=pass starts a turn, through the bot's own route", async () => {
      await send({});
      const out = await poller().tick();
      expect(out).toMatchObject({ status: "ran", stats: { stored: 1, turns: 1 } });
      expect(turns).toHaveLength(1);
      const [r] = await db.select().from(inboundRoute).where(eq(inboundRoute.mailboxId, box.id));
      expect(r).toMatchObject({
        pluginId: BOTMAIL_PLUGIN,
        botId: box.botId,
        ownerUserId: A,
        enabled: true,
      });
      expect(turns[0]!.routeId).toBe(r!.id);
      expect(turns[0]!.events[0]).toMatchObject({ chat: "ana@example.invalid", group: false });
      expect(turns[0]!.events[0]!.text).toBe("Subject: Question\n\nCan you help?");
    });

    test("spf=pass is enough; a domain on the list works", async () => {
      await send({ from: "bob@partner.example.invalid", auth: { dkim: "fail", spf: "pass" } });
      await poller().tick();
      expect(turns).toHaveLength(1);
    });

    test("an unlisted sender is stored but starts none", async () => {
      await send({ from: "mallory@evil.example.invalid" });
      const out = await poller().tick();
      expect(out).toMatchObject({ status: "ran", stats: { stored: 1, turns: 0 } });
      expect(turns).toHaveLength(0);
      expect(await countMsgs(box.id)).toBe(1);
    });

    test("failed DKIM and SPF start none", async () => {
      await send({ auth: { dkim: "fail", spf: "fail" } });
      await send({ auth: { dkim: "unknown", spf: "unknown" }, subject: "Unknown" });
      await poller().tick();
      expect(turns).toHaveLength(0);
      expect(await countMsgs(box.id)).toBe(2);
    });

    test("automatic mail starts none, and neither does mail from the mailbox itself", async () => {
      await send({ headers: { "Auto-Submitted": "auto-replied" }, subject: "Out of office" });
      await send({ headers: { Precedence: "bulk" }, subject: "Newsletter" });
      await send({ headers: { "List-Id": "<list.example.invalid>" }, subject: "List" });
      await store.update(a, box.id, { allowedSenders: [`@${DOMAIN}`] });
      await send({ from: box.address, subject: "Loop" });
      const out = await poller().tick();
      expect(out).toMatchObject({ status: "ran", stats: { stored: 4, turns: 0 } });
      expect(turns).toHaveLength(0);
    });

    test("a mailbox with nobody allowed starts none", async () => {
      await store.update(a, box.id, { allowedSenders: [] });
      await send({});
      await poller().tick();
      expect(turns).toHaveLength(0);
    });
  });

  describe("the reply", () => {
    test("goes to the sender only, threaded, stored as out, from the bot's current name", async () => {
      const helper = await mkBot(A, "Replier");
      const box = await provisioning.giveAddress(a, helper.id);
      await store.update(a, box.id, { allowedSenders: ["ana@example.invalid"] });
      const mid = "q1@example.invalid";
      await fake.receive({
        to: [box.address],
        from: "ana@example.invalid",
        subject: "Hello there",
        text: "Question",
        messageId: mid,
      });
      await poller().tick();
      configureBotMail({
        mail: service,
        mailboxOf: (actor, botId) => store.provisionedOf(actor, botId),
        latestFrom: (id, address) => messages.latestFrom(id, address),
        actorFor: async () => a,
      });
      const tool = botMailPlugin.tools![0]!;
      const ctx = {
        userId: A,
        botId: helper.id,
        turn: "inbound" as const,
        config: {},
        setConfig: async () => {},
      };
      // A rename shows on the next mail; the address stays.
      await db.update(bot).set({ name: "Renamed Replier" }).where(eq(bot.id, helper.id));
      const done = await tool.handler(ctx, {
        to: "ANA@example.invalid",
        text: "Here is the answer.",
      });
      expect(done).toEqual({ sent: true, to: "ana@example.invalid" });
      expect(fake.sent).toHaveLength(1);
      const sent = fake.sent[0]!.mail;
      expect(sent).toMatchObject({
        to: ["ana@example.invalid"],
        subject: "Re: Hello there",
        text: "Here is the answer.",
        inReplyTo: mid,
        from: { name: "Renamed Replier", address: box.address },
      });
      expect(sent.references).toEqual([mid]);
      expect((await store.get(a, box.id)).address).toBe(box.address);
      // The conversation now holds both messages, the reply as `sent`.
      const page = await service.conversations(a, box.id, {});
      expect(page.conversations).toHaveLength(1);
      expect(page.conversations[0]!.messageCount).toBe(2);
      const conv = await service.conversationText(a, box.id, page.conversations[0]!.id);
      expect(conv.messages.map((m) => m.origin)).toEqual(["received", "sent"]);
      expect(conv.messages[1]!.text).toContain("Here is the answer.");
      const outRows = await db
        .select()
        .from(mailboxMessage)
        .where(and(eq(mailboxMessage.mailboxId, box.id), eq(mailboxMessage.direction, "out")));
      expect(outRows).toHaveLength(1);
      expect(outRows[0]!.inReplyTo).toBe(mid);

      // Not an address that wrote, not an address on the list, not outside an inbound turn, not for another bot.
      await expect(
        tool.handler(ctx, { to: "bob@example.invalid", text: "x" }),
      ).rejects.toMatchObject({ code: "NOT_ALLOWED" });
      await store.update(a, box.id, {
        allowedSenders: ["ana@example.invalid", "bob@example.invalid"],
      });
      await expect(
        tool.handler(ctx, { to: "bob@example.invalid", text: "x" }),
      ).rejects.toMatchObject({ code: "NOT_ALLOWED" });
      await expect(
        tool.handler({ ...ctx, turn: "chat" }, { to: "ana@example.invalid", text: "x" }),
      ).rejects.toMatchObject({ code: "NOT_FOUND" });
      const other = await mkBot(A, "Other");
      await expect(
        tool.handler({ ...ctx, botId: other.id }, { to: "ana@example.invalid", text: "x" }),
      ).rejects.toMatchObject({ code: "NOT_FOUND" });
      expect(fake.sent).toHaveLength(1);
      // Offered only to the owner bot, only while an outside person is being answered.
      const always = botMailPlugin.gate!;
      expect(await always.available(helper.id, A, "inbound")).toBe(true);
      for (const turn of ["chat", "loop", "server", "room", "outside_event", "none"] as const)
        expect(await always.available(helper.id, A, turn)).toBe(false);
      expect(await always.available(other.id, A, "inbound")).toBe(false);
    });

    test("an incoming reply joins the thread the bot started", async () => {
      const helper = await mkBot(A, "Thread");
      const box = await provisioning.giveAddress(a, helper.id);
      const sent = await service.send(a, box.id, {
        to: ["ana@example.invalid"],
        subject: "Hi from the bot",
        text: "first",
      });
      expect(sent.copy).toBe("saved");
      await fake.receive({
        to: [box.address],
        from: "ana@example.invalid",
        subject: "Re: Hi from the bot",
        text: "second",
        inReplyTo: sent.messageId,
        references: [sent.messageId],
      });
      // No headers at all, only a "Re:" subject: it joins by subject.
      await fake.receive({
        to: [box.address],
        from: "ana@example.invalid",
        subject: "RE: Hi from the bot",
        text: "third",
      });
      await fake.receive({
        to: [box.address],
        from: "ana@example.invalid",
        subject: "Something else",
        text: "new",
      });
      await poller().tick();
      const page = await service.conversations(a, box.id, {});
      expect(page.conversations.map((c) => [c.subject, c.messageCount]).sort()).toEqual([
        ["Hi from the bot", 3],
        ["Something else", 1],
      ]);
    });
  });

  describe("reading", () => {
    test("search is ILIKE over subject, sender and text; a page cursor continues", async () => {
      const box = await provisioning.giveAddress(a, (await mkBot(A, "Search")).id);
      await fake.receive({
        to: [box.address],
        from: "ana@example.invalid",
        subject: "Invoice 100%",
        text: "pay by friday",
      });
      await fake.receive({
        to: [box.address],
        from: "bob@example.invalid",
        subject: "Lunch",
        text: "pizza at noon",
      });
      await fake.receive({
        to: [box.address],
        from: "carol@example.invalid",
        subject: "Other",
        text: "nothing",
      });
      await poller().tick();
      const find = async (q: string) =>
        (await service.conversations(a, box.id, { query: q })).conversations.map((c) => c.subject);
      expect(await find("invoice")).toEqual(["Invoice 100%"]);
      expect(await find("PIZZA")).toEqual(["Lunch"]);
      expect(await find("bob@")).toEqual(["Lunch"]);
      expect(await find("100%")).toEqual(["Invoice 100%"]);
      expect(await find("%")).toEqual(["Invoice 100%"]);
      expect(await find("zzz")).toEqual([]);
      const first = await service.conversations(a, box.id, { limit: 2 });
      expect(first.conversations).toHaveLength(2);
      expect(first.nextCursor).toBeDefined();
      const next = await service.conversations(a, box.id, { limit: 2, cursor: first.nextCursor! });
      expect(next.conversations).toHaveLength(1);
      expect(next.nextCursor).toBeUndefined();
      // A cursor of one search is refused for another.
      await expect(
        service.conversations(a, box.id, { query: "x", cursor: first.nextCursor! }),
      ).rejects.toMatchObject({ code: "BAD_ID" });
    });

    test("attachments are read from the stored source", async () => {
      const box = await provisioning.giveAddress(a, (await mkBot(A, "Files")).id);
      await fake.receive({
        to: [box.address],
        from: "ana@example.invalid",
        subject: "With file",
        text: "see attached",
        attachment: { filename: "note.txt", content: "hello file" },
      });
      await poller().tick();
      const page = await service.conversations(a, box.id, {});
      expect(page.conversations[0]!.attachments).toBe("some");
      const conv = await service.conversation(a, box.id, page.conversations[0]!.id, "blocked");
      const file = conv.messages[0]!.attachments[0]!;
      expect(file).toMatchObject({ fileName: "note.txt", disposition: "attachment" });
      const bytes = await service.attachment(a, box.id, conv.id, file.id);
      expect(Buffer.from(bytes.bytes).toString()).toBe("hello file");
      await expect(service.attachment(a, box.id, conv.id, `${uuidv7()}.0`)).rejects.toMatchObject({
        code: "NOT_FOUND",
      });
      await expect(service.attachment(a, box.id, conv.id, "nonsense")).rejects.toMatchObject({
        code: "BAD_ID",
      });
    });

    test("another person's mailbox is not found", async () => {
      const box = await provisioning.giveAddress(a, (await mkBot(A, "Mine")).id);
      await expect(service.conversations(b, box.id, {})).rejects.toMatchObject({
        code: "NOT_FOUND",
      });
    });
  });

  describe("allowed senders and settings", () => {
    test("only addresses and domains are accepted, and the owner cannot change", async () => {
      const helper = await mkBot(A, "Settings");
      const box = await provisioning.giveAddress(a, helper.id);
      const view = await service.update(a, box.id, {
        allowedSenders: ["Ana@Example.invalid", "@partner.example.invalid"],
      });
      expect(view.allowedSenders).toEqual(["ana@example.invalid", "@partner.example.invalid"]);
      await expect(
        service.update(a, box.id, { allowedSenders: ["not an address"] }),
      ).rejects.toBeInstanceOf(MailServiceError);
      await expect(service.update(a, box.id, { botId: null })).rejects.toMatchObject({
        code: "BAD_INPUT",
      });
      await expect(
        service.update(a, box.id, { servers: { imapHost: "x.example.invalid" } }),
      ).rejects.toMatchObject({ code: "NOT_AVAILABLE" });
      expect(view).toMatchObject({ kind: "provisioned", ownerBotId: helper.id });
    });
  });

  describe("removing the mailbox", () => {
    test("purges its mail and its route, hides it, and never hands the address out again", async () => {
      const helper = await mkBot(A, "Removal");
      const box = await provisioning.giveAddress(a, helper.id);
      await store.update(a, box.id, { allowedSenders: ["ana@example.invalid"] });
      await fake.receive({
        to: [box.address],
        from: "ana@example.invalid",
        subject: "Keep?",
        text: "no",
      });
      await poller().tick();
      expect(await countMsgs(box.id)).toBe(1);
      expect(
        await db.select().from(inboundRoute).where(eq(inboundRoute.mailboxId, box.id)),
      ).toHaveLength(1);
      await service.remove(a, box.id);
      expect(await countMsgs(box.id)).toBe(0);
      expect(
        await db.select().from(inboundRoute).where(eq(inboundRoute.mailboxId, box.id)),
      ).toHaveLength(0);
      expect((await service.list(a)).some((m) => m.id === box.id)).toBe(false);
      await expect(service.conversations(a, box.id, {})).rejects.toMatchObject({
        code: "NOT_FOUND",
      });
      const [row] = await db.select().from(mailbox).where(eq(mailbox.id, box.id));
      expect(row).toMatchObject({ state: "retired", botId: null });
      expect(row!.removedAt).toBeInstanceOf(Date);
      // Mail to the address is now mail to nobody; the address stays reserved.
      await fake.receive({
        to: [box.address],
        from: "ana@example.invalid",
        subject: "Late",
        text: "x",
      });
      expect(await poller().tick()).toMatchObject({
        status: "ran",
        stats: { stored: 0, droppedUnknown: 1 },
      });
      await uniqueViolation(
        db.insert(mailbox).values({ ownerUserId: B, kind: "provisioned", address: box.address }),
      );
      // The bot may be given a new address.
      expect((await provisioning.giveAddress(a, helper.id)).id).not.toBe(box.id);
    });
  });

  describe("the outside chat reaches the owner bot through the inbound service", () => {
    test("an event of the mailbox route becomes a thread, an event and a turn that can answer only the sender", async () => {
      const helper = await mkBot(A, "Pipeline");
      const box = await provisioning.giveAddress(a, helper.id);
      await store.update(a, box.id, { allowedSenders: ["ana@example.invalid"] });
      const started: {
        external: { plugin: string; chat: string; prompt: string; label: string };
      }[] = [];
      const real = createInbound(
        db,
        { list: async () => [], bindings: async () => [] } as never,
        {
          startTurn: async (_a: unknown, _c: string, input: never) => {
            started.push(input);
            // No message row exists in this test, so no message id is handed back.
            return { rec: { events: [] } } as never;
          },
        } as never,
        lookup,
      );
      const withInbound = createMailPoller({
        db,
        store,
        messages,
        reader,
        inbound: real,
        log: () => {},
      });
      await fake.receive({
        to: [box.address],
        from: "Ana <ana@example.invalid>",
        subject: "Hello",
        text: "Please help",
      });
      expect(await withInbound.tick()).toMatchObject({
        status: "ran",
        stats: { stored: 1, turns: 1 },
      });
      // Storing the event started a delivery of its own; wait for it, then run one more pass.
      for (let i = 0; i < 100 && !started.length; i++) await new Promise((r) => setTimeout(r, 20));
      await real.tick();
      expect(started.map((s) => s.external.chat)).toEqual(["ana@example.invalid"]);
      expect(started[0]!.external).toMatchObject({
        plugin: BOTMAIL_PLUGIN,
        chat: "ana@example.invalid",
        label: "E-mail",
      });
      expect(started[0]!.external.prompt).toContain('"tool":"send_email"');
      expect(started[0]!.external.prompt).toContain('"to":"ana@example.invalid"');
      expect(started[0]!.external.prompt).toContain("Please help");
      const threads = await db.select().from(inboundThread).where(eq(inboundThread.ownerUserId, A));
      expect(threads.some((t) => t.chatKey === "ana@example.invalid")).toBe(true);
      // The poller never polls a mailbox route through a plugin: the plugin poll is a stub.
      const [route] = await db
        .select()
        .from(inboundRoute)
        .where(eq(inboundRoute.mailboxId, box.id));
      await real.tick(new Date(Date.now() + 365 * 86_400_000 + 60_000));
      expect(
        (await db.select().from(inboundRoute).where(eq(inboundRoute.id, route!.id)))[0]!
          .lastPolledAt,
      ).toBeNull();
      // The events are cleaned with the mailbox.
      await service.remove(a, box.id);
      expect(
        await db.select().from(inboundEvent).where(eq(inboundEvent.routeId, route!.id)),
      ).toHaveLength(0);
    });
  });
});
