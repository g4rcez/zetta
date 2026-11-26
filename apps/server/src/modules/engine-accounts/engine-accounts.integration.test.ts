import { uuidv7 } from "@zetta/core/uuid";
import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { existsSync } from "node:fs";
import { createDb } from "@zetta/db";
import { asc, eq, inArray } from "@zetta/db/query";
import { user } from "@zetta/db/schema/auth";
import { bot } from "@zetta/db/schema/chat";
import { botEngine, engineAccount } from "@zetta/db/schema/engine-accounts";
import { membership } from "@zetta/db/schema/identity";
import { chiefShare, workspace, workspaceMember } from "@zetta/db/schema/workspaces";
import { createApp } from "../../app";
import { cleanupTestUsers } from "../../test-support/db-cleanup";
import { sealedFor } from "../../test-support/sealed";
import { HarnessError } from "../chat/harness";
import { createTurnRunner } from "../chat/pipeline";
import { createChatService } from "../chat/service";
import { auditEvent } from "@zetta/db/schema/features";
import { createConnectionsService } from "../connections/service";
import { createConnectionStore } from "../connections/store";
import { transportKeyring } from "../connections/transport";
import {
  AccessError,
  type ActiveActor,
  createIdentityAccess,
  issueBackgroundActor,
} from "../identity/access";
import { accountFolder } from "./adapters";
import { createEngineAccounts, type EngineAccounts } from "./service";
import { createSignIns } from "./sign-in";

const url = process.env.ZETTA_CHAT_TEST_DATABASE_URL;
const suite = url ? describe : describe.skip;
const tag = uuidv7().slice(-8);
const id = (name: string) => `ea-${name}-${tag}`;
const ANA = id("ana");
const BO = id("bo");
const CY = id("cy");
const ALL = [ANA, BO, CY];
// The same key the other suites use on this database: a second key would fail its key check.
const KEY = Buffer.alloc(32, 7).toString("base64");
const TOKEN = `sk-ant-oat01-${"a1B2c3D4".repeat(6)}`;

/** A stand-in for a CLI's sign-in command: it prints what the test tells it to, takes what is typed, and ends when told. */
function scripted() {
  const started: { argv: string[]; env: Record<string, string>; terminal: boolean }[] = [];
  const typed: string[] = [];
  let current:
    | { say: (text: string) => void; end: (code: number) => void; killed: boolean }
    | undefined;
  /** What the status command of a CLI answers. */
  let status = { text: "Logged in using ChatGPT", exit: 0 };
  const spawn = (
    argv: string[],
    options: { env: Record<string, string>; terminal: boolean; onText: (text: string) => void },
  ) => {
    started.push({ argv, env: options.env, terminal: options.terminal });
    let end!: (code: number) => void;
    const exited = new Promise<number>((resolve) => (end = resolve));
    // A status check answers at once; a sign-in waits for the test.
    if (argv.includes("status") || argv.includes("--list")) {
      options.onText(status.text);
      end(status.exit);
      return { write: () => {}, kill: () => {}, exited };
    }
    const mine = { say: options.onText, end, killed: false };
    current = mine;
    return {
      write: (text: string) => void typed.push(text),
      kill: () => {
        mine.killed = true;
        end(143);
      },
      exited,
    };
  };
  return {
    spawn,
    started,
    typed,
    say: (text: string) => current!.say(text),
    end: (code: number) => current!.end(code),
    killed: () => current?.killed ?? false,
    answer: (text: string, exit = 0) => void (status = { text, exit }),
  };
}
const tick = () => new Promise((r) => setTimeout(r, 30));

suite("agent accounts against postgres", () => {
  const db = createDb({ DATABASE_URL: url ?? "postgresql://unused@localhost/unused" } as never);
  let serverLogin: "allowed" | "off" = "allowed";
  let accounts: EngineAccounts;
  let connections: ReturnType<typeof createConnectionsService>;
  let workspaceId = "";
  let teamBot = "";
  let roomBot = "";
  let chiefBot = "";
  /**
   * A person as the server sees them: a member, or an administrator of the test's workspace. Issued the way the server issues an actor,
   * because the sealed store takes no other.
   */
  const issued = new Map<string, ActiveActor>();
  const actor = (userId: string, admin = false): ActiveActor => issued.get(`${userId}:${admin}`)!;
  const active = new Set(ALL);
  const paste = (who: string, engine: string, method: string, secret: string, more: object = {}) =>
    accounts.createFromSecret(actor(who), { engine, method, secret, ...more });
  const run = (
    userId: string,
    harness: string,
    more: { payerUserId?: string; botId?: string } = {},
  ) =>
    accounts.forRun({
      harness: harness as never,
      userId,
      payerUserId: undefined,
      botId: undefined,
      ...more,
    });
  const refused = (work: Promise<unknown>) =>
    work.then(
      () => "ran",
      (e) => (e instanceof HarnessError ? e.code : `other: ${String(e)}`),
    );
  const botRow = async (botId: string) =>
    (await db.select().from(bot).where(eq(bot.id, botId)))[0]!;

  beforeAll(async () => {
    const now = new Date();
    await db.insert(user).values(
      ALL.map((userId) => ({
        id: userId,
        name: userId,
        email: `${userId}@example.invalid`,
        emailVerified: true,
        createdAt: now,
        updatedAt: now,
      })),
    );
    await db
      .insert(membership)
      .values(
        ALL.map((userId) => ({ userId, status: "active" as const, joinedAt: now, updatedAt: now })),
      );
    // The first workspace, where work with no workspace of its own runs: these people work there like everyone in a test.
    const [ws] = await db
      .select({ id: workspace.id })
      .from(workspace)
      .orderBy(asc(workspace.createdAt), asc(workspace.id))
      .limit(1);
    workspaceId = ws!.id;
    await db.insert(workspaceMember).values(
      [ANA, BO].map((userId) => ({
        workspaceId,
        userId,
        role: userId === ANA ? ("owner" as const) : ("member" as const),
        status: "active" as const,
      })),
    );
    const make = async (name: string, more: object = {}) =>
      (
        await db
          .insert(bot)
          .values({
            ownerUserId: ANA,
            kind: "specialist",
            visibility: "team",
            name,
            slug: `${name}-${tag}`,
            harness: "claude-code",
            ...more,
          })
          .returning({ id: bot.id })
      )[0]!.id;
    teamBot = await make("ea-team");
    roomBot = await make("ea-room", { sharedAccount: "owner_in_rooms" });
    chiefBot = await make("ea-chief", { visibility: "private" });
    for (const userId of ALL)
      for (const admin of [false, true])
        issued.set(
          `${userId}:${admin}`,
          (await issueBackgroundActor(
            async () => ({
              isAdmin: admin,
              isRoot: false,
              role: admin ? "admin" : "member",
              workspaceId,
            }),
            userId,
          ))!,
        );
    const store = await createConnectionStore(db, {
      configuration: { key: KEY, keyId: "v1" },
      allowedProviders: ["engine"],
      initializeEmpty: true,
    });
    connections = createConnectionsService(db, store);
    accounts = createEngineAccounts(db, {
      connections,
      serverLogin: async () => serverLogin,
      actorFor: async (userId) => (active.has(userId) ? actor(userId) : null),
    });
  });

  afterAll(async () => {
    await db.delete(chiefShare).where(inArray(chiefShare.userId, ALL));
    await db.delete(botEngine).where(inArray(botEngine.userId, ALL));
    await db.delete(engineAccount).where(inArray(engineAccount.ownerUserId, ALL));
    // The sealed secrets and their keys go before the people they belong to.
    for (const userId of ALL) await connections.purgeOwner(userId);
    await cleanupTestUsers(db, ALL);
    await db.$client.end();
  });

  test("a pasted token becomes the person's account, sealed, and their runs use it", async () => {
    const mine = await paste(ANA, "claude-code", "token", TOKEN);
    expect(mine).toMatchObject({
      engine: "claude-code",
      kind: "token",
      use: "default",
      state: "active",
    });
    // Nothing a person or an administrator reads holds the secret.
    expect(JSON.stringify(await accounts.list(actor(ANA)))).not.toContain(TOKEN);
    const [row] = await db.select().from(engineAccount).where(eq(engineAccount.id, mine.id));
    expect(JSON.stringify(row)).not.toContain(TOKEN);
    expect(await run(ANA, "claude-code")).toEqual({
      accountId: mine.id,
      ownerUserId: ANA,
      env: { CLAUDE_CODE_OAUTH_TOKEN: TOKEN },
    });
  });

  test("a refused token is not marked by a run, and one marked signed out goes back to work when its person tries it again", async () => {
    const cli = scripted();
    const signIns = createSignIns({
      accounts,
      resolve: (name) => `/bin/${name}`,
      spawn: cli.spawn as never,
    });
    const mine = (await accounts.list(actor(ANA))).accounts.find((a) => a.kind === "token")!;
    // The words of a sign-in error turn up in other failures too, and a token has no CLI to ask: it is left as it is.
    await signIns.recheck(mine.id);
    expect(cli.started).toHaveLength(0);
    expect((await run(ANA, "claude-code"))?.accountId).toBe(mine.id);
    await accounts.markChecked(mine.id, false);
    expect(await refused(run(ANA, "claude-code"))).toBe("auth_required");
    expect(await accounts.retry(actor(ANA), mine.id)).toMatchObject({ state: "active" });
    expect((await run(ANA, "claude-code"))?.accountId).toBe(mine.id);
    // Only its own person tries it again.
    await expect(accounts.retry(actor(BO), mine.id)).rejects.toThrow("That account is not yours.");
  });

  test("a person with no account runs on the server's own sign-in only while the setting allows it", async () => {
    expect(await run(BO, "claude-code")).toBeUndefined();
    serverLogin = "off";
    expect(await refused(run(BO, "claude-code"))).toBe("auth_required");
    // The person who has an account is not affected, and an engine that takes no account is not asked.
    expect((await run(ANA, "claude-code"))?.ownerUserId).toBe(ANA);
    expect(await run(BO, "fixture")).toBeUndefined();
    serverLogin = "allowed";
  });

  test("what is pasted must be something this engine takes", async () => {
    for (const bad of [
      () => paste(BO, "nothing", "token", TOKEN),
      () => paste(BO, "codex", "token", TOKEN),
      () => paste(BO, "pi", "subscription", TOKEN),
      () => paste(BO, "codex", "api_key", "sk-openai-1234", { provider: "anthropic" }),
      () => paste(BO, "codex", "api_key", "sk-openai-1234"),
      () => paste(BO, "claude-code", "token", "two words"),
      () => paste(BO, "claude-code", "token", "short"),
    ])
      await expect(bad()).rejects.toMatchObject({ code: "INVALID" });
    expect((await accounts.list(actor(BO))).accounts).toEqual([]);
  });

  test("a key is an account too: it travels in its provider's variable, and Codex is kept away from the server's own sign-in", async () => {
    const key = await paste(BO, "codex", "api_key", "sk-openai-bo-key", { provider: "openai" });
    expect(key).toMatchObject({ kind: "api_key", provider: "openai", label: "OpenAI key" });
    const used = await run(BO, "codex");
    expect(used?.env).toEqual({
      OPENAI_API_KEY: "sk-openai-bo-key",
      CODEX_API_KEY: "sk-openai-bo-key",
    });
    expect(used?.folder).toEqual({ path: accountFolder(key.id), variable: "CODEX_HOME" });
  });

  test("an administrator's account for the workspace runs whoever has none of their own, and stays nobody's own", async () => {
    const forWorkspace = await accounts.createFromSecret(actor(ANA, true), {
      engine: "pi",
      method: "api_key",
      provider: "anthropic",
      secret: "sk-ant-api-workspace-key",
      for: "workspace",
    });
    expect(forWorkspace).toMatchObject({ use: "workspace", engine: "pi" });
    // CY has no account for Pi: the workspace's runs CY, opened as the administrator who connected it.
    expect(await run(CY, "pi")).toMatchObject({
      accountId: forWorkspace.id,
      ownerUserId: ANA,
      env: { ANTHROPIC_API_KEY: "sk-ant-api-workspace-key" },
    });
    // Everyone sees that the workspace covers Pi; nobody lists it as their own, the administrator included.
    for (const who of [CY, ANA]) {
      const listed = await accounts.list(actor(who));
      expect(listed.workspace.map((a) => a.id)).toEqual([forWorkspace.id]);
      expect(listed.accounts.some((a) => a.id === forWorkspace.id)).toBe(false);
    }
    expect((await accounts.list(actor(CY))).mayConnectForWorkspace).toBe(false);
    // A person's own account comes first.
    const own = await paste(CY, "pi", "api_key", "sk-ant-api-cy-own", { provider: "anthropic" });
    expect((await run(CY, "pi"))?.accountId).toBe(own.id);
    await accounts.remove(actor(CY), own.id);
    // Only an administrator connects one, one per engine, and only an administrator disconnects it.
    await expect(
      accounts.createFromSecret(actor(CY), {
        engine: "pi",
        method: "api_key",
        provider: "anthropic",
        secret: "sk-ant-api-not-allowed",
        for: "workspace",
      }),
    ).rejects.toBeInstanceOf(AccessError);
    await expect(
      accounts.createFromSecret(actor(BO, true), {
        engine: "pi",
        method: "api_key",
        provider: "anthropic",
        secret: "sk-ant-api-second-one",
        for: "workspace",
      }),
    ).rejects.toThrow("already has an account for this engine");
    await expect(accounts.removeForWorkspace(actor(CY), forWorkspace.id)).rejects.toBeInstanceOf(
      AccessError,
    );
    await accounts.removeForWorkspace(actor(BO, true), forWorkspace.id);
    expect(await run(CY, "pi")).toBeUndefined();
  });

  test("a server for many organizations never runs anyone on its own sign-in", async () => {
    const before = process.env.ZETTA_MODE;
    process.env.ZETTA_MODE = "app";
    try {
      expect(await refused(run(CY, "codex"))).toBe("auth_required");
      expect((await accounts.list(actor(CY))).serverLogin).toBe("off");
    } finally {
      if (before === undefined) delete process.env.ZETTA_MODE;
      else process.env.ZETTA_MODE = before;
    }
  });

  test("the first account of an engine is the default; another can take over, and a removed default hands on", async () => {
    const second = await paste(ANA, "claude-code", "api_key", "sk-ant-api-ana", {
      provider: "anthropic",
      label: "  Work key  ",
    });
    expect(second).toMatchObject({ use: "extra", label: "Work key" });
    expect((await run(ANA, "claude-code"))?.env).toEqual({ CLAUDE_CODE_OAUTH_TOKEN: TOKEN });
    await accounts.setDefault(actor(ANA), second.id);
    expect((await run(ANA, "claude-code"))?.env).toEqual({ ANTHROPIC_API_KEY: "sk-ant-api-ana" });
    const uses = async () =>
      (await accounts.list(actor(ANA))).accounts
        .filter((a) => a.engine === "claude-code")
        .map((a) => a.use)
        .sort();
    expect(await uses()).toEqual(["default", "extra"]);
    // Disconnecting it revokes its secret, and the other account is the default again.
    const sealed = (
      await db.select().from(engineAccount).where(eq(engineAccount.id, second.id))
    )[0]!.connectionId!;
    await accounts.remove(actor(ANA), second.id);
    expect(await uses()).toEqual(["default"]);
    expect((await run(ANA, "claude-code"))?.env).toEqual({ CLAUDE_CODE_OAUTH_TOKEN: TOKEN });
    expect((await connections.list(actor(ANA))).find((c) => c.id === sealed)?.state).toBe(
      "revoked",
    );
  });

  test("an account is its owner's alone: nobody else names it, uses it, chooses it or removes it", async () => {
    const [mine] = (await accounts.list(actor(ANA))).accounts;
    for (const work of [
      () => accounts.setDefault(actor(BO), mine!.id),
      () => accounts.rename(actor(BO), mine!.id, "Mine now"),
      () => accounts.remove(actor(BO), mine!.id),
    ])
      await expect(work()).rejects.toMatchObject({ code: "NOT_FOUND" });
    await expect(
      accounts.setChoice(actor(BO), await botRow(teamBot), { accountId: mine!.id }),
    ).rejects.toMatchObject({ code: "NOT_FOUND" });
    expect((await accounts.list(actor(BO))).accounts.some((a) => a.id === mine!.id)).toBe(false);
  });

  test("a person runs someone's bot on the engine, model and account they chose for it; its owner is not affected", async () => {
    const team = await botRow(teamBot);
    // Nothing chosen: the bot's own engine, on the person's own account for it (Bo has none for Claude Code).
    expect(await accounts.forTurn({ bot: team, userId: BO })).toMatchObject({
      bot: { harness: "claude-code" },
      payerUserId: BO,
    });
    const boCodex = (await accounts.list(actor(BO))).accounts.find((a) => a.engine === "codex")!;
    await expect(
      accounts.setChoice(actor(BO), team, { harness: "codex", model: "no-such-model" }),
    ).rejects.toMatchObject({ code: "INVALID" });
    const anaClaude = (await accounts.list(actor(ANA))).accounts[0]!;
    await expect(
      accounts.setChoice(actor(ANA), team, { accountId: boCodex.id }),
    ).rejects.toMatchObject({ code: "NOT_FOUND" });
    expect(
      await accounts.setChoice(actor(BO), team, {
        harness: "codex",
        model: "gpt-5",
        accountId: boCodex.id,
      }),
    ).toMatchObject({ harness: "codex", model: "gpt-5", accountId: boCodex.id, owner: false });
    const forBo = await accounts.forTurn({ bot: team, userId: BO });
    expect(forBo).toMatchObject({ bot: { harness: "codex", model: "gpt-5" }, payerUserId: BO });
    expect((await run(BO, "codex", { payerUserId: BO, botId: teamBot }))?.accountId).toBe(
      boCodex.id,
    );
    // The owner runs the bot's own engine, and may only choose which of their accounts.
    expect(await accounts.forTurn({ bot: team, userId: ANA })).toMatchObject({
      bot: { harness: "claude-code" },
      payerUserId: ANA,
    });
    expect(
      await accounts.setChoice(actor(ANA), team, { harness: "codex", accountId: anaClaude.id }),
    ).toMatchObject({ harness: null, accountId: anaClaude.id, owner: true });
    // An account of another engine cannot be chosen for the engine in use.
    await expect(
      accounts.setChoice(actor(BO), team, { harness: null, accountId: boCodex.id }),
    ).rejects.toMatchObject({ code: "INVALID" });
  });

  test("in a room, a bot set to run on its owner's account does, for everyone; in a chat of their own it is the person's", async () => {
    const room = await botRow(roomBot);
    expect(await accounts.forTurn({ bot: room, userId: BO, room: true })).toMatchObject({
      bot: { harness: "claude-code" },
      payerUserId: ANA,
    });
    const paid = await run(BO, "claude-code", { payerUserId: ANA, botId: roomBot });
    expect(paid).toMatchObject({ ownerUserId: ANA, env: { CLAUDE_CODE_OAUTH_TOKEN: TOKEN } });
    expect((await accounts.forTurn({ bot: room, userId: BO })).payerUserId).toBe(BO);
    // A bot that is not set so stays the asker's, in a room too.
    expect(
      (await accounts.forTurn({ bot: await botRow(teamBot), userId: CY, room: true })).payerUserId,
    ).toBe(CY);
    // Only its owner turns that on.
    await expect(accounts.setShared(actor(BO), room, "asker")).rejects.toBeInstanceOf(AccessError);
    expect(await accounts.setShared(actor(ANA), room, "owner_in_rooms")).toMatchObject({
      sharedAccount: "owner_in_rooms",
    });
    await expect(accounts.setShared(actor(ANA), room, "everyone")).rejects.toMatchObject({
      code: "INVALID",
    });
  });

  test("a Chief that was shared runs on its owner's account in every chat, also for work no chat started", async () => {
    await db.insert(chiefShare).values({ userId: CY, botId: chiefBot, grantedByUserId: ANA });
    const chief = await botRow(chiefBot);
    expect((await accounts.forTurn({ bot: chief, userId: CY })).payerUserId).toBe(ANA);
    // A background job names the bot and not who pays: the same answer.
    expect(await run(CY, "claude-code", { botId: chiefBot })).toMatchObject({ ownerUserId: ANA });
    // The same bot for someone it was not shared with is the asker's to pay.
    expect((await accounts.forTurn({ bot: chief, userId: BO })).payerUserId).toBe(BO);
    // With the server's sign-in off, a person with no account still talks to their shared Chief.
    serverLogin = "off";
    expect((await run(CY, "claude-code", { botId: chiefBot }))?.ownerUserId).toBe(ANA);
    expect(await refused(run(CY, "claude-code", { botId: teamBot }))).toBe("auth_required");
    serverLogin = "allowed";
  });

  test("when the owner is gone from the server, nothing runs on their account, and no other one is tried", async () => {
    active.delete(ANA);
    expect(await refused(run(CY, "claude-code", { payerUserId: ANA, botId: chiefBot }))).toBe(
      "auth_required",
    );
    active.add(ANA);
  });

  test("an administrator sees which engines each person of the workspace has an account for, and can disconnect one", async () => {
    const seen = await accounts.overview(actor(ANA, true));
    const mine = seen.accounts.filter((a) => ALL.includes(a.userId));
    expect(mine.map((a) => [a.userId, a.engine, a.kind]).sort()).toEqual(
      [
        [ANA, "claude-code", "token"],
        [BO, "codex", "api_key"],
      ].sort(),
    );
    // Not what the account is called, whose key it is, or anything of the secret.
    expect(Object.keys(mine[0]!).sort()).toEqual([
      "engine",
      "id",
      "kind",
      "state",
      "use",
      "userId",
    ]);
    await expect(accounts.overview(actor(BO))).rejects.toBeInstanceOf(AccessError);
    // Cy is not in this workspace: an administrator here does not reach their accounts.
    const cys = await paste(CY, "deepseek", "api_key", "sk-deepseek-cy", { provider: "deepseek" });
    await expect(accounts.remove(actor(ANA, true), cys.id, CY)).rejects.toMatchObject({
      code: "NOT_FOUND",
    });
    await expect(accounts.remove(actor(BO), cys.id, CY)).rejects.toBeInstanceOf(AccessError);
    const bos = (await accounts.list(actor(BO))).accounts[0]!;
    expect(await accounts.remove(actor(ANA, true), bos.id, BO)).toEqual({ id: bos.id });
    expect((await accounts.list(actor(BO))).accounts).toEqual([]);
    // The choice that named it follows the default again.
    expect(await accounts.choice(actor(BO), await botRow(teamBot))).toMatchObject({
      accountId: null,
    });
  });

  test("a real turn runs the engine the person chose, tells the runner who pays, and the trail keeps the account and the payer", async () => {
    type Seen = { harness: string; model: string | null; userId?: string; payerUserId?: string };
    const seen: Seen[] = [];
    const stream = async function* (run: Seen & { onAccount?: (used: object) => void }) {
      seen.push({
        harness: run.harness,
        model: run.model,
        ...(run.userId ? { userId: run.userId } : {}),
        ...(run.payerUserId ? { payerUserId: run.payerUserId } : {}),
      });
      // What the real runner reports once it has asked for the account (chat/harness.ts).
      const used = await accounts.forRun({
        harness: run.harness as never,
        userId: run.userId,
        payerUserId: run.payerUserId,
        botId: undefined,
      });
      run.onAccount?.({
        harness: run.harness,
        ...(used ? { accountId: used.accountId, ownerUserId: used.ownerUserId } : {}),
      });
      yield "ok";
    };
    const chat = createChatService(
      db,
      createTurnRunner(
        db,
        (async () => "unused") as never,
        stream as never,
        undefined,
        undefined,
        undefined,
        undefined,
        accounts,
      ),
    );
    const say = async (who: string, botId: string) => {
      const conversation = await chat.createConversation(actor(who), botId);
      const { follow } = await chat.startTurn(actor(who), conversation!.id, { content: "hello" });
      for await (const _ of follow()) void _;
      const [row] = await db
        .select()
        .from(auditEvent)
        .where(eq(auditEvent.ownerUserId, who))
        .orderBy(auditEvent.createdAt);
      const rows = await db.select().from(auditEvent).where(eq(auditEvent.ownerUserId, who));
      void row;
      return rows.filter((r) => r.kind === "harness_run").at(-1)!;
    };
    // Bo chose Pi for Ana's team bot (see the test above removed his Pi account, so the choice now names none: the engine stays).
    await accounts.setChoice(actor(BO), await botRow(teamBot), { harness: "pi" });
    const bos = await say(BO, teamBot);
    expect(seen.at(-1)).toEqual({ harness: "pi", model: null, userId: BO, payerUserId: BO });
    expect(bos).toMatchObject({ detail: "pi", accountId: null, payerUserId: null });
    // Ana, the owner, runs the bot's own engine on her own account: the trail names the account, and no other payer.
    const anas = await say(ANA, teamBot);
    expect(seen.at(-1)).toMatchObject({ harness: "claude-code", userId: ANA, payerUserId: ANA });
    const anaAccount = (await accounts.list(actor(ANA))).accounts[0]!.id;
    expect(anas).toMatchObject({ detail: "claude-code", accountId: anaAccount, payerUserId: null });
  });

  describe("a guided sign-in", () => {
    const sign = (cli: ReturnType<typeof scripted>, limitMs?: number) =>
      createSignIns({
        accounts,
        resolve: (name) => `/bin/${name}`,
        spawn: cli.spawn as never,
        ...(limitMs ? { limitMs } : {}),
      });

    test("Claude Code: the link is shown, the pasted code is passed on, and the token becomes a sealed account", async () => {
      const cli = scripted();
      const signIns = sign(cli);
      const started = await signIns.start(actor(BO), "claude-code", "subscription");
      expect(started).toMatchObject({ state: "starting", url: null, input: "code" });
      // Only the CLI's own command, in a terminal, with a short environment and a folder of its own.
      expect(cli.started[0]!.argv).toEqual(["/bin/claude", "setup-token"]);
      expect(cli.started[0]!.terminal).toBe(true);
      expect(cli.started[0]!.env.CLAUDE_CONFIG_DIR).toContain("zetta-sign-in-");
      expect(Object.keys(cli.started[0]!.env).some((k) => /SECRET|DATABASE|ZETTA_/.test(k))).toBe(
        false,
      );
      cli.say(
        "\x1b[1mBrowser didn't open? Use the URL below\x1b[0m https://claude.ai/oauth/authorize?abc123 Paste code here if prompted",
      );
      expect(signIns.get(actor(BO), started.id)).toMatchObject({
        state: "waiting",
        url: "https://claude.ai/oauth/authorize?abc123",
      });
      // Someone else cannot read it or type into it.
      expect(() => signIns.get(actor(ANA), started.id)).toThrow("That sign-in is over");
      expect(() => signIns.input(actor(ANA), started.id, "x")).toThrow();
      signIns.input(actor(BO), started.id, "  the-code#state\r\nrm -rf /\x03 ");
      expect(cli.typed).toEqual(["the-code#staterm -rf /"]);
      cli.say(` Your OAuth token (valid for 1 year): ${TOKEN} Store this token securely.`);
      await tick();
      const done = signIns.get(actor(BO), started.id);
      expect(done).toMatchObject({ state: "done" });
      expect(JSON.stringify(done)).not.toContain(TOKEN);
      expect(cli.killed()).toBe(true);
      expect(existsSync(cli.started[0]!.env.CLAUDE_CONFIG_DIR!)).toBe(false);
      const mine = (await accounts.list(actor(BO))).accounts.find((a) => a.id === done.accountId);
      expect(mine).toMatchObject({
        engine: "claude-code",
        kind: "token",
        state: "active",
        use: "default",
      });
      expect((await run(BO, "claude-code"))?.env).toEqual({ CLAUDE_CODE_OAUTH_TOKEN: TOKEN });
    });

    test("Codex: a link and a code are shown, nothing is typed, and the CLI's own sign-in becomes the account", async () => {
      const cli = scripted();
      const signIns = sign(cli);
      const started = await signIns.start(actor(BO), "codex", "subscription");
      const env = cli.started[0]!.env;
      expect(cli.started[0]).toMatchObject({
        argv: ["/bin/codex", "login", "--device-auth"],
        terminal: false,
      });
      const pending = (
        await db.select().from(engineAccount).where(eq(engineAccount.ownerUserId, BO))
      ).find((a) => a.state === "pending")!;
      expect(env.CODEX_HOME).toBe(accountFolder(pending.id));
      // Not an account yet: no run uses it and the list does not show it.
      expect(await run(BO, "codex")).toBeUndefined();
      expect((await accounts.list(actor(BO))).accounts.some((a) => a.id === pending.id)).toBe(
        false,
      );
      cli.say(
        "1. Open this link\n   https://auth.openai.com/codex/device\n2. Enter this one-time code\n   AB12-CD345\n",
      );
      expect(signIns.get(actor(BO), started.id)).toMatchObject({
        state: "waiting",
        url: "https://auth.openai.com/codex/device",
        code: "AB12-CD345",
        input: "none",
      });
      expect(() => signIns.input(actor(BO), started.id, "AB12-CD345")).toThrow(
        "not waiting for a code",
      );
      cli.end(0);
      await tick();
      await tick();
      expect(signIns.get(actor(BO), started.id)).toMatchObject({
        state: "done",
        accountId: pending.id,
      });
      // The CLI itself was asked whether it is signed in, in the account's folder.
      expect(cli.started[1]).toMatchObject({ argv: ["/bin/codex", "login", "status"] });
      expect(cli.started[1]!.env.CODEX_HOME).toBe(accountFolder(pending.id));
      const used = await run(BO, "codex");
      expect(used).toEqual({
        accountId: pending.id,
        ownerUserId: BO,
        env: {},
        folder: { path: accountFolder(pending.id), variable: "CODEX_HOME" },
      });
      const state = async () =>
        (await accounts.list(actor(BO))).accounts.find((a) => a.id === pending.id)?.state;
      // A run says it is refused, which on its own proves nothing: the CLI is asked, and while its sign-in holds nothing changes.
      const asked = cli.started.length;
      await signIns.recheck(pending.id);
      expect(cli.started.slice(asked).map((s) => s.argv.join(" "))).toEqual([
        "/bin/codex login status",
      ]);
      expect(await state()).toBe("active");
      // Later the CLI says the sign-in is gone: the account is marked, and the person is told to sign in again. Their runs do not
      // quietly move to the server's own sign-in, which is someone else's subscription.
      cli.answer("Not logged in");
      await signIns.recheck(pending.id);
      expect(await state()).toBe("signed_out");
      expect(await refused(run(BO, "codex"))).toBe("auth_required");
      // A marked account is not asked again on every refused run.
      const after = cli.started.length;
      await signIns.recheck(pending.id);
      expect(cli.started.length).toBe(after);
      // Signed in again: checking puts it back to work.
      cli.answer("Logged in using ChatGPT");
      expect(await signIns.check({ id: pending.id, engine: "codex", provider: null })).toBe(true);
      expect(await state()).toBe("active");
      expect((await run(BO, "codex"))?.accountId).toBe(pending.id);
      await accounts.remove(actor(BO), pending.id);
      expect(existsSync(accountFolder(pending.id))).toBe(false);
    });

    test("a sign-in that is cancelled, fails or takes too long leaves no account and no folder", async () => {
      const count = async () =>
        (await db.select().from(engineAccount).where(eq(engineAccount.ownerUserId, CY))).length;
      const before = await count();
      // Cancelled by the person.
      let cli = scripted();
      let signIns = sign(cli);
      let started = await signIns.start(actor(CY), "codex", "subscription");
      const folder = cli.started[0]!.env.CODEX_HOME!;
      expect(existsSync(folder)).toBe(true);
      signIns.cancel(actor(CY), started.id);
      await tick();
      expect(signIns.get(actor(CY), started.id).state).toBe("cancelled");
      expect(cli.killed()).toBe(true);
      expect(existsSync(folder)).toBe(false);
      // The CLI ended and says it is not signed in.
      cli = scripted();
      cli.answer("Not logged in");
      signIns = sign(cli);
      started = await signIns.start(actor(CY), "codex", "subscription");
      cli.end(0);
      await tick();
      await tick();
      expect(signIns.get(actor(CY), started.id)).toMatchObject({ state: "failed" });
      // Claude Code's command ended with no token.
      cli = scripted();
      signIns = sign(cli);
      started = await signIns.start(actor(CY), "claude-code", "subscription");
      cli.end(1);
      await tick();
      expect(signIns.get(actor(CY), started.id).state).toBe("failed");
      // Nobody finished it in time.
      cli = scripted();
      signIns = sign(cli, 20);
      started = await signIns.start(actor(CY), "codex", "subscription");
      await new Promise((r) => setTimeout(r, 80));
      expect(signIns.get(actor(CY), started.id)).toMatchObject({ state: "failed" });
      expect(cli.killed()).toBe(true);
      expect(await count()).toBe(before);
    });

    test("where bot runs happen in containers, the sign-in runs in that image with only the account's folder of the server", async () => {
      const cli = scripted();
      const signIns = createSignIns({
        accounts,
        // Nothing is installed on the server itself.
        resolve: () => null,
        spawn: cli.spawn as never,
        container: () =>
          ({
            bin: "/usr/bin/podman",
            image: "zetta-harness:test",
            network: "bridge",
            memory: "1g",
            cpus: "1",
            pids: 128,
            engine: "podman",
          }) as never,
      });
      const started = await signIns.start(actor(CY), "codex", "subscription");
      const pending = (
        await db.select().from(engineAccount).where(eq(engineAccount.ownerUserId, CY))
      ).find((a) => a.state === "pending")!;
      const { argv, env } = cli.started[0]!;
      const line = argv.join(" ");
      expect(argv.slice(0, 4)).toEqual(["/usr/bin/podman", "run", "--rm", "-i"]);
      expect(line).toContain(`-v ${accountFolder(pending.id)}:/zetta-account:rw`);
      expect(line).toContain("-e CODEX_HOME=/zetta-account");
      expect(line).toEndWith("zetta-harness:test codex login --device-auth");
      // Thrown away, with no privilege and nothing else of the server mounted.
      expect(line).toContain("--cap-drop=ALL");
      expect(argv.filter((word) => word === "-v")).toHaveLength(1);
      // The container client gets what it needs to reach its engine, and none of the sign-in's own variables.
      expect(Object.keys(env).sort()).toEqual(
        ["DOCKER_HOST", "HOME", "PATH"].filter((name) => name in env).sort(),
      );
      signIns.cancel(actor(CY), started.id);
      await tick();
      // Claude Code draws a screen: its container gets a terminal.
      const claude = await signIns.start(actor(CY), "claude-code", "subscription");
      expect(cli.started.at(-1)!.argv.slice(0, 5)).toEqual([
        "/usr/bin/podman",
        "run",
        "--rm",
        "-i",
        "-t",
      ]);
      expect(cli.started.at(-1)!.argv.join(" ")).toContain("-e CLAUDE_CONFIG_DIR=/zetta-account");
      signIns.cancel(actor(CY), claude.id);
      await tick();
    });

    test("only a way the engine offers starts, and only when the engine is on the server", async () => {
      const cli = scripted();
      await expect(sign(cli).start(actor(CY), "pi", "api_key")).rejects.toMatchObject({
        code: "INVALID",
      });
      await expect(sign(cli).start(actor(CY), "codex", "nothing")).rejects.toMatchObject({
        code: "INVALID",
      });
      const missing = createSignIns({ accounts, resolve: () => null, spawn: cli.spawn as never });
      await expect(missing.start(actor(CY), "codex", "subscription")).rejects.toMatchObject({
        code: "UNAVAILABLE",
      });
      expect(cli.started).toEqual([]);
    });
  });

  describe("over HTTP", () => {
    const WEB = "http://web.test";
    const cli = scripted();
    const access = createIdentityAccess(
      {
        api: {
          async getSession({ headers }) {
            const userId = headers.get("x-test-user");
            return userId ? { user: { id: userId } } : null;
          },
        },
      },
      async (userId) =>
        ALL.includes(userId) ? { isAdmin: userId === ANA, isRoot: false, workspaceId } : null,
    );
    // One app for the whole block: a sign-in lives in the memory of the service that started it.
    let built: ReturnType<typeof createApp> | undefined;
    const app = () =>
      (built ??= createApp({
        auth: {
          handler: () => new Response("n/a"),
          api: { getSession: async () => null },
        } as never,
        engineAccounts: {
          access,
          accounts,
          signIns: createSignIns({
            accounts,
            resolve: (n) => `/bin/${n}`,
            spawn: cli.spawn as never,
          }),
          keyring: transportKeyring,
          botFor: async (who, botId) => {
            const b = await botRow(botId);
            if (!b || (b.ownerUserId !== who.userId && b.visibility !== "team"))
              throw new AccessError("NOT_FOUND");
            return b;
          },
        },
        webOrigin: WEB,
        desktopOrigins: [],
      }));
    const call = async (
      who: string,
      method: string,
      path: string,
      body?: unknown,
      origin = WEB,
    ) => {
      const response = await app().handle(
        new Request(`http://api.test${path}`, {
          method,
          headers: {
            "x-test-user": who,
            ...(origin ? { origin } : {}),
            ...(body === undefined ? {} : { "content-type": "application/json" }),
          },
          ...(body === undefined ? {} : { body: JSON.stringify(body) }),
        }),
      );
      const text = await response.text();
      return { status: response.status, text, json: JSON.parse(text || "{}") as any };
    };

    test("a secret arrives sealed for this person and this engine, and never comes back", async () => {
      const secret = "sk-deepseek-http-key";
      const sealed = await sealedFor(CY, "engine-account.create:hermes", { secret });
      const base = { engine: "hermes", method: "api_key", provider: "deepseek" };
      // In the open, sealed for another engine, or sealed for another person: refused.
      expect((await call(CY, "POST", "/api/engine-accounts/", { ...base, secret })).status).toBe(
        400,
      );
      expect(
        (await call(CY, "POST", "/api/engine-accounts/", { ...base, engine: "pi", sealed })).status,
      ).toBe(400);
      expect((await call(BO, "POST", "/api/engine-accounts/", { ...base, sealed })).status).toBe(
        400,
      );
      expect(
        (await call(CY, "POST", "/api/engine-accounts/", { ...base, sealed }, "http://evil.test"))
          .status,
      ).toBe(403);
      const made = await call(CY, "POST", "/api/engine-accounts/", { ...base, sealed });
      expect(made.status).toBe(201);
      expect(made.json.account).toMatchObject({
        engine: "hermes",
        kind: "api_key",
        provider: "deepseek",
      });
      const listed = await call(CY, "GET", "/api/engine-accounts/");
      expect(listed.status).toBe(200);
      expect(listed.json.accounts.some((a: { id: string }) => a.id === made.json.account.id)).toBe(
        true,
      );
      expect(listed.json.methods["claude-code"][0]).toMatchObject({ way: "guided" });
      expect(made.text + listed.text).not.toContain(secret);
      expect((await run(CY, "hermes"))?.env).toEqual({ DEEPSEEK_API_KEY: secret });
      expect(
        (await call(BO, "DELETE", `/api/engine-accounts/${made.json.account.id}`)).status,
      ).toBe(404);
      expect(
        (await call(CY, "DELETE", `/api/engine-accounts/${made.json.account.id}`)).status,
      ).toBe(200);
    });

    test("a sign-in is started, read and cancelled by its own person", async () => {
      const started = await call(CY, "POST", "/api/engine-accounts/sign-in", {
        engine: "codex",
        method: "subscription",
      });
      expect(started.status).toBe(201);
      const path = `/api/engine-accounts/sign-in/${started.json.signIn.id}`;
      cli.say("https://auth.openai.com/codex/device code ZZ99-YY888");
      expect((await call(CY, "GET", path)).json.signIn).toMatchObject({
        state: "waiting",
        code: "ZZ99-YY888",
      });
      expect((await call(BO, "GET", path)).status).toBe(404);
      expect((await call(BO, "DELETE", path)).status).toBe(404);
      expect((await call(CY, "POST", `${path}/input`, { text: "ZZ99-YY888" })).status).toBe(400);
      expect((await call(CY, "DELETE", path)).status).toBe(200);
      await tick();
      expect((await call(CY, "GET", path)).json.signIn.state).toBe("cancelled");
    });

    test("the engine and account for a bot, and who pays in a room, over HTTP", async () => {
      const mine = await paste(BO, "pi", "api_key", "sk-openrouter-bo", { provider: "openrouter" });
      const path = `/api/engine-accounts/bots/${teamBot}`;
      const saved = await call(BO, "PUT", path, { harness: "pi", accountId: mine.id });
      expect(saved.status).toBe(200);
      expect(saved.json.choice).toMatchObject({ harness: "pi", accountId: mine.id, owner: false });
      expect((await call(BO, "GET", path)).json.choice.default).toMatchObject({
        harness: "claude-code",
      });
      expect((await call(BO, "PUT", path, { harness: "everything" })).status).toBe(400);
      // A private bot of someone else is not there to choose for.
      expect((await call(BO, "GET", `/api/engine-accounts/bots/${chiefBot}`)).status).toBe(404);
      expect(
        (await call(BO, "PUT", `${path}/shared`, { sharedAccount: "owner_in_rooms" })).status,
      ).toBe(404);
      expect(
        (await call(ANA, "PUT", `${path}/shared`, { sharedAccount: "owner_in_rooms" })).json,
      ).toMatchObject({
        sharedAccount: "owner_in_rooms",
      });
      expect((await call(BO, "GET", "/api/engine-accounts/people")).status).toBe(403);
      expect((await call(ANA, "GET", "/api/engine-accounts/people")).status).toBe(200);
      expect(
        (await call(ANA, "DELETE", `/api/engine-accounts/people/${BO}/${mine.id}`)).status,
      ).toBe(200);
    });
  });
});
