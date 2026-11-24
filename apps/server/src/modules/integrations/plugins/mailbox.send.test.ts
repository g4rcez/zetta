import { afterAll, beforeAll, beforeEach, describe, expect, test } from "bun:test";
import { gateFor, type MailTurnFacts } from "../../chat/mail-policy";
import type { OutgoingMail, SentCopy } from "../../mail/driver";
import type { ReplyPlan } from "../../mail/service";
import type { Mailbox } from "../../mail/store";
import { openPending, sealPending } from "./approval";
import {
  configureMailbox,
  mailSendLimit,
  mailboxPlugin,
  type MailAuditEvent,
  type MailboxDeps,
} from "./mailbox";
import { PluginPause, type PluginContext } from "./registry";
import type { PluginTurn } from "./turn";

const ME = "user-me";
const OTHER_USER = "user-other";
const OWNER = "bot-owner";
const SIBLING = "bot-sibling";
const BOX = "0198f0f0-0000-7000-8000-000000000001";
const CONV = "conv-1";
const AUTHOR = "zorblat@example.invalid";
const BOTS = new Map([
  [OWNER, { id: OWNER, kind: "specialist" as const, ownerUserId: ME }],
  [SIBLING, { id: SIBLING, kind: "specialist" as const, ownerUserId: ME }],
]);
const key = (userId: string) => `test-seal-key-${userId}`;

const row = (over: Partial<Mailbox> = {}): Mailbox =>
  ({
    id: BOX,
    ownerUserId: ME,
    kind: "imap",
    address: "ana@example.invalid",
    label: "Work",
    botId: OWNER,
    connectionId: "conn-secret-id",
    config: { imapHost: "imap.example.invalid", smtpHost: "smtp.example.invalid", user: "ana" },
    state: "active",
    lastError: null,
    sending: "on",
    allowedSenders: [],
    chatConversationId: null,
    createdAt: new Date(),
    updatedAt: new Date(),
    ...over,
  }) as unknown as Mailbox;

let rows: Mailbox[] = [];
let sent: (OutgoingMail & { mailbox: string })[] = [];
let audits: MailAuditEvent[] = [];
let copy: SentCopy = "saved";
let plan: ReplyPlan;
let conversationReads = 0;
let sendFails = false;

const deps: MailboxDeps = {
  store: { list: async (a) => rows.filter((r) => r.ownerUserId === a.userId) },
  mail: {
    conversations: async () => ({ conversations: [] }),
    conversationText: async () => {
      conversationReads += 1;
      return {
        id: CONV,
        subject: "Invoices",
        messages: [
          {
            origin: "received" as const,
            from: { name: "Zorblat", address: AUTHOR },
            to: [{ name: "Ana", address: "ana@example.invalid" }],
            cc: [{ name: "Cy", address: "cy@example.invalid" }],
            date: null,
            subject: "Invoices",
            text: "hello",
            files: [],
            source: "complete" as const,
          },
        ],
      };
    },
    prepareReply: async () => plan,
    send: async (_a, id, mail) => {
      if (sendFails) throw new Error("boom");
      sent.push({ ...mail, mailbox: id });
      return { messageId: "sent-1", copy };
    },
  },
  sealKey: key,
  audit: (_u, e) => void audits.push(e),
  actorFor: async (userId) => ({ userId, isAdmin: false }) as never,
  botOf: async (userId, botId) => {
    const b = BOTS.get(botId);
    return b && b.ownerUserId === userId ? b : null;
  },
};

beforeAll(() => configureMailbox(deps));
afterAll(() => configureMailbox(undefined));
beforeEach(() => {
  rows = [row()];
  sent = [];
  audits = [];
  copy = "saved";
  sendFails = false;
  conversationReads = 0;
  mailSendLimit.reset();
  plan = {
    to: AUTHOR,
    subject: "Re: Invoices",
    answers: "m1",
    authors: [AUTHOR],
    participants: [AUTHOR, "cy@example.invalid"],
    replyToDiffers: false,
  };
});

const OPEN = { mailboxId: BOX, conversationId: CONV };
const facts = (over: Partial<MailTurnFacts> = {}): MailTurnFacts => ({
  place: "chat",
  personText: "Reply to this saying the invoices go out on Monday",
  readElsewhere: false,
  attempts: 0,
  open: OPEN,
  ...over,
});
const shown: string[] = [];
const ctx = (
  over: Partial<PluginContext> & { t?: Partial<MailTurnFacts> } = {},
): PluginContext & { t: MailTurnFacts } => {
  const { t: tf, ...rest } = over;
  const t = facts(tf);
  return {
    userId: ME,
    botId: OWNER,
    turn: "chat" as PluginTurn,
    config: {},
    setConfig: async () => {},
    mailGate: gateFor(t),
    show: (m) => void shown.push(m),
    ...rest,
    t,
  };
};
const tool = (name: string) => mailboxPlugin.tools!.find((t) => t.name === name)!;
const reply = (c: PluginContext, over: Record<string, unknown> = {}) =>
  tool("mail_reply").handler(c, {
    mailbox: BOX,
    conversation: CONV,
    text: "The invoices go out on Monday.",
    ...over,
  });
const mailSend = (c: PluginContext, over: Record<string, unknown> = {}) =>
  tool("mail_send").handler(c, {
    mailbox: BOX,
    to: ["bob@example.invalid"],
    subject: "Schedule",
    text: "Hello Bob.\nSecond line.",
    ...over,
  });
const failure = async (p: Promise<unknown>) => {
  try {
    await p;
  } catch (e) {
    return e as { code?: string; safe?: string; fix?: string; pause?: unknown };
  }
  throw new Error("expected a failure");
};
const resume = (c: PluginContext, id: string, accept = true) =>
  mailboxPlugin.pausing!.resume(
    { ...c, turn: "chat" },
    id,
    accept ? { action: "accept", content: {} } : { action: "decline" },
  );

describe("the send tools", () => {
  test("they send, and nothing else on the plugin does", () => {
    expect(tool("mail_reply").effect).toBe("send");
    expect(tool("mail_send").effect).toBe("send");
    expect(mailboxPlugin.tools!.filter((t) => t.effect !== "read").map((t) => t.name)).toEqual([
      "mail_reply",
      "mail_send",
    ]);
  });

  test("a reply the person asked for, to the open conversation, goes out at once with a short receipt", async () => {
    shown.length = 0;
    const out = String(await reply(ctx()));
    expect(sent).toEqual([
      {
        mailbox: BOX,
        to: [AUTHOR],
        subject: "Re: Invoices",
        text: "The invoices go out on Monday.",
        inReplyTo: "m1",
      },
    ]);
    expect(out).toContain(AUTHOR);
    expect(out).toContain("Re: Invoices");
    expect(out).toContain("A copy is in the Sent folder.");
    expect(out).not.toContain("go out on Monday");
    // The person sees the whole mail in their chat.
    expect(shown.join("\n")).toContain("> The invoices go out on Monday.");
    expect(shown.join("\n")).toContain(`to ${AUTHOR}`);
  });

  test("the bot gives no address and no subject for a reply, and cannot pick the recipient", async () => {
    await reply(ctx(), {
      to: ["evil@example.invalid"],
      subject: "Hijack",
      cc: ["x@example.invalid"],
    });
    expect(sent[0]!.to).toEqual([AUTHOR]);
    expect(sent[0]!.subject).toBe("Re: Invoices");
    expect(JSON.stringify(sent[0])).not.toContain("evil");
  });

  test("a new mail to an address the person wrote goes out at once; to one they did not write it waits", async () => {
    const c = ctx({ t: { open: undefined, personText: "Email bob@example.invalid the schedule" } });
    expect(String(await mailSend(c))).toContain("bob@example.invalid");
    expect(sent).toHaveLength(1);
    const e = await failure(
      mailSend(ctx({ t: { open: undefined, personText: "Email bob@example.invalid" } }), {
        to: ["evil@example.invalid"],
      }),
    );
    expect(e).toBeInstanceOf(PluginPause);
    expect(sent).toHaveLength(1);
  });

  test("a new mail to a correspondent of the open conversation is a send, read from this mailbox only", async () => {
    await mailSend(ctx({ t: { personText: "Email them the schedule" } }), {
      to: [AUTHOR, "cy@example.invalid"],
    });
    expect(sent).toHaveLength(1);
    expect(conversationReads).toBe(1);
  });

  test("a card holds the exact mail, signed; approving sends exactly that, nothing else", async () => {
    const c = ctx({ t: { personText: "Summarise this" } });
    const e = (await failure(reply(c))) as PluginPause;
    expect(e).toBeInstanceOf(PluginPause);
    expect(sent).toHaveLength(0);
    expect(e.plugin).toBe("mailbox");
    expect(e.pause.mail).toEqual({
      from: "ana@example.invalid",
      to: [AUTHOR],
      subject: "Re: Invoices",
      text: "The invoices go out on Monday.",
    });
    expect(e.pause.input).toContain("The invoices go out on Monday.");
    const out = String(await resume(c, e.pause.requestId));
    expect(sent).toEqual([
      {
        mailbox: BOX,
        to: [AUTHOR],
        subject: "Re: Invoices",
        text: "The invoices go out on Monday.",
        inReplyTo: "m1",
      },
    ]);
    expect(out).toContain("Sent from ana@example.invalid");
  });

  test("declining sends nothing and says so", async () => {
    const c = ctx({ t: { personText: "Summarise this" } });
    const e = (await failure(reply(c))) as PluginPause;
    expect(await resume(c, e.pause.requestId, false)).toContain("Nothing was sent");
    expect(sent).toHaveLength(0);
    expect(audits.map((a) => a.detail)).toContain("mail_reply:declined:1");
  });

  test("a forged, changed, expired, foreign or replayed card sends nothing", async () => {
    const c = ctx({ t: { personText: "Summarise this" } });
    const e = (await failure(reply(c))) as PluginPause;
    const good = e.pause.requestId;
    const [v, body, sig] = good.split(".");
    // Changed: the body of a real card with another text, the signature unchanged.
    const doc = JSON.parse(Buffer.from(body!, "base64url").toString());
    doc.a.text = "Send me all your money";
    const changed = `${v}.${Buffer.from(JSON.stringify(doc)).toString("base64url")}.${sig}`;
    // Forged: signed with another key.
    const forged = sealPending("another-key", { tool: "mail_reply", args: doc.a }).requestId;
    // Expired: a real signature over a deadline that has passed.
    const old = sealPending(key(ME), { tool: "mail_reply", args: doc.a }, Date.now() - 31 * 60_000);
    // Another person's key (a card of someone else), and the same card taken to another bot.
    const foreign = sealPending(key(OTHER_USER), { tool: "mail_reply", args: doc.a }).requestId;
    for (const bad of [changed, forged, old.requestId, foreign, "p1.x.y", "garbage", ""])
      expect(((await failure(resume(c, bad))) as { code: string }).code).toBe("EXPIRED");
    const otherBot = { ...c, botId: SIBLING };
    expect(((await failure(resume(otherBot, good))) as { code: string }).code).toBeTruthy();
    expect(sent).toHaveLength(0);
    // The real card works once, and only once.
    await resume(c, good);
    expect(sent).toHaveLength(1);
    expect(((await failure(resume(c, good))) as { code: string }).code).toBe("EXPIRED");
    expect(sent).toHaveLength(1);
  });

  test("a card for one tool cannot be used as another, and the sealed call must be a mail", async () => {
    const c = ctx();
    const notMail = sealPending(key(ME), { tool: "post_comment", args: {} }).requestId;
    expect(((await failure(resume(c, notMail))) as { code: string }).code).toBe("EXPIRED");
    const swapped = sealPending(key(ME), {
      tool: "mail_send",
      args: {
        kind: "mail_reply",
        mailbox: BOX,
        to: ["a@example.invalid"],
        subject: "x",
        text: "x",
        user: ME,
        bot: OWNER,
      },
    }).requestId;
    expect(((await failure(resume(c, swapped))) as { code: string }).code).toBe("EXPIRED");
  });

  test("a card is valid only while the mailbox still allows sending", async () => {
    const c = ctx({ t: { personText: "Summarise this" } });
    const e = (await failure(reply(c))) as PluginPause;
    rows = [row({ sending: "off" })];
    const err = await failure(resume(c, e.pause.requestId));
    expect(err.code).toBe("MAIL_SENDING_OFF");
    expect(sent).toHaveLength(0);
  });
});

describe("refusals", () => {
  test("sending off: a sentence that says only the person can turn it on", async () => {
    rows = [row({ sending: "off" })];
    for (const call of [() => reply(ctx()), () => mailSend(ctx())]) {
      const e = await failure(call());
      expect(e.code).toBe("MAIL_SENDING_OFF");
      expect(e.safe).toContain("turned sending off");
      expect(e.fix).toContain("only they can turn sending on");
      expect(e.fix).toContain("mailbox settings");
    }
    expect(sent).toHaveLength(0);
    expect(conversationReads).toBe(0);
  });

  test("a mailbox that is not active, or needs its password, sends nothing", async () => {
    rows = [row({ state: "error" })];
    expect((await failure(reply(ctx()))).code).toBe("MAIL_NOT_ACTIVE");
    rows = [row({ state: "needs_auth" })];
    expect((await failure(reply(ctx()))).code).toBe("MAIL_NEEDS_AUTH");
    expect(sent).toHaveLength(0);
  });

  test("another bot, another person's bot or a retired mailbox: no such mailbox", async () => {
    for (const botId of [SIBLING, "bot-nobody"])
      expect((await failure(reply(ctx({ botId })))).code).toBe("NOT_FOUND");
    rows = [row({ state: "retired" })];
    expect((await failure(reply(ctx()))).code).toBe("NOT_FOUND");
    expect((await failure(reply(ctx({ userId: OTHER_USER })))).code).toBe("NOT_FOUND");
    expect(sent).toHaveLength(0);
  });

  test("3 sends or cards per turn: the fourth is refused", async () => {
    const c = ctx({ t: { open: undefined, personText: "Email bob@example.invalid" } });
    for (let i = 0; i < 3; i++) await mailSend(c);
    const e = await failure(mailSend(c));
    expect(e.code).toBe("MAIL_TURN_LIMIT");
    expect(sent).toHaveLength(3);
    // Cards count too: a hostile mail cannot flood the person with cards.
    const c2 = ctx({ t: { open: undefined, personText: "Summarise" } });
    for (let i = 0; i < 3; i++) expect(await failure(mailSend(c2))).toBeInstanceOf(PluginPause);
    expect((await failure(mailSend(c2))).code).toBe("MAIL_TURN_LIMIT");
  });

  test("per mailbox, 5 a minute and 20 an hour, over every bot and turn", async () => {
    const t = { open: undefined, personText: "Email bob@example.invalid" };
    for (let n = 0; n < 5; n++) await mailSend(ctx({ t }));
    expect(sent).toHaveLength(5);
    expect((await failure(mailSend(ctx({ t })))).code).toBe("MAIL_RATE_LIMIT");
    // Twenty mails in the last hour, none in the last minute: the hourly limit alone refuses.
    mailSendLimit.reset();
    const now = Date.now();
    for (let n = 20; n >= 1; n--) expect(mailSendLimit.allow(BOX, now - n * 120_000)).toBe(true);
    expect((await failure(mailSend(ctx({ t })))).code).toBe("MAIL_RATE_LIMIT");
    expect(sent).toHaveLength(5);
  });

  test("a card that is approved while the mailbox is over its rate sends nothing", async () => {
    const c = ctx({ t: { personText: "Summarise this" } });
    const e = (await failure(reply(c))) as PluginPause;
    for (let n = 0; n < 5; n++) mailSendLimit.allow(BOX);
    expect(((await failure(resume(c, e.pause.requestId))) as { code: string }).code).toBe(
      "RATE_LIMITED",
    );
    expect(sent).toHaveLength(0);
  });

  test("a call with no gate (a direct call, a test) never sends without a card", async () => {
    const { mailGate: _gone, ...bare } = ctx();
    expect(await failure(reply(bare))).toBeInstanceOf(PluginPause);
    expect(sent).toHaveLength(0);
  });

  test("loop and server-started turns get a card, whatever the text says", async () => {
    for (const place of ["loop", "server"] as const) {
      const c = ctx({ turn: place, t: { place } });
      expect(await failure(reply(c))).toBeInstanceOf(PluginPause);
    }
    expect(sent).toHaveLength(0);
  });

  test("room, inbound, outside-event and no-turn calls: the tools are not there, and a forced call is refused", async () => {
    for (const turn of ["room", "inbound", "outside_event", "none", undefined] as const) {
      const c = ctx(turn ? { turn, t: { place: turn } } : { t: { place: undefined } });
      const bare = { ...c, turn } as PluginContext;
      expect(await mailboxPlugin.gate!.available(OWNER, ME, turn)).toBe(false);
      expect((await failure(reply(bare))).code).toBe("NOT_FOUND");
      expect((await failure(mailSend(bare))).code).toBe("NOT_FOUND");
    }
    expect(sent).toHaveLength(0);
    expect(await mailboxPlugin.gate!.available(OWNER, ME, "chat")).toBe(true);
  });
});

describe("the shape of a mail", () => {
  const open = { open: undefined, personText: "Email bob@example.invalid" } as const;

  test("a header cannot be smuggled in through to, the subject or a name", async () => {
    const bad = [
      { to: ["bob@example.invalid\r\nBcc: evil@example.invalid"] },
      { to: ["bob@example.invalid\nBcc: evil@example.invalid"] },
      { to: ["bob@example.invalid,evil@example.invalid"] },
      { to: ["bob@example.invalid;evil@example.invalid"] },
      { to: ["bob@example.invalid evil@example.invalid"] },
      { to: ["Bob <bob@example.invalid>"] },
      { to: ['"Bob" <bob@example.invalid>'] },
      { to: "bob@example.invalid" },
      { to: [] },
      { to: [42] },
      { to: ["bob"] },
      { to: ["a@b"] },
      { to: ["a".repeat(400) + "@example.invalid"] },
      { to: Array.from({ length: 6 }, (_, i) => `u${i}@example.invalid`) },
      { subject: "Hi\r\nBcc: evil@example.invalid" },
      { subject: "Hi\nBcc: evil@example.invalid" },
      { subject: "Hi Bcc: evil@example.invalid" },
      { subject: "" },
      { subject: "s".repeat(201) },
      { text: "" },
      { text: "   " },
      { text: "has a \u0000 nul" },
      { text: "has an escape \u001b[31m" },
      { text: "t".repeat(10_001) },
    ];
    for (const over of bad)
      expect((await failure(mailSend(ctx({ t: open }), over))).code).toBe("INVALID_ARGS");
    expect(sent).toHaveLength(0);
  });

  test("a display name in the sender's header never reaches the recipient list or the subject of a reply", async () => {
    plan = { ...plan, to: AUTHOR, subject: "Re: Invoices" };
    await reply(ctx());
    expect(sent[0]!.to).toEqual([AUTHOR]);
  });

  test("five recipients are fine, in lower case and without duplicates", async () => {
    const to = ["A@Example.invalid", "a@example.invalid", "b@example.invalid"];
    await mailSend(
      ctx({ t: { open: undefined, personText: "Email a@example.invalid and b@example.invalid" } }),
      { to },
    );
    expect(sent[0]!.to).toEqual(["a@example.invalid", "b@example.invalid"]);
  });

  test("line breaks of the text are kept, and carriage returns are not", async () => {
    await mailSend(ctx({ t: open }), { text: "one\r\ntwo\rthree" });
    expect(sent[0]!.text).toBe("one\ntwo\nthree");
  });

  test("a failed send says so, audits it and leaves nothing sent", async () => {
    sendFails = true;
    expect(await failure(mailSend(ctx({ t: open })))).toBeTruthy();
    expect(audits.at(-1)).toMatchObject({ outcome: "failed", detail: "mail_send:failed:1" });
  });

  test("when the copy could not be saved the receipt says so and the send still counts", async () => {
    copy = "not_saved";
    const out = String(await mailSend(ctx({ t: open })));
    expect(out).toContain("sent");
    expect(out).toContain("a copy could not be saved");
    expect(sent).toHaveLength(1);
    copy = "provider";
    expect(String(await mailSend(ctx({ t: open })))).not.toContain("copy");
  });
});

describe("the activity trail", () => {
  test("a send, a card, an approval and a refusal each leave one row of closed tokens and ids, never an address, subject or word of the text", async () => {
    const t = { open: undefined, personText: "Email bob@example.invalid" } as const;
    await mailSend(ctx({ t }));
    const e = (await failure(
      mailSend(ctx({ t: { open: undefined, personText: "x" } })),
    )) as PluginPause;
    await resume(ctx(), e.pause.requestId);
    rows = [row({ sending: "off" })];
    await failure(mailSend(ctx({ t })));
    expect(audits.map((a) => `${a.outcome} ${a.detail}`)).toEqual([
      "ok mail_send:sent:1",
      "ok mail_send:card:1",
      "ok mail_send:approved:1",
      "denied mail_send:refused:0",
    ]);
    for (const a of audits) {
      expect(a.subjectId).toBe(BOX);
      expect(a.botId).toBe(OWNER);
      expect(a.detail).toMatch(/^[a-z0-9_:.-]{1,40}$/);
    }
    const dump = JSON.stringify(audits);
    for (const secret of ["bob@example", "Schedule", "Hello Bob", AUTHOR])
      expect(dump).not.toContain(secret);
  });
});

describe("the sealed call", () => {
  test("it carries the person and the bot, and nothing the bot can add", async () => {
    const c = ctx({ t: { personText: "Summarise this" } });
    const e = (await failure(reply(c, { to: ["evil@example.invalid"] }))) as PluginPause;
    const pending = openPending(key(ME), e.pause.requestId);
    expect(pending.tool).toBe("mail_reply");
    expect(pending.args).toEqual({
      kind: "mail_reply",
      mailbox: BOX,
      to: [AUTHOR],
      subject: "Re: Invoices",
      text: "The invoices go out on Monday.",
      inReplyTo: "m1",
      user: ME,
      bot: OWNER,
      nonce: expect.any(String),
    });
  });
});
