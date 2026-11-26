// Agent accounts: each person connects their own subscription or key to an engine, and a run uses the account of whoever pays for
// it. Nothing here starts a CLI for a turn: the runner asks `forRun` (chat/harness.ts `setRunAccounts`) and gets the variables.
import { rm } from "node:fs/promises";
import {
  type AccountEngine,
  type AccountScope,
  ACCOUNT_LABEL_MAX,
  ACCOUNT_SECRET,
  defaultAccountLabel,
  ENGINE_SIGN_IN,
  isAccountEngine,
  isKeyProvider,
  SHARED_ACCOUNT,
  type SharedAccount,
  signInMethod,
} from "@zetta/core/engine-accounts";
import type { Database } from "@zetta/db";
import { and, asc, eq, inArray, ne } from "@zetta/db/query";
import { user } from "@zetta/db/schema/auth";
import { bot } from "@zetta/db/schema/chat";
import { botEngine, engineAccount } from "@zetta/db/schema/engine-accounts";
import { membership } from "@zetta/db/schema/identity";
import { chiefShare, workspaceMember } from "@zetta/db/schema/workspaces";
import { isAllowedModel } from "@zetta/harness/models";
import { HarnessError, type NativeHarness, type RunAccount } from "../chat/harness";
import type { ConnectionsService } from "../connections/service";
import { AccessError, type ActiveActor } from "../identity/access";
import { accountFolder, attach } from "./adapters";

export class EngineAccountError extends Error {
  constructor(
    readonly code: "NOT_FOUND" | "INVALID" | "UNAVAILABLE",
    message: string,
  ) {
    super(message);
  }
}

type Row = typeof engineAccount.$inferSelect;
type BotRow = typeof bot.$inferSelect;
/** What a person sees of an account. Never a secret, never a path. */
export type AccountView = ReturnType<typeof view>;
const view = (row: Row) => ({
  id: row.id,
  engine: row.engine,
  kind: row.kind,
  provider: row.provider,
  label: row.label,
  use: row.use,
  state: row.state,
  checkedAt: row.checkedAt,
  createdAt: row.createdAt,
});

export type EngineAccountDeps = {
  /** The sealed store of secrets. Without it (no connection key on this server) only a CLI's own sign-in can be an account. */
  connections?: Pick<ConnectionsService, "configured" | "create" | "secretFor" | "revoke" | "list">;
  /** The setting `serverLogin`: may a person with no account run on the server's own sign-in. */
  serverLogin?: () => Promise<"allowed" | "off">;
  /** A fresh actor for a person, or null when they are no longer a member: a secret is only read as its owner. */
  actorFor: (userId: string) => Promise<ActiveActor | null>;
  audit?: (userId: string, event: { subjectId: string; detail: string }) => void;
};

export function createEngineAccounts(db: Database, deps: EngineAccountDeps) {
  /**
   * Whether a person with no account runs on the server's own sign-in. Never on a server for many organizations (`ZETTA_MODE=app`): one
   * organization would spend another's subscription, so each brings its own.
   */
  const serverLogin = async () =>
    process.env.ZETTA_MODE === "app"
      ? ("off" as const)
      : ((await deps.serverLogin?.()) ?? "allowed");
  const mine = (actor: ActiveActor) => eq(engineAccount.ownerUserId, actor.userId);
  const record = (userId: string, subjectId: string, detail: string) =>
    deps.audit?.(userId, { subjectId, detail });

  async function owned(actor: ActiveActor, id: string): Promise<Row> {
    const [row] = await db
      .select()
      .from(engineAccount)
      .where(and(eq(engineAccount.id, id), mine(actor)));
    if (!row) throw new EngineAccountError("NOT_FOUND", "That account is not yours.");
    return row;
  }

  /** `default` for the first active account of a person and engine, `extra` after that. */
  async function nextUse(userId: string, engine: AccountEngine) {
    const [taken] = await db
      .select({ id: engineAccount.id })
      .from(engineAccount)
      .where(
        and(
          eq(engineAccount.ownerUserId, userId),
          eq(engineAccount.engine, engine),
          eq(engineAccount.use, "default"),
          eq(engineAccount.state, "active"),
        ),
      )
      .limit(1);
    return taken ? ("extra" as const) : ("default" as const);
  }

  const label = (given: string | undefined, fallback: string) => {
    const text = (given ?? "").trim() || fallback;
    if (text.length > ACCOUNT_LABEL_MAX)
      throw new EngineAccountError(
        "INVALID",
        `A name has at most ${ACCOUNT_LABEL_MAX} characters.`,
      );
    return text;
  };

  /** The account the workspace the work runs in has for this engine, if an administrator connected one. */
  async function workspaceAccount(engine: AccountEngine) {
    const [row] = await db
      .select()
      .from(engineAccount)
      .where(
        and(
          eq(engineAccount.engine, engine),
          eq(engineAccount.use, "workspace"),
          eq(engineAccount.state, "active"),
        ),
      )
      .limit(1);
    return row;
  }

  /** An account for the whole workspace is an owner's or an administrator's to connect, and one per engine. */
  async function requireWorkspaceSlot(actor: ActiveActor, engine: AccountEngine) {
    if (!actor.isAdmin) throw new AccessError("ACCESS_DENIED");
    if (await workspaceAccount(engine))
      throw new EngineAccountError(
        "INVALID",
        "This workspace already has an account for this engine. Disconnect it first.",
      );
  }

  /** The person connected an account to this engine, and the engine refused every one: they sign in again, not on someone else's. */
  async function refusedOnly(userId: string, engine: AccountEngine) {
    const [row] = await db
      .select({ id: engineAccount.id })
      .from(engineAccount)
      .where(
        and(
          eq(engineAccount.ownerUserId, userId),
          eq(engineAccount.engine, engine),
          eq(engineAccount.state, "signed_out"),
          ne(engineAccount.use, "workspace"),
        ),
      )
      .limit(1);
    return Boolean(row);
  }

  /** The account a person's run of this engine uses: the one they chose for the bot, else their default, else any active one of theirs. */
  async function accountOf(userId: string, engine: AccountEngine, botId?: string) {
    const rows = await db
      .select()
      .from(engineAccount)
      .where(
        and(
          eq(engineAccount.ownerUserId, userId),
          eq(engineAccount.engine, engine),
          eq(engineAccount.state, "active"),
          ne(engineAccount.use, "workspace"),
        ),
      )
      .orderBy(asc(engineAccount.createdAt));
    if (!rows.length) return undefined;
    if (botId) {
      const [choice] = await db
        .select({ accountId: botEngine.accountId })
        .from(botEngine)
        .where(and(eq(botEngine.botId, botId), eq(botEngine.userId, userId)));
      const chosen = rows.find((row) => row.id === choice?.accountId);
      if (chosen) return chosen;
    }
    return rows.find((row) => row.use === "default") ?? rows[0];
  }

  /** Whose account pays for a bot's run: its owner's for a shared Chief everywhere and for a bot shared in rooms there, else the asker's. */
  async function payerOf(
    b: Pick<BotRow, "id" | "ownerUserId" | "sharedAccount">,
    askerUserId: string,
    room: boolean,
  ) {
    if (b.ownerUserId === askerUserId) return askerUserId;
    if (room && b.sharedAccount === "owner_in_rooms") return b.ownerUserId;
    const [shared] = await db
      .select({ botId: chiefShare.botId })
      .from(chiefShare)
      .where(and(eq(chiefShare.userId, askerUserId), eq(chiefShare.botId, b.id)));
    return shared ? b.ownerUserId : askerUserId;
  }

  return {
    /** The person's accounts, and what each engine offers. */
    async list(actor: ActiveActor) {
      const rows = await db
        .select()
        .from(engineAccount)
        .where(and(mine(actor), ne(engineAccount.use, "workspace")))
        .orderBy(asc(engineAccount.createdAt));
      // Everyone in the workspace sees which engines it covers: its people run on these when they have none of their own.
      const shared = await db
        .select()
        .from(engineAccount)
        .where(and(eq(engineAccount.use, "workspace"), ne(engineAccount.state, "pending")))
        .orderBy(asc(engineAccount.createdAt));
      return {
        accounts: rows.filter((row) => row.state !== "pending").map(view),
        workspace: shared.map(view),
        mayConnectForWorkspace: actor.isAdmin,
        sealed: Boolean(deps.connections?.configured()),
        serverLogin: await serverLogin(),
      };
    },

    /** Connects an account from a pasted token or key. The secret arrives already opened from its sealed form, and is sealed again at rest. */
    async createFromSecret(
      actor: ActiveActor,
      input: {
        engine: string;
        method: string;
        provider?: string | undefined;
        label?: string | undefined;
        secret: string;
        /** `workspace`: for the whole workspace, an owner's or an administrator's to connect. */
        for?: AccountScope | undefined;
      },
    ) {
      if (!isAccountEngine(input.engine))
        throw new EngineAccountError("INVALID", "That is not an engine.");
      if (input.for === "workspace") await requireWorkspaceSlot(actor, input.engine);
      const method = signInMethod(input.engine, input.method);
      // A guided sign-in that ends in a token stores it the same way a pasted one is stored.
      const kind =
        method?.way === "paste"
          ? method.kind
          : method?.way === "guided" && method.result === "token"
            ? "token"
            : undefined;
      if (!method || !kind)
        throw new EngineAccountError("INVALID", "This engine does not take that.");
      const provider = kind === "api_key" ? input.provider : undefined;
      if (kind === "api_key") {
        const allowed = method.way === "paste" ? (method.providers ?? []) : [];
        if (!isKeyProvider(provider) || !allowed.includes(provider))
          throw new EngineAccountError("INVALID", "Choose whose key this is.");
      }
      const secret = input.secret.trim();
      if (
        secret.length < ACCOUNT_SECRET.min ||
        secret.length > ACCOUNT_SECRET.max ||
        /\s/.test(secret)
      )
        throw new EngineAccountError("INVALID", "That does not look like a token or a key.");
      if (!deps.connections?.configured())
        throw new EngineAccountError(
          "UNAVAILABLE",
          "This server cannot store secrets yet: its connection key is not set.",
        );
      const name = label(input.label, defaultAccountLabel(kind, provider));
      const sealed = await deps.connections.create(actor, {
        provider: "engine",
        label: `${input.engine}: ${name}`.slice(0, 100),
        secret,
      });
      const [row] = await db
        .insert(engineAccount)
        .values({
          ownerUserId: actor.userId,
          engine: input.engine,
          kind,
          provider: provider ?? null,
          label: name,
          use: input.for === "workspace" ? "workspace" : await nextUse(actor.userId, input.engine),
          state: "active",
          connectionId: sealed.id,
        })
        .returning();
      record(
        actor.userId,
        row!.id,
        `connected:${input.engine}${input.for === "workspace" ? ":workspace" : ""}`,
      );
      return view(row!);
    },

    /** A sign-in that is about to start: the row gives the account its id, which names its folder. Not usable until `finishLogin`. */
    async beginLogin(
      actor: ActiveActor,
      engine: AccountEngine,
      methodId: string,
      scope: AccountScope = "mine",
    ) {
      const method = signInMethod(engine, methodId);
      if (method?.way !== "guided" || method.result !== "login")
        throw new EngineAccountError("INVALID", "This engine does not sign in that way.");
      if (scope === "workspace") await requireWorkspaceSlot(actor, engine);
      const [row] = await db
        .insert(engineAccount)
        .values({
          ownerUserId: actor.userId,
          engine,
          kind: "login",
          provider: method.provider ?? null,
          label: defaultAccountLabel("login"),
          // A sign-in for the workspace says so from the start; one of a person's own takes its place when it is done.
          use: scope === "workspace" ? "workspace" : "extra",
          state: "pending",
        })
        .returning();
      return row!;
    },

    async finishLogin(actor: ActiveActor, id: string) {
      const row = await owned(actor, id);
      const [done] = await db
        .update(engineAccount)
        .set({
          state: "active",
          use: row.use === "workspace" ? "workspace" : await nextUse(actor.userId, row.engine),
          checkedAt: new Date(),
          updatedAt: new Date(),
        })
        .where(eq(engineAccount.id, id))
        .returning();
      record(actor.userId, id, `connected:${row.engine}`);
      return view(done!);
    },

    /** What a `login` account's own CLI said when asked: the sign-in holds, or it is gone and the person signs in again. */
    async markChecked(id: string, signedIn: boolean) {
      await db
        .update(engineAccount)
        .set({
          state: signedIn ? "active" : "signed_out",
          checkedAt: new Date(),
          updatedAt: new Date(),
        })
        .where(
          and(eq(engineAccount.id, id), inArray(engineAccount.state, ["active", "signed_out"])),
        );
    },

    /** One account by its id, for the server's own bookkeeping: never handed to a person. */
    async byId(id: string) {
      const [row] = await db.select().from(engineAccount).where(eq(engineAccount.id, id));
      return row;
    },

    /** The person's own account, as the page shows it, with what is needed to check it. */
    async own(actor: ActiveActor, id: string) {
      return owned(actor, id);
    },

    /**
     * A token or a key marked signed out is used again: only a run can tell whether the provider takes it, so the next one is the check.
     */
    async retry(actor: ActiveActor, id: string) {
      const row = await owned(actor, id);
      if (row.state === "signed_out") await this.markChecked(row.id, true);
      return view(await owned(actor, id));
    },

    /** Makes this account the one the person's bots use for its engine. */
    async setDefault(actor: ActiveActor, id: string) {
      const row = await owned(actor, id);
      if (row.state !== "active")
        throw new EngineAccountError("INVALID", "Sign in to this account again first.");
      await db.transaction(async (tx) => {
        await tx
          .update(engineAccount)
          .set({ use: "extra", updatedAt: new Date() })
          .where(
            and(
              eq(engineAccount.ownerUserId, actor.userId),
              eq(engineAccount.engine, row.engine),
              eq(engineAccount.use, "default"),
            ),
          );
        await tx
          .update(engineAccount)
          .set({ use: "default", updatedAt: new Date() })
          .where(eq(engineAccount.id, id));
      });
      return view({ ...row, use: "default" });
    },

    async rename(actor: ActiveActor, id: string, name: string) {
      const row = await owned(actor, id);
      const text = label(name, row.label);
      await db
        .update(engineAccount)
        .set({ label: text, updatedAt: new Date() })
        .where(eq(engineAccount.id, id));
      return view({ ...row, label: text });
    },

    /**
     * Disconnects an account: its sealed secret is revoked, its folder removed, its row deleted. The person's own, or (`of`) one of a
     * person in the workspace an administrator looks after. If it was the default, the oldest other account of the engine takes over.
     */
    async remove(actor: ActiveActor, id: string, of?: string) {
      const ownerUserId = of ?? actor.userId;
      if (of && of !== actor.userId) await this.requireAdminOf(actor, of);
      const [row] = await db
        .select()
        .from(engineAccount)
        .where(and(eq(engineAccount.id, id), eq(engineAccount.ownerUserId, ownerUserId)));
      if (!row) throw new EngineAccountError("NOT_FOUND", "That account is not there.");
      await db.delete(engineAccount).where(eq(engineAccount.id, id));
      if (row.connectionId && deps.connections) {
        // The secret is revoked as its owner; a person who left has none to act as, and the row is already gone.
        const owner = ownerUserId === actor.userId ? actor : await deps.actorFor(ownerUserId);
        const sealed = owner
          ? (await deps.connections.list(owner)).find((c) => c.id === row.connectionId)
          : undefined;
        if (owner && sealed?.state === "active")
          await deps.connections.revoke(owner, sealed.id, sealed.revision).catch(() => undefined);
      }
      await rm(accountFolder(row.id), { recursive: true, force: true }).catch(() => undefined);
      if (row.use === "default" && row.state === "active") {
        const next = await accountOf(ownerUserId, row.engine);
        if (next)
          await db
            .update(engineAccount)
            .set({ use: "default" })
            .where(eq(engineAccount.id, next.id));
      }
      record(actor.userId, row.id, `disconnected:${row.engine}`);
      return { id: row.id };
    },

    /** An owner or an administrator disconnects the workspace's account, whoever connected it, also someone who has left. */
    async removeForWorkspace(actor: ActiveActor, id: string) {
      if (!actor.isAdmin) throw new AccessError("ACCESS_DENIED");
      const [row] = await db
        .select()
        .from(engineAccount)
        .where(and(eq(engineAccount.id, id), eq(engineAccount.use, "workspace")));
      if (!row) throw new EngineAccountError("NOT_FOUND", "That account is not there.");
      await db.delete(engineAccount).where(eq(engineAccount.id, id));
      if (row.connectionId && deps.connections) {
        const owner =
          row.ownerUserId === actor.userId ? actor : await deps.actorFor(row.ownerUserId);
        const sealed = owner
          ? (await deps.connections.list(owner)).find((c) => c.id === row.connectionId)
          : undefined;
        if (owner && sealed?.state === "active")
          await deps.connections.revoke(owner, sealed.id, sealed.revision).catch(() => undefined);
      }
      await rm(accountFolder(row.id), { recursive: true, force: true }).catch(() => undefined);
      record(actor.userId, row.id, `disconnected:${row.engine}:workspace`);
      return { id: row.id };
    },

    /** An owner or an administrator, about a person of their own workspace. */
    async requireAdminOf(actor: ActiveActor, userId: string) {
      if (!actor.isAdmin || !actor.workspaceId) throw new AccessError("ACCESS_DENIED");
      const [there] = await db
        .select({ userId: workspaceMember.userId })
        .from(workspaceMember)
        .where(
          and(
            eq(workspaceMember.workspaceId, actor.workspaceId),
            eq(workspaceMember.userId, userId),
            eq(workspaceMember.status, "active"),
          ),
        );
      if (!there)
        throw new EngineAccountError("NOT_FOUND", "That person is not in this workspace.");
    },

    /** For the people page: which engines each person of the workspace has an account for. Never a label, a provider or a secret. */
    async overview(actor: ActiveActor) {
      if (!actor.isAdmin || !actor.workspaceId) throw new AccessError("ACCESS_DENIED");
      const rows = await db
        .select({
          userId: engineAccount.ownerUserId,
          id: engineAccount.id,
          engine: engineAccount.engine,
          kind: engineAccount.kind,
          state: engineAccount.state,
          use: engineAccount.use,
        })
        .from(engineAccount)
        .innerJoin(
          workspaceMember,
          and(
            eq(workspaceMember.userId, engineAccount.ownerUserId),
            eq(workspaceMember.workspaceId, actor.workspaceId),
            eq(workspaceMember.status, "active"),
          ),
        )
        .innerJoin(
          membership,
          and(eq(membership.userId, engineAccount.ownerUserId), eq(membership.status, "active")),
        )
        .innerJoin(user, eq(user.id, engineAccount.ownerUserId))
        .orderBy(asc(user.name), asc(engineAccount.createdAt));
      return { accounts: rows.filter((row) => row.state !== "pending") };
    },

    /** What the person chose for one bot, and what they can choose. */
    async choice(actor: ActiveActor, b: BotRow) {
      const [row] = await db
        .select()
        .from(botEngine)
        .where(and(eq(botEngine.botId, b.id), eq(botEngine.userId, actor.userId)));
      const owner = b.ownerUserId === actor.userId;
      return {
        botId: b.id,
        owner,
        /** The bot runs on its owner's account for this person in every chat (a Chief that was shared): nothing here is theirs to choose. */
        ownerPays: !owner && (await payerOf(b, actor.userId, false)) === b.ownerUserId,
        /** The bot's own engine and model: its owner's choice, and what an empty choice follows. */
        default: { harness: b.harness, model: b.model },
        // The owner's engine and model are the bot's own; only the account is a choice of theirs here.
        harness: owner ? null : (row?.harness ?? null),
        model: owner ? null : (row?.model ?? null),
        accountId: row?.accountId ?? null,
        sharedAccount: b.sharedAccount,
      };
    },

    /** Saves the person's engine, model and account for one bot. An owner saves only the account: the engine is the bot's own setting. */
    async setChoice(
      actor: ActiveActor,
      b: BotRow,
      input: {
        harness?: string | null | undefined;
        model?: string | null | undefined;
        accountId?: string | null | undefined;
      },
    ) {
      const owner = b.ownerUserId === actor.userId;
      const harness = owner ? null : (input.harness ?? null);
      if (harness !== null && !isAccountEngine(harness))
        throw new EngineAccountError("INVALID", "That is not an engine.");
      const model = owner || harness === null ? null : (input.model ?? null);
      if (harness && model && !isAllowedModel(harness, model))
        throw new EngineAccountError("INVALID", "That model is not available for this engine.");
      const engine = harness ?? b.harness;
      let accountId: string | null = input.accountId ?? null;
      if (accountId) {
        const account = await owned(actor, accountId);
        if (account.engine !== engine || account.state !== "active")
          throw new EngineAccountError(
            "INVALID",
            "That account is for another engine, or is signed out.",
          );
        accountId = account.id;
      }
      if (harness === null && model === null && accountId === null) {
        await db
          .delete(botEngine)
          .where(and(eq(botEngine.botId, b.id), eq(botEngine.userId, actor.userId)));
      } else {
        await db
          .insert(botEngine)
          .values({ botId: b.id, userId: actor.userId, harness, model, accountId })
          .onConflictDoUpdate({
            target: [botEngine.botId, botEngine.userId],
            set: { harness, model, accountId, updatedAt: new Date() },
          });
      }
      return this.choice(actor, b);
    },

    /** The owner's switch: in a room, this bot runs on my account for everyone. */
    async setShared(actor: ActiveActor, b: BotRow, value: unknown) {
      if (b.ownerUserId !== actor.userId) throw new AccessError("NOT_FOUND");
      if (!SHARED_ACCOUNT.includes(value as SharedAccount))
        throw new EngineAccountError("INVALID", "Choose who pays in a room.");
      await db
        .update(bot)
        .set({ sharedAccount: value as SharedAccount })
        .where(eq(bot.id, b.id));
      record(actor.userId, b.id, `shared:${value as string}`);
      return { botId: b.id, sharedAccount: value as SharedAccount };
    },

    payerOf,

    /**
     * The bot as one turn runs it, and who pays. Someone who is not the owner runs the engine and model they chose for it; when the
     * owner pays, it is the owner's own engine and model.
     */
    async forTurn<B extends BotRow>(turn: {
      bot: B;
      userId: string;
      room?: boolean | undefined;
    }): Promise<{ bot: B; payerUserId: string }> {
      const payerUserId = await payerOf(turn.bot, turn.userId, Boolean(turn.room));
      if (payerUserId !== turn.userId || turn.bot.ownerUserId === turn.userId)
        return { bot: turn.bot, payerUserId };
      const [row] = await db
        .select({ harness: botEngine.harness, model: botEngine.model })
        .from(botEngine)
        .where(and(eq(botEngine.botId, turn.bot.id), eq(botEngine.userId, turn.userId)));
      if (!row?.harness) return { bot: turn.bot, payerUserId };
      return { bot: { ...turn.bot, harness: row.harness, model: row.model }, payerUserId };
    },

    /**
     * The account a run uses (`RunAccounts` of chat/harness.ts). The payer's account for the engine; without one, the server's own
     * sign-in when the setting allows it; otherwise the run is refused as not signed in, which a fallback engine can take over.
     */
    async forRun(run: {
      harness: NativeHarness;
      userId: string | undefined;
      payerUserId: string | undefined;
      botId: string | undefined;
    }): Promise<RunAccount | undefined> {
      const asker = run.userId;
      if (!asker || !isAccountEngine(run.harness)) return undefined;
      let payer = run.payerUserId;
      if (!payer && run.botId) {
        // A caller that did not say who pays (a background job on the person's Chief): the same rule, outside any room.
        const [b] = await db
          .select({ id: bot.id, ownerUserId: bot.ownerUserId, sharedAccount: bot.sharedAccount })
          .from(bot)
          .where(eq(bot.id, run.botId));
        payer = b ? await payerOf(b, asker, false) : asker;
      }
      payer ??= asker;
      const own = await accountOf(payer, run.harness, run.botId);
      // A person with none of their own runs on the workspace's account, when an administrator connected one.
      const account =
        own ??
        ((await refusedOnly(payer, run.harness)) ? undefined : await workspaceAccount(run.harness));
      if (!account) {
        if (await refusedOnly(payer, run.harness)) throw new HarnessError("auth_required");
        if ((await serverLogin()) === "allowed") return undefined;
        throw new HarnessError("auth_required");
      }
      if (!account.connectionId) return attach(account, undefined);
      // Opened as the account's owner: the person who pays, or the administrator who connected the workspace's account.
      const owner = await deps.actorFor(account.ownerUserId);
      if (!owner || !deps.connections) throw new HarnessError("auth_required");
      let secret: Buffer;
      try {
        secret = await deps.connections.secretFor(owner, account.connectionId);
      } catch {
        // Revoked, expired or unreadable: this account cannot run, and no other one is tried in its place.
        throw new HarnessError("auth_required");
      }
      try {
        return attach(account, secret.toString("utf8"));
      } finally {
        secret.fill(0);
      }
    },

    methods: ENGINE_SIGN_IN,
  };
}
export type EngineAccounts = ReturnType<typeof createEngineAccounts>;
