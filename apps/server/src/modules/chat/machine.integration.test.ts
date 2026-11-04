import { uuidv7 } from "@zetta/core/uuid";
import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { mkdir, mkdtemp, realpath, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createDb } from "@zetta/db";
import { user } from "@zetta/db/schema/auth";
import { membership } from "@zetta/db/schema/identity";
import { createApp } from "../../app";
import { cleanupTestUsers } from "../../test-support/db-cleanup";
import { createConnectionsService } from "../connections/service";
import { createConnectionStore } from "../connections/store";
import type { MachineRunner, Op, Target } from "../computer/machine-runner";
import { createMachineService } from "../computer/machines";
import { createIdentityAccess } from "../identity/access";
import { codeDir } from "./harness";
import { createTurnRunner } from "./pipeline";
import { createChatService } from "./service";

/**
 * zetta:machine end to end: a bot names a machine the user saved; Zetta runs the call with the stored secret. The secret never
 * reaches the bot's prompt, the reply, the stored messages or the audit log; deletes wait for the user; files move only inside the
 * user's workspace. The runner is a fake that records what it was given.
 */
const url = process.env.ZETTA_CHAT_TEST_DATABASE_URL;
const suite = url?.endsWith("/zetta_test") ? describe : describe.skip; // initializes a key check: only ever against the dedicated test database
const ids = [`mchat-a-${uuidv7()}`, `mchat-b-${uuidv7()}`];
const [A, B] = ids as [string, string];
const KEY = Buffer.alloc(32, 7).toString("base64");
const PRIVATE_KEY = [
  "-----BEGIN OPENSSH PRIVATE KEY-----",
  "ZmFrZS1rZXktbWF0ZXJpYWwtZm9yLXRlc3RzLW9ubHktbm90LWEtcmVhbC1rZXktYWFhYWFhYWFhYWFh",
  "ZGRkZGRkZGRkZGRkZGRkZGRkZGRkZGRkZGRkZGRkZGRkZGRkZGRkZGRkZGRkZGRkZGRkZGRkZGRkZGRk",
  "-----END OPENSSH PRIVATE KEY-----",
].join("\n");
const HOST_KEY = "ssh-ed25519 AAAAC3NzaC1lZDI1NTE5AAAAIATuBV2ktuq3oFQO73FGrq92TshlkGHPmbljpoDTEOZT";

suite("zetta:machine against compose postgres", () => {
  const db = createDb({ DATABASE_URL: url ?? "postgresql://unused@localhost/unused" } as never);
  const access = createIdentityAccess(
    {
      api: {
        async getSession({ headers }) {
          const id = headers.get("x-test-user");
          return id ? { user: { id } } : null;
        },
      },
    },
    async () => ({ isAdmin: false }),
  );
  let script: string[] = [];
  const prompts: string[] = [];
  // The real prompt pipeline runs; only the model CLI is fake. It records everything the model is sent: the user's message, the
  // tool instructions and earlier tool results.
  const cli = async (input: object) => {
    prompts.push(JSON.stringify(input));
    return script.shift() ?? "done";
  };
  const stream = async function* (input: object) {
    prompts.push(JSON.stringify(input));
    yield script.shift() ?? "done";
  };
  const calls: { target: Target; secret: string; op: Op }[] = [];
  const runner = {
    scan: async () => [{ type: "ssh-ed25519", key: HOST_KEY, fingerprint: "SHA256:fake" }],
    publicKey: async () =>
      "ssh-ed25519 AAAAC3NzaC1lZDI1NTE5AAAAIPublicKeyOfTheFakePrivateKeyXXXXXXXXXXXX",
    exec: async (target: Target, secret: string, op: Op) => {
      calls.push({ target, secret, op });
      return {
        exitCode: 0,
        output: op.type === "run" ? "Linux web 6.1.0 x86_64" : "ok",
        truncated: false,
      };
    },
  } as unknown as MachineRunner;
  let app: ReturnType<typeof createApp>;
  let botId: string;
  let otherBot: string;
  let otherConversation: string;
  let conversation: string;
  let workspace: string;
  let allow: string[] = [];
  const call = async (as: string, method: string, path: string, body?: unknown) => {
    const r = await app.handle(
      new Request(`http://localhost${path}`, {
        method,
        headers: {
          "x-test-user": as,
          origin: "http://web.test",
          "content-type": "application/json",
        },
        body: body ? JSON.stringify(body) : undefined,
      }),
    );
    return {
      status: r.status,
      text: await r.clone().text(),
      json: (await r.json().catch(() => ({}))) as any,
    };
  };
  const say = (content: string, reply: string[]) => {
    script = reply;
    calls.length = 0;
    prompts.length = 0;
    return call(A, "POST", `/api/conversations/${conversation}/messages`, { content });
  };
  const block = (json: object) => "```zetta:machine\n" + JSON.stringify(json) + "\n```";

  beforeAll(async () => {
    process.env.ZETTA_CODE_ROOT = await mkdtemp(join(tmpdir(), "zcode-"));
    workspace = codeDir(A);
    const store = await createConnectionStore(db, {
      configuration: { key: KEY, keyId: "v1" },
      allowedProviders: ["machine"],
      initializeEmpty: true,
    });
    const connections = createConnectionsService(db, store);
    const machines = createMachineService({ db, connections, runner });
    const chat = createChatService(
      db,
      createTurnRunner(db, cli as never, stream as never),
      undefined,
      undefined,
      undefined,
      connections,
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      { machines, botClaude: { profile: async () => ({ allow }) } as never },
    );
    app = createApp({
      auth: { handler: () => new Response("n/a"), api: { getSession: async () => null } } as never,
      chat: { access, chat },
      webOrigin: "http://web.test",
      desktopOrigins: [],
      drain: () => {},
    });
    const now = new Date();
    await db.insert(user).values(
      ids.map((id) => ({
        id,
        name: id,
        email: `${id}@t.test`,
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
    const a = await access.requireActive(new Headers({ "x-test-user": A }));
    const created = await call(A, "POST", "/api/bots", { name: "Operator", harness: "pi" });
    if (!created.json.bot)
      throw new Error(`bot was not created: ${created.status} ${created.text}`);
    botId = created.json.bot.id as string;
    await db.$client.query(
      "update bot set onboarded = true, computer_mode = 'browser' where id = $1",
      [botId],
    );
    conversation = (await call(A, "POST", "/api/conversations", { botId })).json.conversation
      .id as string;
    // A second bot of the same user, which the machine is NOT shared with.
    const other = await call(A, "POST", "/api/bots", { name: "Writer", harness: "pi" });
    if (!other.json.bot) throw new Error(`bot was not created: ${other.status} ${other.text}`);
    otherBot = other.json.bot.id as string;
    await db.$client.query(
      "update bot set onboarded = true, computer_mode = 'browser' where id = $1",
      [otherBot],
    );
    otherConversation = (await call(A, "POST", "/api/conversations", { botId: otherBot })).json
      .conversation.id as string;
    await machines.create(a, {
      name: "Web server",
      kind: "ssh",
      host: "93.184.216.34",
      port: 22,
      username: "deploy",
      hostKey: HOST_KEY,
      secret: PRIVATE_KEY,
      botIds: [botId],
    });
  });
  afterAll(async () => {
    await db.$client.query("delete from machine where owner_user_id = any($1)", [ids]);
    for (const t of ["connection_credential", "connection_mutation_receipt"])
      await db.$client.query(`delete from ${t} where owner_user_id = any($1)`, [ids]);
    await db.$client.query("delete from connection where owner_user_id = any($1)", [ids]);
    await cleanupTestUsers(db, ids); // connection_nonce is an append-only ledger checked against the key check: never delete from it
  });

  test("the bot is told the machine names but never the key, host key or password", async () => {
    await say("hello", ["hi"]);
    const prompt = prompts[0]!;
    expect(prompt).toContain("zetta:machine");
    expect(prompt).toContain("Web server (ssh, deploy@93.184.216.34)");
    expect(prompt).not.toContain("ZmFrZS1rZXktbWF0ZXJpYWw");
    expect(prompt).not.toContain(HOST_KEY);
  });

  test("a command runs with the stored key; the bot sees the output, and the key is nowhere in what it or the user sees", async () => {
    const r = await say("what OS is the web server?", [
      block({ action: "run", machine: "Web server", command: "uname -a" }),
      "It runs Linux.",
    ]);
    expect(calls).toHaveLength(1);
    expect(calls[0]!.secret).toBe(PRIVATE_KEY);
    expect(calls[0]!.op).toEqual({ type: "run", command: "uname -a" });
    expect(calls[0]!.target).toMatchObject({
      kind: "ssh",
      host: "93.184.216.34",
      username: "deploy",
      hostKey: HOST_KEY,
    });
    expect(
      prompts.some(
        (p) => p.includes("Web server: run exit 0") && p.includes("Linux web 6.1.0 x86_64"),
      ),
    ).toBe(true);
    for (const text of [...prompts, r.text]) expect(text).not.toContain("ZmFrZS1rZXktbWF0ZXJpYWw");
    const stored = await db.$client.query("select content from message where owner_user_id = $1", [
      A,
    ]);
    expect(JSON.stringify(stored.rows)).not.toContain("ZmFrZS1rZXktbWF0ZXJpYWw");
    const audit = await db.$client.query(
      "select detail, outcome from audit_event where owner_user_id = $1 and detail = 'machine:run'",
      [A],
    );
    expect(audit.rows).toEqual([{ detail: "machine:run", outcome: "ok" }]);
  });

  test("a delete or root command is refused until the bot has that exact rule", async () => {
    const r = await say("clean up", [
      block({ action: "run", machine: "Web server", command: "cd /srv && rm -rf cache" }),
      "Asked.",
    ]);
    expect(calls).toHaveLength(0);
    expect(prompts.some((p) => p.includes("refused") && p.includes("Bash(rm:*)"))).toBe(true);
    expect(r.text).toContain("needs your permission");

    allow = ["Bash(rm:*)"];
    await say("clean up, you may now", [
      block({ action: "run", machine: "Web server", command: "cd /srv && rm -rf cache" }),
      "Done.",
    ]);
    expect(calls).toHaveLength(1);
    // one rule lifts one command: sudo is still refused
    await say("restart", [
      block({ action: "run", machine: "Web server", command: "sudo systemctl restart app" }),
      "Asked.",
    ]);
    expect(calls).toHaveLength(0);
    allow = [];
  });

  test("files move only inside the user's workspace folder", async () => {
    await mkdir(workspace, { recursive: true });
    await writeFile(join(workspace, "deploy.tar"), "bundle");
    const root = await realpath(workspace);

    await say("upload", [
      block({
        action: "put",
        machine: "Web server",
        local: "deploy.tar",
        remote: "/srv/deploy.tar",
      }),
      "Sent.",
    ]);
    expect(calls[0]!.op).toEqual({
      type: "put",
      local: join(root, "deploy.tar"),
      remote: "/srv/deploy.tar",
    });

    await say("download", [
      block({
        action: "get",
        machine: "Web server",
        remote: "/var/log/app.log",
        local: "logs/app.log",
      }),
      "Got it.",
    ]);
    expect(calls[0]!.op).toEqual({
      type: "get",
      remote: "/var/log/app.log",
      local: join(root, "logs", "app.log"),
    });

    for (const local of [
      "../../etc/passwd",
      "/etc/passwd",
      ".ssh/id_ed25519",
      "deploy.tar/../../x",
    ]) {
      await say("escape", [
        block({ action: "get", machine: "Web server", remote: "/etc/shadow", local }),
        "no",
      ]);
      expect(calls).toHaveLength(0);
    }
    await say("upload a key", [
      block({ action: "put", machine: "Web server", local: "/etc/hosts", remote: "/tmp/h" }),
      "no",
    ]);
    expect(calls).toHaveLength(0);
  });

  test("an unknown machine, another user's machine and a bot without computer use get nothing", async () => {
    await say("x", [block({ action: "run", machine: "Nope", command: "id" }), "ok"]);
    expect(calls).toHaveLength(0);

    const theirs = (await call(B, "POST", "/api/bots", { name: "Other" })).json.bot as {
      id: string;
    };
    await db.$client.query(
      "update bot set onboarded = true, computer_mode = 'browser' where id = $1",
      [theirs.id],
    );
    const c2 = (await call(B, "POST", "/api/conversations", { botId: theirs.id })).json.conversation
      .id as string;
    script = [block({ action: "run", machine: "Web server", command: "id" }), "ok"];
    await call(B, "POST", `/api/conversations/${c2}/messages`, { content: "use A's machine" });
    expect(calls).toHaveLength(0);

    await db.$client.query("update bot set computer_mode = 'off' where id = $1", [botId]);
    const r = await say("off", [
      block({ action: "run", machine: "Web server", command: "id" }),
      "ok",
    ]);
    expect(calls).toHaveLength(0);
    expect(r.text).toContain("Machine access is off");
    expect(prompts[0]).not.toContain("zetta:machine");
    await db.$client.query("update bot set computer_mode = 'browser' where id = $1", [botId]);
  });

  test("a bot the machine is not shared with is not told about it, and is refused when it asks", async () => {
    script = ["hi"];
    prompts.length = 0;
    await call(A, "POST", `/api/conversations/${otherConversation}/messages`, { content: "hello" });
    expect(prompts[0]).not.toContain("Web server");
    expect(prompts[0]).not.toContain("zetta:machine");

    calls.length = 0;
    script = [block({ action: "run", machine: "Web server", command: "id" }), "ok"];
    prompts.length = 0;
    const r = await call(A, "POST", `/api/conversations/${otherConversation}/messages`, {
      content: "use it anyway",
    });
    expect(calls).toHaveLength(0);
    expect(r.text).toContain("is not shared with it");
    expect(prompts.some((p) => p.includes("No machine is shared with you yet"))).toBe(true);
  });
});
