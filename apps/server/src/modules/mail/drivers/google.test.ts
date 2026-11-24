import { afterAll, beforeEach, describe, expect, test } from "bun:test";
import type { ActiveActor } from "../../identity/access";
import { createGoogleMailAccess } from "../../integrations/plugins/google/mail-access";
import { configureGoogleForTests } from "../../integrations/plugins/google/oauth";
import type { PluginContext } from "../../integrations/plugins/registry";
import { MailConnectError } from "../imap-connect";
import {
  createGoogleDriver,
  decodeEntities,
  decodeWords,
  isAllowedGmailCall,
  parseAddresses,
  splitFileId,
} from "./google";

/**
 * The Gmail driver against a fake Gmail and a fake Google token endpoint, through the real Google plugin code (token refresh, scopes,
 * safe errors). A real Gmail account cannot be used here, so what Gmail itself answers is as these tests (and the docs) describe it.
 */

const ME = "ana@example.invalid";
/** The plugin keeps the permissions it was granted by name (`gmail.readonly`), not as Google's URLs. */
const READ = "gmail.readonly";
const SEND = "gmail.send";
const b64u = (s: string | Buffer) => Buffer.from(s).toString("base64url");
const hdrs = (o: Record<string, string>) =>
  Object.entries(o).map(([name, value]) => ({ name, value }));
const PNG = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==",
  "base64",
);
const PDF = Buffer.from("%PDF-1.4 fake");

type Part = {
  partId: string;
  mimeType: string;
  filename?: string;
  headers?: { name: string; value: string }[];
  body?: { size?: number; data?: string; attachmentId?: string };
  parts?: Part[];
};
type Msg = {
  id: string;
  threadId: string;
  labelIds: string[];
  snippet: string;
  internalDate: string;
  payload: Part;
};

const T0 = Date.parse("2026-01-01T10:00:00.000Z");
const top = (
  headers: Record<string, string>,
  mimeType: string,
  rest: Partial<Part> = {},
): Part => ({
  partId: "",
  mimeType,
  headers: hdrs(headers),
  ...rest,
});
const plain = (id: string, text: string | Buffer, extra: Record<string, string> = {}): Part => ({
  partId: id,
  mimeType: "text/plain",
  headers: hdrs({ "Content-Type": 'text/plain; charset="UTF-8"', ...extra }),
  body: { size: text.length, data: b64u(text) },
});

const MESSAGES: Msg[] = [
  {
    id: "m1aa",
    threadId: "t1aa",
    labelIds: ["INBOX", "UNREAD"],
    snippet: "Invoices &#39;ready&#39; &amp; waiting",
    internalDate: String(T0),
    payload: top(
      {
        From: "=?UTF-8?B?Wm9yYmxhdCDDhw==?= <Zorblat@Example.invalid>",
        To: "Ana <ana@example.invalid>, cy@example.invalid",
        "Reply-To": "billing@example.invalid",
        Subject: "Invoices",
        Date: "Thu, 01 Jan 2026 10:00:00 +0000",
        "Message-ID": "<orig@example.invalid>",
        References: "<root@example.invalid>",
      },
      "multipart/mixed",
      {
        parts: [
          {
            partId: "0",
            mimeType: "multipart/alternative",
            parts: [
              plain("0.0", "Hello plain"),
              {
                partId: "0.1",
                mimeType: "multipart/related",
                parts: [
                  {
                    partId: "0.1.0",
                    mimeType: "text/html",
                    headers: hdrs({ "Content-Type": "text/html; charset=UTF-8" }),
                    body: {
                      size: 40,
                      data: b64u('<p>Hello</p><img src="cid:logo@x"><script>x()</script>'),
                    },
                  },
                  {
                    partId: "0.1.1",
                    mimeType: "image/png",
                    filename: "logo.png",
                    headers: hdrs({
                      "Content-Disposition": 'inline; filename="logo.png"',
                      "Content-ID": "<logo@x>",
                    }),
                    body: { size: PNG.length, attachmentId: "ATT-LOGO" },
                  },
                ],
              },
            ],
          },
          {
            partId: "1",
            mimeType: "application/pdf",
            filename: "invoice.pdf",
            headers: hdrs({ "Content-Disposition": 'attachment; filename="invoice.pdf"' }),
            body: { size: PDF.length, attachmentId: "ATT-PDF" },
          },
          {
            partId: "2",
            mimeType: "text/csv",
            filename: "t.csv",
            body: { size: 3, data: b64u("a,b") },
          },
          {
            partId: "3",
            mimeType: "application/zip",
            filename: "big.zip",
            body: { size: 50_000_000, attachmentId: "ATT-BIG" },
          },
        ],
      },
    ),
  },
  {
    id: "m2aa",
    threadId: "t1aa",
    labelIds: ["SENT"],
    snippet: "On it",
    internalDate: String(T0 + 3_600_000),
    payload: top(
      {
        From: "Ana <ana@example.invalid>",
        To: "zorblat@example.invalid",
        Subject: "Re: Invoices",
        Date: "Thu, 01 Jan 2026 11:00:00 +0000",
        "Message-ID": "<mine@example.invalid>",
        "In-Reply-To": "<orig@example.invalid>",
      },
      "text/plain",
      { body: { size: 5, data: b64u("On it") } },
    ),
  },
  {
    id: "m3aa",
    threadId: "t1aa",
    labelIds: ["DRAFT"],
    snippet: "draft words",
    internalDate: String(T0 + 4_000_000),
    payload: top({ From: ME, Subject: "Re: Invoices" }, "text/plain", {
      body: { size: 3, data: b64u("wip") },
    }),
  },
  {
    id: "m4aa",
    threadId: "t1aa",
    labelIds: ["INBOX"],
    snippet: "Thanks, caf",
    internalDate: String(T0 + 7_200_000),
    payload: top(
      {
        From: "Zorblat <zorblat@example.invalid>",
        To: ME,
        Subject: "Re: Invoices",
        Date: "Thu, 01 Jan 2026 12:00:00 +0000",
        "Message-ID": "<m4@example.invalid>",
        "Content-Type": "text/plain; charset=ISO-8859-1",
      },
      "text/plain",
      { body: { size: 4, data: b64u(Buffer.from("caf\xe9", "latin1")) } },
    ),
  },
  {
    id: "m5aa",
    threadId: "t2aa",
    labelIds: ["INBOX"],
    snippet: "Lunch?",
    internalDate: String(T0 - 86_400_000),
    payload: top(
      {
        From: "Rui <rui@example.invalid>",
        To: ME,
        Subject: "Lunch tomorrow?",
        Date: "Wed, 31 Dec 2025 10:00:00 +0000",
        "Message-ID": "<lunch@example.invalid>",
      },
      "text/plain",
      { body: { size: 6, data: b64u("Lunch?") } },
    ),
  },
  {
    id: "m6aa",
    threadId: "t3aa",
    labelIds: ["INBOX"],
    snippet: "Photos",
    internalDate: String(T0 - 2 * 86_400_000),
    payload: top(
      {
        From: "Bia <bia@example.invalid>",
        To: ME,
        Subject: "Photos",
        Date: "Tue, 30 Dec 2025 10:00:00 +0000",
      },
      "text/plain",
      { body: { size: 6, data: b64u("Photos") } },
    ),
  },
];
const THREAD_ORDER = ["t1aa", "t2aa", "t3aa"];
const ATTACHMENTS: Record<string, Buffer> = {
  "ATT-LOGO": PNG,
  "ATT-PDF": PDF,
  "ATT-BIG": Buffer.alloc(8),
};

type Call = { method: string; path: string; query: URLSearchParams; auth: string };
let calls: Call[] = [];
/** Every request of the whole file, kept across tests. */
const everyCall: Call[] = [];
let tokenCalls = 0;
let tokenMode: "ok" | "revoked" = "ok";
let sentBodies: { raw: string; threadId?: string }[] = [];

const threadMessages = (id: string) => MESSAGES.filter((m) => m.threadId === id);
const subjectOf = (id: string) =>
  JSON.stringify(threadMessages(id)[0]!.payload.headers).toLowerCase();
const metadata = (m: Msg, wanted: string[]) => ({
  id: m.id,
  threadId: m.threadId,
  labelIds: m.labelIds,
  snippet: m.snippet,
  internalDate: m.internalDate,
  payload: {
    mimeType: m.payload.mimeType,
    headers: (m.payload.headers ?? []).filter((h) =>
      wanted.some((w) => w.toLowerCase() === h.name.toLowerCase()),
    ),
  },
});

const fake = Bun.serve({
  port: 0,
  async fetch(req) {
    const u = new URL(req.url);
    const text = await req.text();
    if (u.pathname === "/token") {
      tokenCalls++;
      return tokenMode === "revoked"
        ? Response.json({ error: "invalid_grant" }, { status: 400 })
        : Response.json({ access_token: `acc-r${tokenCalls}`, expires_in: 3600 });
    }
    const path = u.pathname.replace(/^\/gmail\/users\/me/, "");
    const auth = req.headers.get("authorization") ?? "";
    const call = { method: req.method, path, query: u.searchParams, auth };
    calls.push(call);
    everyCall.push(call);
    if (!auth.startsWith("Bearer acc-r")) return Response.json({ error: {} }, { status: 401 });
    const wanted = u.searchParams.getAll("metadataHeaders");
    const full = u.searchParams.get("format") === "full";
    if (path === "/profile") return Response.json({ emailAddress: ME });
    if (path === "/threads" && req.method === "GET") {
      const q = (u.searchParams.get("q") ?? "").toLowerCase();
      const size = Number(u.searchParams.get("maxResults") ?? "10");
      const all = THREAD_ORDER.filter((t) => !q || subjectOf(t).includes(q));
      const from = Number((u.searchParams.get("pageToken") ?? "o0").slice(1));
      const slice = all.slice(from, from + size);
      return Response.json({
        threads: slice.map((id) => ({ id })),
        ...(from + size < all.length ? { nextPageToken: `o${from + size}` } : {}),
      });
    }
    let m = /^\/threads\/([^/]+)$/.exec(path);
    if (m) {
      const msgs = threadMessages(m[1]!);
      if (!msgs.length) return Response.json({ error: {} }, { status: 404 });
      return Response.json({
        id: m[1],
        snippet: "thread snippet",
        messages: full ? msgs : msgs.map((x) => metadata(x, wanted)),
      });
    }
    m = /^\/messages\/([^/]+)$/.exec(path);
    if (m && req.method === "GET") {
      const found = MESSAGES.find((x) => x.id === m![1]);
      if (!found) return Response.json({ error: {} }, { status: 404 });
      return Response.json(full ? found : metadata(found, wanted));
    }
    m = /^\/messages\/([^/]+)\/attachments\/([^/]+)$/.exec(path);
    if (m) {
      const data = ATTACHMENTS[m[2]!];
      return data
        ? Response.json({ size: data.length, data: b64u(data) })
        : Response.json({ error: {} }, { status: 404 });
    }
    if (path === "/messages/send" && req.method === "POST") {
      sentBodies.push(JSON.parse(text));
      return Response.json({ id: "sent1", threadId: "t1aa", labelIds: ["SENT"] });
    }
    return Response.json({ error: {} }, { status: 404 });
  },
});
const base = `http://localhost:${fake.port}`;
afterAll(() => {
  fake.stop(true);
  configureGoogleForTests({});
});

const actor = { userId: "u1", isAdmin: false } as unknown as ActiveActor;
type Account = Record<string, string>;
const account = (over: Account = {}): Account => ({
  email: ME,
  refreshToken: "ref-1",
  scopes: `${READ} ${SEND}`,
  ...over,
});
function setup(accounts: Account[] = [account()], extra: Record<string, string> = {}) {
  let config: Record<string, string> = {
    clientId: "cid",
    clientSecret: "csecret",
    clientType: "desktop",
    accounts: JSON.stringify(accounts),
    ...extra,
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
  const access = createGoogleMailAccess({ context: async () => ctx });
  const driver = createGoogleDriver({ address: ME, transport: access.transport(actor, ME) });
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
  sentBodies = [];
  tokenCalls = 0;
  tokenMode = "ok";
  configureGoogleForTests({
    tokenUrl: `${base}/token`,
    revokeUrl: `${base}/revoke`,
    userinfoUrl: `${base}/userinfo`,
    gmailBase: `${base}/gmail`,
    now: () => 1_000_000,
  });
});

describe("what the helpers read", () => {
  test("header words and addresses", () => {
    expect(decodeWords("=?UTF-8?B?Wm9yYmxhdCDDhw==?=")).toBe("Zorblat Ç");
    expect(decodeWords("=?UTF-8?Q?caf=C3=A9_ok?= =?UTF-8?Q?!?=")).toBe("café ok!");
    expect(decodeWords("plain words")).toBe("plain words");
    expect(
      parseAddresses('"Last, First" <a@example.invalid>, B <B@Example.invalid>, junk'),
    ).toEqual([
      { name: "Last, First", address: "a@example.invalid" },
      { name: "B", address: "b@example.invalid" },
    ]);
    expect(decodeEntities("it&#39;s &amp; &lt;b&gt; &#x41; &unknown;")).toBe(
      "it's & <b> A &unknown;",
    );
  });

  test("a file id is a message and a MIME part; anything else is refused", () => {
    expect(splitFileId("m1aa.0.1.1")).toEqual({ message: "m1aa", part: "0.1.1" });
    for (const bad of ["m1aa", "m1aa.", ".1", "m1aa.x", "m1/aa.1", "m1aa.1..2"])
      expect(() => splitFileId(bad)).toThrow(MailConnectError);
  });
});

describe("the only calls this mailbox makes", () => {
  test("reads and the one send are allowed; everything that changes the mailbox is not", () => {
    const ok: [string, string][] = [
      ["GET", "/profile"],
      ["GET", "/threads"],
      ["GET", "/threads/t1aa"],
      ["GET", "/messages/m1aa"],
      ["GET", "/messages/m1aa/attachments/ATT-1"],
      ["POST", "/messages/send"],
    ];
    const no: [string, string][] = [
      ["POST", "/messages/m1aa/modify"],
      ["POST", "/threads/t1aa/modify"],
      ["POST", "/messages/m1aa/trash"],
      ["POST", "/threads/t1aa/trash"],
      ["POST", "/messages/batchModify"],
      ["POST", "/messages/batchDelete"],
      ["POST", "/messages"],
      ["POST", "/drafts"],
      ["POST", "/labels"],
      ["POST", "/messages/send/x"],
      ["DELETE", "/messages/m1aa"],
      ["DELETE", "/threads/t1aa"],
      ["PUT", "/labels/Label_1"],
      ["PATCH", "/labels/Label_1"],
      ["GET", "/labels"],
      ["GET", "/messages/m1aa/../../x"],
    ];
    for (const [method, path] of ok)
      expect(isAllowedGmailCall({ method: method as "GET", path })).toBe(true);
    for (const [method, path] of no)
      expect(isAllowedGmailCall({ method: method as "GET", path })).toBe(false);
  });

  test("a bad id never reaches the transport", async () => {
    let reached = 0;
    const driver = createGoogleDriver({
      address: ME,
      transport: async () => {
        reached++;
        return {};
      },
    });
    await driver.check();
    expect(reached).toBe(1);
    await expect(driver.getConversation("not a valid id/../modify")).rejects.toBeInstanceOf(
      MailConnectError,
    );
    expect(reached).toBe(1);
  });
});

describe("the list", () => {
  test("newest first, in pages, with the inbox only and no change to the mailbox", async () => {
    const { driver } = setup();
    const first = await driver.listConversations({ limit: 2 });
    expect(first.conversations.map((c) => c.id)).toEqual(["t1aa", "t2aa"]);
    expect(first.nextCursor).toBeTruthy();
    const t1 = first.conversations[0]!;
    expect(t1.subject).toBe("Invoices");
    expect(t1.messageCount).toBe(3); // the draft is not a message
    expect(t1.lastDate).toBe("2026-01-01T12:00:00.000Z");
    expect(t1.snippet).toBe("Thanks, caf");
    expect(t1.attachments).toBe("some"); // headers only: multipart/mixed
    expect(t1.participants.map((p) => p.address)).toEqual([
      "zorblat@example.invalid",
      ME,
      "cy@example.invalid",
    ]);
    expect(first.conversations[1]!.attachments).toBe("none");

    const second = await driver.listConversations({ limit: 2, cursor: first.nextCursor! });
    expect(second.conversations.map((c) => c.id)).toEqual(["t3aa"]);
    expect(second.nextCursor).toBeUndefined();

    const lists = calls.filter((c) => c.path === "/threads");
    expect(lists[0]!.query.get("labelIds")).toBe("INBOX");
    expect(lists[0]!.query.get("maxResults")).toBe("2");
    expect(lists[0]!.query.has("pageToken")).toBe(false);
    expect(lists[1]!.query.get("pageToken")).toBe("o2");
    // The page asks for headers only.
    const metaReads = calls.filter((c) => /^\/threads\/[^/]+$/.test(c.path));
    expect(metaReads.every((c) => c.query.get("format") === "metadata")).toBe(true);
  });

  test("the page size is the IMAP driver's limit", async () => {
    const { driver } = setup();
    await driver.listConversations({ limit: 500 });
    expect(calls.find((c) => c.path === "/threads")!.query.get("maxResults")).toBe("50");
  });

  test("a search goes to Gmail as it is; a page of one search is not a page of another", async () => {
    const { driver } = setup();
    const found = await driver.listConversations({ limit: 10, query: "lunch" });
    expect(found.conversations.map((c) => c.id)).toEqual(["t2aa"]);
    expect(calls.find((c) => c.path === "/threads")!.query.get("q")).toBe("lunch");
    const paged = await driver.listConversations({ limit: 1, query: "example" });
    expect(paged.nextCursor).toBeTruthy();
    const e = await failure(
      driver.listConversations({ limit: 1, query: "other", cursor: paged.nextCursor! }),
    );
    expect(e.code).toBe("BAD_ID");
    expect((await failure(driver.listConversations({ limit: 1, cursor: "garbage" }))).code).toBe(
      "BAD_ID",
    );
  });
});

describe("one conversation", () => {
  test("the person's own reply is in it, a draft is not, and every part is read", async () => {
    const { driver } = setup();
    const c = await driver.getConversation("t1aa");
    expect(c.subject).toBe("Invoices");
    expect(c.messages.map((m) => [m.id, m.origin])).toEqual([
      ["m1aa", "received"],
      ["m2aa", "sent"],
      ["m4aa", "received"],
    ]);
    const m1 = c.messages[0]!;
    expect(m1.from).toEqual({ name: "Zorblat Ç", address: "zorblat@example.invalid" });
    expect(m1.to.map((p) => p.address)).toEqual([ME, "cy@example.invalid"]);
    expect(m1.replyTo).toEqual([{ name: "", address: "billing@example.invalid" }]);
    expect(m1.messageId).toBe("orig@example.invalid");
    expect(m1.date).toBe("2026-01-01T10:00:00.000Z");
    expect(m1.text).toBe("Hello plain");
    expect(m1.htmlUnsafe).toContain('<img src="cid:logo@x">');
    expect(m1.htmlUnsafe).toContain("<script>"); // unsafe on purpose: the service cleans it
    expect(m1.source).toBe("complete");
    expect(m1.attachments.map((a) => [a.id, a.fileName, a.disposition, a.contentId])).toEqual([
      ["m1aa.0.1.1", "logo.png", "inline", "logo@x"],
      ["m1aa.1", "invoice.pdf", "attachment", ""],
      ["m1aa.2", "t.csv", "attachment", ""],
      ["m1aa.3", "big.zip", "attachment", ""],
    ]);
    expect(c.messages[1]!.text).toBe("On it");
    expect(c.messages[2]!.text).toBe("café"); // the part's own charset
  });

  test("a thread that is gone, or an id that is not one", async () => {
    const { driver } = setup();
    expect((await failure(driver.getConversation("nopeaa"))).code).toBe("NOT_FOUND");
    expect((await failure(driver.getConversation("a b"))).code).toBe("BAD_ID");
  });

  test("reading marks nothing and changes no label", async () => {
    const { driver } = setup();
    await driver.getConversation("t1aa");
    await driver.listConversations({ limit: 5 });
    await driver.getAttachment("t1aa", "m1aa.1");
    expect(calls.length).toBeGreaterThan(3);
    expect(calls.every((c) => c.method === "GET")).toBe(true);
    expect(calls.some((c) => /modify|labels|trash|delete/i.test(c.path))).toBe(false);
  });
});

describe("files", () => {
  test("one file, by the part's position", async () => {
    const { driver } = setup();
    const pdf = await driver.getAttachment("t1aa", "m1aa.1");
    expect(pdf.fileName).toBe("invoice.pdf");
    expect(Buffer.from(pdf.bytes).equals(PDF)).toBe(true);
    const csv = await driver.getAttachment("t1aa", "m1aa.2"); // small enough to come inside the message
    expect(Buffer.from(csv.bytes).toString()).toBe("a,b");
    expect(calls.filter((c) => c.path.includes("/attachments/")).map((c) => c.path)).toEqual([
      "/messages/m1aa/attachments/ATT-PDF",
    ]);
  });

  test("several files read the message once; one over the size cap is left out, a single one is refused", async () => {
    const { driver } = setup();
    const many = await driver.getAttachments("t1aa", ["m1aa.0.1.1", "m1aa.1", "m1aa.3", "m1aa.9"]);
    expect([...many.keys()]).toEqual(["m1aa.0.1.1", "m1aa.1"]);
    expect(Buffer.from(many.get("m1aa.0.1.1")!.bytes).equals(PNG)).toBe(true);
    expect(calls.filter((c) => c.path === "/messages/m1aa")).toHaveLength(1);
    expect(calls.some((c) => c.path.endsWith("ATT-BIG"))).toBe(false);
    expect((await failure(driver.getAttachment("t1aa", "m1aa.3"))).code).toBe("TOO_LARGE");
  });

  test("a file of another conversation is not handed out", async () => {
    const { driver } = setup();
    expect((await failure(driver.getAttachment("t2aa", "m1aa.1"))).code).toBe("NOT_FOUND");
    expect((await failure(driver.getAttachment("t1aa", "m1aa.7"))).code).toBe("NOT_FOUND");
    expect((await failure(driver.getAttachment("t1aa", "bad id"))).code).toBe("BAD_ID");
    expect((await driver.getAttachments("t2aa", ["m1aa.1"])).size).toBe(0);
  });
});

describe("the sign-in of the account", () => {
  test("a missing read permission is needs_auth in words that point to the plugin, and no request is made", async () => {
    const { driver } = setup([account({ scopes: SEND })]);
    for (const read of [
      () => driver.listConversations({ limit: 5 }),
      () => driver.getConversation("t1aa"),
      () => driver.check(),
    ]) {
      const e = await failure(read());
      expect(e.code).toBe("AUTH");
      expect(e.safe).toContain("permission");
      expect(e.fix).toContain("Studio > Plugins > Google");
      expect(e.fix).toContain("Change permissions");
      expect(e.fix).toContain("Gmail: read messages");
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
    expect(e.fix).toContain("Change permissions");
    expect(e.fix).toContain("Gmail: send email");
    expect(sentBodies).toHaveLength(0);
    expect((await driver.listConversations({ limit: 5 })).conversations.length).toBeGreaterThan(0);
  });

  test("an account that is not connected, and Google not installed", async () => {
    const other = setup([account({ email: "someone@example.invalid" })]);
    const e = await failure(other.driver.listConversations({ limit: 5 }));
    expect(e.code).toBe("AUTH");
    expect(e.safe).toContain("not connected");
    const none = createGoogleDriver({
      address: ME,
      transport: createGoogleMailAccess({ context: async () => undefined }).transport(actor, ME),
    });
    expect((await failure(none.listConversations({ limit: 5 }))).code).toBe("AUTH");
  });

  test("an expired token is refreshed once, and the refreshed token is kept in the plugin's own config", async () => {
    const s = setup();
    await s.driver.listConversations({ limit: 5 });
    await s.driver.getConversation("t1aa");
    expect(tokenCalls).toBe(1);
    expect(calls.every((c) => c.auth === "Bearer acc-r1")).toBe(true);
    const saved = JSON.parse(s.config().accounts!) as Account[];
    expect(saved[0]!.accessToken).toBe("acc-r1");
    expect(saved[0]!.refreshToken).toBe("ref-1");
  });

  test("a token Google refuses is refreshed and the call is tried again", async () => {
    const s = setup([account({ accessToken: "stale", expiresAt: String(1_000_000 + 3_600_000) })]);
    await s.driver.check();
    expect(tokenCalls).toBe(1);
    expect(calls.map((c) => c.auth)).toEqual(["Bearer stale", "Bearer acc-r1"]);
  });

  test("a revoked token is needs_auth, with Google's words nowhere in it, and stays so", async () => {
    tokenMode = "revoked";
    const s = setup();
    const e = await failure(s.driver.listConversations({ limit: 5 }));
    expect(e.code).toBe("AUTH");
    expect(e.safe).toContain("revoked or has expired");
    expect(e.fix).toContain("Studio > Plugins > Google");
    expect(JSON.stringify(e)).not.toContain("invalid_grant");
    expect(calls).toHaveLength(0);
    // The plugin dropped the dead refresh token; the next call needs no network to say so.
    const before = tokenCalls;
    expect((await failure(s.driver.check())).code).toBe("AUTH");
    expect(tokenCalls).toBe(before);
  });
});

describe("sending", () => {
  const rawOf = (i = 0) => Buffer.from(sentBodies[i]!.raw, "base64url").toString("utf8");
  const headerOf = (raw: string, name: string) =>
    new RegExp(`^${name}:[ \\t]*(.*(?:\\r?\\n[ \\t].*)*)$`, "im")
      .exec(raw)?.[1]
      ?.replace(/\r?\n[ \t]+/g, " ");

  test("a reply carries the threading headers and the thread id, and Gmail files the copy", async () => {
    const { driver } = setup();
    const sent = await driver.send({
      to: ["zorblat@example.invalid"],
      subject: "Re: Invoices",
      text: "The invoices go out on Monday.",
      inReplyTo: "m1aa",
    });
    expect(sent.copy).toBe("provider");
    expect(sentBodies).toHaveLength(1);
    expect(sentBodies[0]!.threadId).toBe("t1aa");
    const raw = rawOf();
    expect(headerOf(raw, "From")).toContain(ME);
    expect(headerOf(raw, "To")).toBe("zorblat@example.invalid");
    expect(headerOf(raw, "Subject")).toBe("Re: Invoices");
    expect(headerOf(raw, "In-Reply-To")).toBe("<orig@example.invalid>");
    expect(headerOf(raw, "References")).toBe("<root@example.invalid> <orig@example.invalid>");
    expect(headerOf(raw, "Message-ID")).toBe(`<${sent.messageId}>`);
    expect(raw).toContain("The invoices go out on Monday.");
    // Nothing is appended anywhere: the only calls are reads and the one send.
    const writes = calls.filter((c) => c.method !== "GET");
    expect(writes.map((c) => `${c.method} ${c.path}`)).toEqual(["POST /messages/send"]);
    expect(writes[0]!.auth).toStartWith("Bearer acc-r");
  });

  test("a new mail has no thread id and no threading headers", async () => {
    const { driver } = setup();
    await driver.send({ to: ["rui@example.invalid"], subject: "Schedule", text: "Hello" });
    expect(sentBodies[0]!.threadId).toBeUndefined();
    expect(headerOf(rawOf(), "In-Reply-To")).toBeUndefined();
    expect(calls.filter((c) => c.method === "GET")).toHaveLength(0);
  });

  test("a header cannot be smuggled in, and a message to answer that is gone is said so", async () => {
    const { driver } = setup();
    for (const bad of [
      { to: ["a@example.invalid\r\nBcc: x@example.invalid"], subject: "s", text: "t" },
      { to: ["a@example.invalid"], subject: "s\r\nBcc: x@example.invalid", text: "t" },
    ])
      expect((await failure(driver.send(bad))).code).toBe("BAD_INPUT");
    const gone = await failure(
      driver.send({ to: ["a@example.invalid"], subject: "s", text: "t", inReplyTo: "nopeaa" }),
    );
    expect(gone.code).toBe("NOT_FOUND");
    expect(gone.safe).toContain("no longer in the mailbox");
    expect(sentBodies).toHaveLength(0);
  });

  test("a message with no identifier cannot be answered", async () => {
    const { driver } = setup();
    const e = await failure(
      driver.send({ to: ["a@example.invalid"], subject: "s", text: "t", inReplyTo: "m6aa" }),
    );
    expect(e.code).toBe("NO_MESSAGE_ID");
  });
});

describe("whatever happened above", () => {
  test("no request ever changed the mailbox", () => {
    // Across every test of this file: only reads, and the one send.
    expect(everyCall.length).toBeGreaterThan(20);
    expect(
      everyCall.filter(
        (c) => c.method !== "GET" && !(c.method === "POST" && c.path === "/messages/send"),
      ),
    ).toEqual([]);
    expect(everyCall.some((c) => /modify|labels|trash|delete|drafts/i.test(c.path))).toBe(false);
  });
});
