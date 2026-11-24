import { afterAll, beforeEach, describe, expect, test } from "bun:test";
import type { ActiveActor } from "../../identity/access";
import { configureMicrosoftForTests } from "../../integrations/plugins/microsoft/oauth";
import { createMicrosoftMailAccess } from "../../integrations/plugins/microsoft/mail-access";
import type { PluginContext } from "../../integrations/plugins/registry";
import { MailConnectError } from "../imap-connect";
import { createMicrosoftDriver, isAllowedGraphCall, splitFileId } from "./microsoft";

/**
 * The Microsoft driver against a fake Microsoft Graph and a fake Microsoft token endpoint, through the real Microsoft plugin code (token
 * refresh, permissions, safe errors). A real Microsoft account was NOT used: what Graph answers is as these tests (and its documentation)
 * describe it.
 */

const ME = "ana@example.invalid";
const READ = "Mail.Read";
const SEND = "Mail.Send";
const PNG = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==",
  "base64",
);
const PDF = Buffer.from("%PDF-1.4 fake");
const at = (minutes: number) =>
  new Date(Date.parse("2026-01-01T10:00:00Z") + minutes * 60_000).toISOString();
const who = (address: string, name = "") => ({ emailAddress: { address, name } });

const C1 = "AAQkADconv-one_1="; // an id as Graph writes them: base64url with `=`
const C2 = "AAQkADconv-two_2=";
const C3 = "AAQkADconv-self_3=";
const F_SENT = "AAMkSENT=";
const F_DELETED = "AAMkDELETED=";
const F_INBOX = "AAMkINBOX=";

type Msg = {
  id: string;
  conversationId: string;
  internetMessageId: string;
  subject: string;
  bodyPreview: string;
  body: { contentType: "html" | "text"; content: string };
  from: ReturnType<typeof who>;
  toRecipients: ReturnType<typeof who>[];
  ccRecipients: ReturnType<typeof who>[];
  replyTo: ReturnType<typeof who>[];
  receivedDateTime: string;
  sentDateTime: string;
  hasAttachments: boolean;
  isDraft: boolean;
  parentFolderId: string;
};
const msg = (o: Partial<Msg> & Pick<Msg, "id" | "conversationId">): Msg => ({
  internetMessageId: `<${o.id}@example.invalid>`,
  subject: "Invoices",
  bodyPreview: "preview",
  body: { contentType: "text", content: "Hello" },
  from: who("zorblat@example.invalid", "Zorblat"),
  toRecipients: [who(ME, "Ana")],
  ccRecipients: [],
  replyTo: [],
  receivedDateTime: at(0),
  sentDateTime: at(0),
  hasAttachments: false,
  isDraft: false,
  parentFolderId: F_INBOX,
  ...o,
});
const MESSAGES: Msg[] = [
  msg({
    id: "i1",
    conversationId: C1,
    bodyPreview: "Hello plain",
    body: {
      contentType: "html",
      content: '<p>Hello</p><img src="cid:logo@x"><script>x()</script>',
    },
    replyTo: [who("billing@example.invalid")],
    hasAttachments: true,
    receivedDateTime: at(0),
    sentDateTime: at(0),
  }),
  msg({
    id: "s1",
    conversationId: C1,
    subject: "RE: Invoices",
    from: who(ME, "Ana"),
    toRecipients: [who("billing@example.invalid")],
    body: { contentType: "text", content: "Thanks, paid." },
    parentFolderId: F_SENT,
    receivedDateTime: at(10),
    sentDateTime: at(10),
  }),
  msg({
    id: "d1",
    conversationId: C1,
    isDraft: true,
    parentFolderId: "AAMkDRAFTS=",
    sentDateTime: at(20),
    receivedDateTime: at(20),
  }),
  msg({
    id: "x1",
    conversationId: C1,
    parentFolderId: F_DELETED,
    sentDateTime: at(30),
    receivedDateTime: at(30),
  }),
  msg({
    id: "i2",
    conversationId: C1,
    subject: "RE: Invoices",
    bodyPreview: "Second words",
    body: { contentType: "text", content: "Second" },
    receivedDateTime: at(60),
    sentDateTime: at(60),
  }),
  msg({
    id: "i3",
    conversationId: C2,
    subject: "Lunch",
    bodyPreview: "Lunch on Friday?",
    body: { contentType: "text", content: "Lunch on Friday?" },
    receivedDateTime: at(120),
    sentDateTime: at(120),
  }),
  // Mail the person sent to themselves: one copy received, one in Sent Items, one Message-ID.
  msg({
    id: "self-in",
    conversationId: C3,
    internetMessageId: "<self@example.invalid>",
    subject: "Note",
    from: who(ME),
    receivedDateTime: at(200),
    sentDateTime: at(200),
  }),
  msg({
    id: "self-out",
    conversationId: C3,
    internetMessageId: "<self@example.invalid>",
    subject: "Note",
    from: who(ME),
    parentFolderId: F_SENT,
    receivedDateTime: at(200),
    sentDateTime: at(200),
  }),
];
const INBOX_ORDER = ["i3", "i2", "i1", "self-in"].sort(
  (a, b) =>
    Date.parse(MESSAGES.find((m) => m.id === b)!.receivedDateTime) -
    Date.parse(MESSAGES.find((m) => m.id === a)!.receivedDateTime),
);
const ATTACH: Record<
  string,
  Record<
    string,
    {
      type?: string;
      name: string;
      contentType: string;
      inline: boolean;
      cid: string | null;
      bytes: Buffer;
    }
  >
> = {
  i1: {
    "ATT-LOGO=": {
      name: "logo.png",
      contentType: "image/png",
      inline: true,
      cid: "logo@x",
      bytes: PNG,
    },
    "ATT-PDF=": {
      name: "invoice.pdf",
      contentType: "application/pdf",
      inline: false,
      cid: null,
      bytes: PDF,
    },
    "ATT-ITEM=": {
      type: "#microsoft.graph.itemAttachment",
      name: "forwarded",
      contentType: "message/rfc822",
      inline: false,
      cid: null,
      bytes: Buffer.from("x"),
    },
  },
};

let tokenCalls = 0;
let tokenMode: "ok" | "revoked" = "ok";
let attachSelectMode: "ok" | "refused" = "ok";
let staleTokens = new Set<string>();
let calls: {
  method: string;
  path: string;
  query: URLSearchParams;
  auth?: string;
  prefer?: string;
}[] = [];
let sent: { path: string; body: any }[] = [];
const everyCall: { method: string; path: string }[] = [];
let hugeAttachment = false;

const fake = Bun.serve({
  port: 0,
  async fetch(req) {
    const u = new URL(req.url);
    const text = await req.text();
    if (u.pathname.endsWith("/oauth2/v2.0/token")) {
      tokenCalls++;
      const f = new URLSearchParams(text);
      if (tokenMode === "revoked")
        return Response.json({ error: "invalid_grant" }, { status: 400 });
      return Response.json({
        access_token: `acc-r${tokenCalls}`,
        refresh_token: `ref-n${tokenCalls}`,
        expires_in: 3600,
        scope: f.get("grant_type") === "refresh_token" ? "Mail.Read Mail.Send User.Read" : "",
      });
    }
    const path = u.pathname.replace(/^\/v1\.0/, "");
    const call = {
      method: req.method,
      path,
      query: u.searchParams,
      auth: req.headers.get("authorization") ?? undefined,
      prefer: req.headers.get("prefer") ?? undefined,
    };
    calls.push(call);
    everyCall.push({ method: req.method, path });
    if (call.auth && staleTokens.has(call.auth.replace("Bearer ", "")))
      return Response.json({ error: {} }, { status: 401 });
    const json = (o: unknown, status = 200) => Response.json(o, { status });
    const pick = (m: Msg, select: string | null) => {
      if (!select) return m;
      const keep = select.split(",");
      return Object.fromEntries(Object.entries(m).filter(([k]) => keep.includes(k)));
    };
    if (req.method === "GET" && path === "/me") return json({ id: "u1", mail: ME });
    let m = /^\/me\/mailFolders\/(sentitems|deleteditems|junkemail)$/.exec(path);
    if (m && req.method === "GET")
      return m[1] === "junkemail"
        ? json({ error: {} }, 404)
        : json({ id: m[1] === "sentitems" ? F_SENT : F_DELETED });
    if (path === "/me/mailFolders/inbox/messages" && req.method === "GET") {
      const search = u.searchParams.get("$search");
      const top = Number(u.searchParams.get("$top") ?? 10);
      const skip = Number(u.searchParams.get("$skip") ?? 0);
      let ids = INBOX_ORDER;
      if (search)
        ids = ids.filter((id) =>
          JSON.stringify(MESSAGES.find((x) => x.id === id))
            .toLowerCase()
            .includes(search.replace(/^"|"$/g, "").toLowerCase()),
        );
      const page = ids.slice(skip, skip + top).map((id) =>
        pick(
          MESSAGES.find((x) => x.id === id)!,
          u.searchParams.get("$select"),
        ),
      );
      const more = skip + top < ids.length;
      const next = new URL(`${u.origin}/v1.0/me/mailFolders/inbox/messages`);
      u.searchParams.forEach((v, k) => next.searchParams.set(k, v));
      next.searchParams.set("$skip", String(skip + top));
      return json({ value: page, ...(more ? { "@odata.nextLink": next.toString() } : {}) });
    }
    if (path === "/me/messages" && req.method === "GET") {
      const f = /conversationId eq '([^']+)'/.exec(u.searchParams.get("$filter") ?? "");
      return json({
        value: MESSAGES.filter((x) => x.conversationId === f?.[1]).map((x) =>
          pick(x, u.searchParams.get("$select")),
        ),
      });
    }
    m = /^\/me\/messages\/([^/]+)\/attachments$/.exec(path);
    if (m && req.method === "GET") {
      if (u.searchParams.get("$select") && attachSelectMode === "refused")
        return json({ error: { code: "RequestBroker--ParseUri" } }, 400);
      const list = ATTACH[m[1]!];
      if (!list) return json({ value: [] });
      return json({
        value: Object.entries(list).map(([id, a]) => ({
          "@odata.type": a.type ?? "#microsoft.graph.fileAttachment",
          id,
          name: a.name,
          contentType: a.contentType,
          size: hugeAttachment && a.name === "invoice.pdf" ? 50_000_000 : a.bytes.length,
          isInline: a.inline,
          contentId: a.cid,
          ...(u.searchParams.get("$select") ? {} : { contentBytes: a.bytes.toString("base64") }),
        })),
      });
    }
    m = /^\/me\/messages\/([^/]+)\/attachments\/([^/]+)\/\$value$/.exec(path);
    if (m && req.method === "GET") {
      const a = ATTACH[m[1]!]?.[m[2]!];
      return a ? new Response(a.bytes) : json({ error: {} }, 404);
    }
    m = /^\/me\/messages\/([^/]+)$/.exec(path);
    if (m && req.method === "GET") {
      const found = MESSAGES.find((x) => x.id === m![1]);
      return found ? json(pick(found, u.searchParams.get("$select"))) : json({ error: {} }, 404);
    }
    if (req.method === "POST" && path === "/me/sendMail") {
      sent.push({ path, body: JSON.parse(text) });
      return new Response(null, { status: 202 });
    }
    m = /^\/me\/messages\/([^/]+)\/reply$/.exec(path);
    if (m && req.method === "POST") {
      if (!MESSAGES.some((x) => x.id === m![1])) return json({ error: {} }, 404);
      sent.push({ path, body: JSON.parse(text) });
      return new Response(null, { status: 202 });
    }
    return json({ error: {} }, 404);
  },
});
const base = `http://localhost:${fake.port}`;
afterAll(() => {
  fake.stop(true);
  configureMicrosoftForTests({});
});

const actor = { userId: "u1", isAdmin: false } as unknown as ActiveActor;
type Account = Record<string, string>;
const account = (over: Account = {}): Account => ({
  email: ME,
  refreshToken: "ref-1",
  scopes: `${READ} ${SEND}`,
  ...over,
});
function setup(accounts: Account[] = [account()]) {
  let config: Record<string, string> = {
    clientId: "00000000-0000-0000-0000-000000000000",
    clientType: "desktop",
    accounts: JSON.stringify(accounts),
  };
  const ctx: PluginContext = {
    userId: "u1",
    get config() {
      return config;
    },
    async setConfig(n) {
      config = { ...n };
    },
  };
  const access = createMicrosoftMailAccess({ context: async () => ctx });
  const driver = createMicrosoftDriver({ address: ME, transport: access.transport(actor, ME) });
  return { ctx, driver, access, config: () => config };
}
const failure = async (p: Promise<unknown>) => {
  try {
    await p;
  } catch (e) {
    expect(e).toBeInstanceOf(MailConnectError);
    return e as MailConnectError;
  }
  throw new Error("expected a failure");
};

beforeEach(() => {
  calls = [];
  sent = [];
  tokenCalls = 0;
  tokenMode = "ok";
  attachSelectMode = "ok";
  hugeAttachment = false;
  staleTokens = new Set();
  configureMicrosoftForTests({
    loginBase: base,
    graphBase: `${base}/v1.0`,
    now: () => 1_000_000,
  });
});

describe("what the helpers read", () => {
  test("a file id is a message and an attachment; anything else is refused", () => {
    expect(splitFileId("AAMk1=.ATT-PDF=")).toEqual({ message: "AAMk1=", file: "ATT-PDF=" });
    for (const bad of ["", "nodot", ".x", "x.", "a b.c", "a/b.c", "a.b/../c"])
      expect(() => splitFileId(bad)).toThrow();
  });
});

describe("the only calls this mailbox makes", () => {
  test("reads and the two sends are allowed; everything that changes the mailbox is not", () => {
    const ok: [string, string][] = [
      ["GET", "/me"],
      ["GET", "/me/mailFolders/inbox/messages"],
      ["GET", "/me/mailFolders/sentitems"],
      ["GET", "/me/messages"],
      ["GET", "/me/messages/AAMk1="],
      ["GET", "/me/messages/AAMk1=/attachments"],
      ["GET", "/me/messages/AAMk1=/attachments/ATT=/$value"],
      ["POST", "/me/sendMail"],
      ["POST", "/me/messages/AAMk1=/reply"],
    ];
    const no: [string, string][] = [
      ["POST", "/me/messages/AAMk1=/createReply"],
      ["POST", "/me/messages/AAMk1=/send"],
      ["POST", "/me/messages/AAMk1=/move"],
      ["POST", "/me/messages/AAMk1=/forward"],
      ["POST", "/me/messages/AAMk1=/replyAll"],
      ["POST", "/me/messages"],
      ["POST", "/me/mailFolders/inbox/messages"],
      ["POST", "/me/mailFolders"],
      ["PATCH", "/me/messages/AAMk1="],
      ["PUT", "/me/messages/AAMk1="],
      ["DELETE", "/me/messages/AAMk1="],
      ["DELETE", "/me/mailFolders/inbox"],
      ["POST", "/me/messages/AAMk1=/permanentDelete"],
      ["GET", "/me/mailFolders"],
      ["GET", "/me/mailFolders/drafts"],
      ["GET", "/me/messages/AAMk1=/$value"],
      ["GET", "/me/messages/AAMk1=/../../x"],
      ["GET", "/users/x/messages"],
      ["POST", "/me/sendMail/x"],
    ];
    for (const [method, path] of ok)
      expect(isAllowedGraphCall({ method: method as "GET", path })).toBe(true);
    for (const [method, path] of no)
      expect(isAllowedGraphCall({ method: method as "GET", path })).toBe(false);
  });

  test("a bad id never reaches the transport", async () => {
    const { driver } = setup();
    for (const id of ["", "a b", "a/../b", "x'y", "a".repeat(600)])
      expect((await failure(driver.getConversation(id))).code).toBe("BAD_ID");
    expect((await failure(driver.getAttachment(C1, "no-dot"))).code).toBe("BAD_ID");
    expect(
      (
        await failure(
          driver.send({ to: ["a@example.invalid"], subject: "s", text: "t", inReplyTo: "a b" }),
        )
      ).code,
    ).toBe("BAD_ID");
    expect(calls).toHaveLength(0);
  });
});

describe("the list", () => {
  test("newest first, one row per conversation of the page, the inbox only", async () => {
    const { driver } = setup();
    const page = await driver.listConversations({ limit: 10 });
    expect(page.conversations.map((c) => c.id)).toEqual([C3, C2, C1]);
    expect(page.nextCursor).toBeUndefined();
    const one = page.conversations.find((c) => c.id === C1)!;
    expect(one).toMatchObject({
      subject: "Invoices",
      messageCount: 2,
      snippet: "Second words",
      attachments: "some",
      lastDate: at(60),
    });
    expect(one.participants.map((p) => p.address)).toContain("zorblat@example.invalid");
    expect(page.conversations.find((c) => c.id === C2)!.attachments).toBe("none");
    // One request for the whole page, ordered by date, with no body asked for.
    const lists = calls.filter((c) => c.path === "/me/mailFolders/inbox/messages");
    expect(lists).toHaveLength(1);
    expect(lists[0]!.query.get("$orderby")).toBe("receivedDateTime desc");
    expect(lists[0]!.query.get("$select")).not.toContain("body,");
    expect(calls).toHaveLength(1);
  });

  test("a page is a page of messages; the next link is the cursor and brings the rest", async () => {
    const { driver } = setup();
    const first = await driver.listConversations({ limit: 2 });
    expect(first.conversations.map((c) => c.id)).toEqual([C3, C2]);
    expect(first.nextCursor).toBeTruthy();
    const second = await driver.listConversations({ limit: 2, cursor: first.nextCursor! });
    expect(second.conversations.map((c) => c.id)).toEqual([C1]);
    expect(second.conversations[0]!.messageCount).toBe(2);
    expect(second.nextCursor).toBeUndefined();
    const last = calls.at(-1)!;
    expect(last.query.get("$skip")).toBe("2");
    expect(last.path).toBe("/me/mailFolders/inbox/messages");
  });

  test("a search goes to Graph as $search, with no $orderby; a page of one search is not a page of another", async () => {
    const { driver } = setup();
    const found = await driver.listConversations({
      limit: 1,
      query: 'lunch "now" \\',
      cursor: undefined,
    });
    expect(calls[0]!.query.get("$search")).toBe('"lunch \\"now\\" \\\\"');
    expect(calls[0]!.query.get("$orderby")).toBeNull();
    expect(found.conversations).toEqual([]);
    const hit = await driver.listConversations({ limit: 1, query: "Lunch" });
    expect(hit.conversations.map((c) => c.id)).toEqual([C2]);
    const other = await driver.listConversations({ limit: 1, query: "invoices" });
    expect(other.conversations.map((c) => c.id)).toEqual([C1]);
    const withCursor = await driver.listConversations({ limit: 1, query: "invoices" });
    expect(withCursor.nextCursor).toBeTruthy();
    expect(
      (
        await failure(
          driver.listConversations({ limit: 1, query: "lunch", cursor: withCursor.nextCursor! }),
        )
      ).code,
    ).toBe("BAD_ID");
  });

  test("a cursor can only carry its query back: a link to another path, or a made-up cursor, is refused", async () => {
    const { driver } = setup();
    const forged = (u: string) =>
      Buffer.from(JSON.stringify({ v: 1, k: "n", u, q: "" })).toString("base64url");
    for (const u of [`${base}/v1.0/me/messages/AAMk1=`, "not a url"])
      expect((await failure(driver.listConversations({ limit: 5, cursor: forged(u) }))).code).toBe(
        "BAD_ID",
      );
    expect((await failure(driver.listConversations({ limit: 5, cursor: "zzz" }))).code).toBe(
      "BAD_ID",
    );
    // The host of a link is never used: the call always goes to the plugin's own Graph address.
    const before = calls.length;
    await driver.listConversations({
      limit: 5,
      cursor: forged("https://evil.example.invalid/v1.0/me/mailFolders/inbox/messages?$skip=1"),
    });
    expect(calls.length).toBe(before + 1);
    expect(calls.at(-1)!.query.get("$skip")).toBe("1");
    // A key that is not on the list is dropped, not passed on.
    await driver.listConversations({
      limit: 5,
      cursor: forged(
        `${base}/v1.0/me/mailFolders/inbox/messages?$skip=0&$expand=attachments&$filter=x`,
      ),
    });
    expect(calls.at(-1)!.query.get("$expand")).toBeNull();
    expect(calls.at(-1)!.query.get("$filter")).toBeNull();
  });

  test("the page size is the IMAP driver's limit", async () => {
    const { driver } = setup();
    await driver.listConversations({ limit: 5000 });
    expect(calls[0]!.query.get("$top")).toBe("50");
  });
});

describe("one conversation", () => {
  test("the person's own reply is in it, a draft and the deleted are not, and the order is the clock's", async () => {
    const { driver } = setup();
    const c = await driver.getConversation(C1);
    expect(c.subject).toBe("Invoices");
    expect(c.messages.map((m) => [m.id, m.origin])).toEqual([
      ["i1", "received"],
      ["s1", "sent"],
      ["i2", "received"],
    ]);
    expect(c.messages[1]!.from?.address).toBe(ME);
    expect(c.messages[1]!.to.map((p) => p.address)).toEqual(["billing@example.invalid"]);
    expect(c.messages[1]!.text).toBe("Thanks, paid.");
    // One filtered request across the folders, not an Inbox request.
    const filtered = calls.find((x) => x.path === "/me/messages")!;
    expect(filtered.query.get("$filter")).toBe(`conversationId eq '${C1}'`);
    expect(filtered.query.get("$orderby")).toBeNull();
    expect(filtered.prefer).toBe('IdType="ImmutableId"');
  });

  test("HTML stays unsafe for the sanitiser, with its text, its reply-to, its inline image and its file", async () => {
    const { driver } = setup();
    const [first] = (await driver.getConversation(C1)).messages;
    expect(first!.htmlUnsafe).toContain("<script>");
    expect(first!.htmlUnsafe).toContain("cid:logo@x");
    expect(first!.text).toContain("Hello");
    expect(first!.text).not.toContain("<p>");
    expect(first!.replyTo.map((p) => p.address)).toEqual(["billing@example.invalid"]);
    expect(first!.from).toEqual({ name: "Zorblat", address: "zorblat@example.invalid" });
    expect(first!.messageId).toBe("i1@example.invalid");
    expect(first!.attachments).toEqual([
      {
        id: "i1.ATT-LOGO=",
        fileName: "logo.png",
        contentType: "image/png",
        size: PNG.length,
        disposition: "inline",
        contentId: "logo@x",
      },
      {
        id: "i1.ATT-PDF=",
        fileName: "invoice.pdf",
        contentType: "application/pdf",
        size: PDF.length,
        disposition: "attachment",
        contentId: "",
      },
    ]); // the attached message (an item) is not a file
    expect(first!.source).toBe("complete");
  });

  test("a message to oneself is shown once, as the received copy", async () => {
    const { driver } = setup();
    const c = await driver.getConversation(C3);
    expect(c.messages.map((m) => [m.id, m.origin])).toEqual([["self-in", "received"]]);
  });

  test("a conversation that is gone, or that has only drafts, is not found", async () => {
    const { driver } = setup();
    expect((await failure(driver.getConversation("AAQknothing="))).code).toBe("NOT_FOUND");
  });

  test("when Graph refuses the narrow attachment list, the full list is read and the bytes in it are dropped", async () => {
    attachSelectMode = "refused";
    const { driver } = setup();
    const [first] = (await driver.getConversation(C1)).messages;
    expect(first!.attachments.map((a) => a.fileName)).toEqual(["logo.png", "invoice.pdf"]);
    expect(JSON.stringify(first)).not.toContain(PDF.toString("base64"));
  });
});

describe("files", () => {
  test("one file, by its bytes, and only inside its conversation", async () => {
    const { driver } = setup();
    const f = await driver.getAttachment(C1, "i1.ATT-PDF=");
    expect(f.fileName).toBe("invoice.pdf");
    expect(Buffer.from(f.bytes)).toEqual(PDF);
    expect((await failure(driver.getAttachment(C2, "i1.ATT-PDF="))).code).toBe("NOT_FOUND");
    expect((await failure(driver.getAttachment(C1, "i1.NOPE="))).code).toBe("NOT_FOUND");
    expect((await failure(driver.getAttachment(C1, "i1.ATT-ITEM="))).code).toBe("NOT_FOUND");
  });

  test("several files read the message once; one over the size cap is left out, a single one is refused", async () => {
    hugeAttachment = true;
    const { driver } = setup();
    calls = [];
    const many = await driver.getAttachments(C1, ["i1.ATT-LOGO=", "i1.ATT-PDF=", "i1.MISSING="]);
    expect([...many.keys()]).toEqual(["i1.ATT-LOGO="]);
    expect(calls.filter((c) => c.path === "/me/messages/i1/attachments")).toHaveLength(1);
    expect((await failure(driver.getAttachment(C1, "i1.ATT-PDF="))).code).toBe("TOO_LARGE");
    const other = await driver.getAttachments(C2, ["i1.ATT-LOGO="]);
    expect(other.size).toBe(0);
  });
});

describe("the sign-in of the account", () => {
  test("a missing read permission is needs_auth in words that point to the plugin, and no request is made", async () => {
    const { driver } = setup([account({ scopes: SEND })]);
    for (const read of [
      () => driver.listConversations({ limit: 5 }),
      () => driver.getConversation(C1),
      () => driver.check(),
    ]) {
      const e = await failure(read());
      expect(e.code).toBe("AUTH");
      expect(e.safe).toContain("permission");
      expect(e.fix).toContain("Studio > Plugins > Microsoft");
      expect(e.fix).toContain("Change permissions");
      expect(e.fix).toContain("Mail: read messages");
    }
    expect(calls).toHaveLength(0);
    expect(tokenCalls).toBe(0);
  });

  test("a missing send permission refuses the send only; reading still works", async () => {
    const { driver } = setup([account({ scopes: READ })]);
    const e = await failure(
      driver.send({ to: ["rui@example.invalid"], subject: "Hi", text: "Hello" }),
    );
    expect(e.code).toBe("SEND_SCOPE");
    expect(e.fix).toContain("Mail: send email");
    expect(sent).toHaveLength(0);
    expect((await driver.listConversations({ limit: 5 })).conversations.length).toBeGreaterThan(0);
  });

  test("an account that is not connected, and Microsoft not installed", async () => {
    const other = setup([account({ email: "someone@example.invalid" })]);
    const e = await failure(other.driver.listConversations({ limit: 5 }));
    expect(e.code).toBe("AUTH");
    expect(e.safe).toContain("not connected");
    const none = createMicrosoftDriver({
      address: ME,
      transport: createMicrosoftMailAccess({ context: async () => undefined }).transport(actor, ME),
    });
    expect((await failure(none.listConversations({ limit: 5 }))).code).toBe("AUTH");
  });

  test("an expired token is refreshed once, and the new tokens are kept in the plugin's own config", async () => {
    const s = setup();
    await s.driver.listConversations({ limit: 5 });
    await s.driver.getConversation(C2);
    expect(tokenCalls).toBe(1);
    expect(calls.every((c) => c.auth === "Bearer acc-r1")).toBe(true);
    const saved = JSON.parse(s.config().accounts!) as Account[];
    expect(saved[0]!.accessToken).toBe("acc-r1");
    expect(saved[0]!.refreshToken).toBe("ref-n1"); // Microsoft hands out a new refresh token; the old one is discarded
    expect(saved[0]!.scopes).toBe(`${READ} ${SEND}`);
  });

  test("a token Graph refuses is refreshed and the call is tried again", async () => {
    staleTokens = new Set(["stale"]);
    const s = setup([account({ accessToken: "stale", expiresAt: String(1_000_000 + 3_600_000) })]);
    await s.driver.check();
    expect(tokenCalls).toBe(1);
    expect(calls.map((c) => c.auth)).toEqual(["Bearer stale", "Bearer acc-r1"]);
  });

  test("an expired or revoked refresh token is needs_auth, with Microsoft's words nowhere in it, and stays so", async () => {
    tokenMode = "revoked";
    const s = setup();
    const e = await failure(s.driver.listConversations({ limit: 5 }));
    expect(e.code).toBe("AUTH");
    expect(e.safe).toContain("revoked or has expired");
    expect(e.fix).toContain("Studio > Plugins > Microsoft");
    expect(JSON.stringify(e)).not.toContain("invalid_grant");
    expect(calls).toHaveLength(0);
    // The plugin dropped the dead refresh token; the next call needs no network to say so.
    const before = tokenCalls;
    expect((await failure(s.driver.check())).code).toBe("AUTH");
    expect(tokenCalls).toBe(before);
    const saved = JSON.parse(s.config().accounts!) as Account[];
    expect(saved[0]!.refreshToken).toBeUndefined();
  });

  test("Graph's own failures become our words", async () => {
    const { driver } = setup();
    // A message that is not there.
    expect((await failure(driver.getAttachment(C1, "gone.ATT="))).code).toBe("NOT_FOUND");
  });
});

describe("sending", () => {
  test("an answer is the reply action on the message, to the recipients the server chose, and Outlook files the copy", async () => {
    const { driver } = setup();
    const out = await driver.send({
      to: ["billing@example.invalid"],
      subject: "Re: Invoices",
      text: "Paid on Monday.\nThanks.",
      inReplyTo: "i1",
    });
    expect(out).toEqual({ messageId: "", copy: "provider" });
    expect(sent).toEqual([
      {
        path: "/me/messages/i1/reply",
        body: {
          message: { toRecipients: [{ emailAddress: { address: "billing@example.invalid" } }] },
          comment: "Paid on Monday.\nThanks.",
        },
      },
    ]);
    // No draft is made, and the answered message is not read first.
    expect(calls.map((c) => `${c.method} ${c.path}`)).toEqual(["POST /me/messages/i1/reply"]);
  });

  test("a new message is sendMail, plain text, saved to Sent Items", async () => {
    const { driver } = setup();
    const out = await driver.send({
      to: ["a@example.invalid", "b@example.invalid"],
      subject: "Plan",
      text: "Hello",
    });
    expect(out.copy).toBe("provider");
    expect(sent).toEqual([
      {
        path: "/me/sendMail",
        body: {
          message: {
            subject: "Plan",
            body: { contentType: "Text", content: "Hello" },
            toRecipients: [
              { emailAddress: { address: "a@example.invalid" } },
              { emailAddress: { address: "b@example.invalid" } },
            ],
          },
          saveToSentItems: true,
        },
      },
    ]);
  });

  test("a header cannot be smuggled in, and a message to answer that is gone is said so", async () => {
    const { driver } = setup();
    for (const bad of [
      { to: ["a@example.invalid"], subject: "x\r\nBcc: z@example.invalid", text: "t" },
      { to: ["a@example.invalid\r\nBcc: z@example.invalid"], subject: "s", text: "t" },
      { to: [], subject: "s", text: "t" },
    ])
      expect((await failure(driver.send(bad))).code).toBe("BAD_INPUT");
    const e = await failure(
      driver.send({ to: ["a@example.invalid"], subject: "s", text: "t", inReplyTo: "ZZZ=" }),
    );
    expect(e.code).toBe("NOT_FOUND");
    expect(e.safe).toContain("no longer in the mailbox");
    expect(sent).toHaveLength(0);
  });
});

describe("whatever happened above", () => {
  test("no request ever changed the mailbox: only reads on the list, and the two sends", () => {
    expect(everyCall.length).toBeGreaterThan(40);
    // Every request that reached the fake Graph is one of the calls on the list.
    expect(everyCall.filter((c) => !isAllowedGraphCall(c as never))).toEqual([]);
    expect(
      everyCall.filter(
        (c) =>
          c.method !== "GET" &&
          !(
            c.method === "POST" &&
            (c.path === "/me/sendMail" || /^\/me\/messages\/[^/]+\/reply$/.test(c.path))
          ),
      ),
    ).toEqual([]);
    expect(
      everyCall.some((c) => /createReply|drafts|\/move|\/forward|permanentDelete/i.test(c.path)),
    ).toBe(false);
  });
});
