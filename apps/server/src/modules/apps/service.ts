import { topics } from "@zetta/core/live-topics";
import { hasKeyFormat } from "@zetta/core/secrets";
import type { Database } from "@zetta/db";
import { and, asc, desc, eq, getTableColumns, inArray, or, sql } from "@zetta/db/query";
import {
  app,
  appCall,
  appRecord,
  appVersion,
  botApp,
  type AppCallSource,
  type AppManifest,
  type AppToolKind,
  type AppToolManifest,
  type AppToolPolicy,
} from "@zetta/db/schema/apps";
import { bot } from "@zetta/db/schema/chat";
import { playground, playgroundFile } from "@zetta/db/schema/playground";
import { createLimiter, HarnessError } from "../chat/harness";
import { events } from "../events/bus";
import { audit, auditToolDetail } from "../features/audit";
import type { ActiveActor } from "../identity/access";
import { LANGUAGES } from "../playground/languages";
import { pickRunner, refusal } from "../playground/host-gate";
import { hostRunner } from "../playground/runner-host";
import type { RunResult, Runner } from "../playground/types";
import { checkManifest, diffManifests, freeSlug, ManifestError, slugify } from "./manifest";
import { APP_FILE_LIMIT } from "./fields";
import { decide, describePolicy } from "./policy";
import { validate } from "./schema";
import { clashesWithSdk, HARNESS_FILE, RESULT_FILE, sdkFiles, SDK_VERSION } from "./sdk";
import {
  applyOps,
  checkOps,
  loadSnapshot,
  StorageError,
  summarize,
  type Snapshot,
} from "./storage";
import { buildAppUi, uiBuildMessage, uiEntryOf } from "./ui-build";

export class AppError extends Error {
  constructor(
    readonly code:
      | "NOT_FOUND"
      | "FORBIDDEN"
      | "CONFLICT"
      | "INVALID"
      | "BUSY"
      | "UNAVAILABLE"
      | "EXPIRED"
      | "NEEDS_ACCOUNT",
    /** A sentence for the person: which tool, which field. */
    readonly detail?: string,
  ) {
    super(code);
  }
}
export const APP_ERRORS: Record<AppError["code"], [number, string]> = {
  NOT_FOUND: [404, "No such app or tool."],
  FORBIDDEN: [403, "Only the owner can do this."],
  CONFLICT: [409, "This changed. Reload and try again."],
  INVALID: [400, "Check the request and try again."],
  BUSY: [429, "Too many tool calls are running. Try again in a moment."],
  UNAVAILABLE: [503, "This runner is not available on the server."],
  EXPIRED: [410, "Nobody answered in time, so this call did not run."],
  NEEDS_ACCOUNT: [409, "This tool needs an account that is not connected."],
};

export const APP_LIMITS = {
  /** Files of one app, characters of source, bots per app grant. */
  files: APP_FILE_LIMIT,
  sourceBytes: 1_000_000,
  botsPerApp: 25,
  appsPerBot: 25,
  appsPerOwner: 100,
  callTimeoutMs: 30_000,
  describeTimeoutMs: 15_000,
  /** How long a call waits for its card. */
  approvalTtlMs: 24 * 60 * 60_000,
  /** A stored input or result is cut to this many characters of JSON. */
  keepChars: 64_000,
  keepCalls: 200,
} as const;

export type CallRequest = {
  /** The slug of an app the caller owns or a team app, or an app id. */
  app: string;
  tool: string;
  input?: unknown;
  source: AppCallSource;
  botId?: string | null;
  conversationId?: string | null;
  /** The call comes from someone outside the account (an inbound conversation). */
  outside?: boolean;
};
export type CallResult =
  | { status: "ok"; callId: string; value: unknown; durationMs: number }
  | {
      status: "failed";
      callId: string;
      error: { code: string; message: string };
      durationMs: number;
    }
  | { status: "denied"; callId: string; reason: string }
  | {
      status: "approval_required";
      callId: string;
      app: string;
      tool: string;
      kind: AppToolKind;
      input: unknown;
      reason: string;
    };

type Deps = {
  /** `host` is always there. Pass `container` when the engine is set up. */
  runners?: Partial<Record<"host" | "container", Runner>>;
  limits?: { global: number; perUser: number };
  /** False turns the host runner off (see host-gate.ts). Left out, the host runner is allowed: services.ts passes the real switch. */
  hostCode?: () => boolean;
};
type AppRow = typeof app.$inferSelect;
const { files: _files, ui: _ui, ...versionColumns } = getTableColumns(appVersion);
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** JSON of at most `max` characters: the value itself, or a marker when it is larger. */
function keep(value: unknown, max: number = APP_LIMITS.keepChars): unknown {
  const text = JSON.stringify(value ?? null);
  return text.length <= max ? (value ?? null) : { _truncated: true, characters: text.length };
}
/** Text that is safe to show: a stderr tail that looks like a secret is replaced, not shown. */
function scrub(text: string, max = 400): string {
  const t = text.replaceAll("\0", "").trim().split("\n").slice(-6).join("\n").slice(-max);
  return hasKeyFormat(t) ? "[hidden: the output looks like it holds a secret]" : t;
}

/**
 * Apps (see docs/decisions/apps.md): published code whose tools bots, routines and workflows call. The owner edits the code in a playground
 * and publishes it as an immutable version; a call runs the active version in a runner, with its input checked first and its policy
 * (run, ask the person, or refuse) decided before anything starts. A team app can be called by every member, with their own accounts.
 */
export function createApps(db: Database, deps: Deps = {}) {
  const runners: Partial<Record<"host" | "container", Runner>> = {
    host: hostRunner,
    ...deps.runners,
  };
  const hostCode = deps.hostCode ?? (() => true);
  const limiter = createLimiter({ ...(deps.limits ?? { global: 4, perUser: 2 }), waitMs: 5000 });
  const tell = (...ids: string[]) => events.publish([...new Set(ids)], topics.apps);

  const visible = (actor: ActiveActor) =>
    and(
      eq(app.status, "active"),
      or(eq(app.ownerUserId, actor.userId), eq(app.visibility, "team")),
    );

  /** An app the caller may use, by slug (their own first) or id. */
  async function resolve(actor: ActiveActor, ref: string): Promise<AppRow> {
    const rows = await db
      .select()
      .from(app)
      .where(and(visible(actor), UUID.test(ref) ? eq(app.id, ref) : eq(app.slug, ref)));
    const own = rows.find((r) => r.ownerUserId === actor.userId);
    if (own) return own;
    if (rows.length > 1)
      throw new AppError("INVALID", `More than one team app is called ${ref}. Use its id.`);
    if (!rows[0]) throw new AppError("NOT_FOUND", `No app called ${ref}.`);
    return rows[0];
  }
  async function owned(actor: ActiveActor, id: string): Promise<AppRow> {
    const row = await resolve(actor, id);
    if (row.ownerUserId !== actor.userId) throw new AppError("FORBIDDEN");
    return row;
  }
  async function versionRow(id: string) {
    const [v] = await db.select().from(appVersion).where(eq(appVersion.id, id));
    if (!v) throw new AppError("NOT_FOUND", "That version is gone.");
    return v;
  }
  async function activeVersion(a: AppRow) {
    if (!a.activeVersionId) throw new AppError("INVALID", `${a.name} has no published version.`);
    return versionRow(a.activeVersionId);
  }

  /* -------------------------------------------------------------- running */

  /** Runs one tool in the app's runner and reads what the harness wrote. Never throws for a tool's own failure. */
  /** What a run came back with. `storage` is what the tool wrote, still unchecked. */
  type Outcome =
    | { ok: true; value: unknown; storage?: unknown }
    | { ok: false; error: { code: string; message: string } };

  async function execute(
    a: AppRow,
    v: typeof appVersion.$inferSelect,
    actor: ActiveActor,
    payload:
      | { mode: "call"; tool: string; input: unknown; storage?: Snapshot }
      | { mode: "describe" },
    timeoutMs: number,
  ): Promise<Outcome> {
    const runnerName = a.settings.runner ?? "host";
    const picked = pickRunner(runners, runnerName, hostCode);
    if ("refused" in picked) throw new AppError("UNAVAILABLE", refusal(picked.refused, runnerName));
    const runner = picked.runner;
    let release: () => void;
    try {
      release = await limiter.acquire(actor.userId);
    } catch (e) {
      if (e instanceof HarnessError && e.code === "busy") throw new AppError("BUSY");
      throw e;
    }
    let r: RunResult;
    try {
      r = await runner(
        {
          language: "typescript",
          entry: HARNESS_FILE,
          files: [...v.files, ...sdkFiles(v.entry)],
          inputs: {},
          timeoutMs,
          stdin: JSON.stringify(payload),
          resultFile: RESULT_FILE,
        },
        new AbortController().signal,
      );
    } finally {
      release();
    }
    return readOutcome(r, timeoutMs);
  }

  /** The harness writes `{ok:true,value}` or `{ok:false,error}` to result.json. Anything else is a crash, and says why without leaking. */
  function readOutcome(r: RunResult, timeoutMs: number) {
    const fail = (code: string, message: string) => ({
      ok: false as const,
      error: { code, message },
    });
    if (r.status === "timeout")
      return fail("TIMEOUT", `The tool took longer than ${Math.round(timeoutMs / 1000)} seconds.`);
    if (r.status === "cancelled") return fail("CANCELLED", "The call was cancelled.");
    if (r.result === undefined)
      return fail(
        "CRASHED",
        scrub(r.stderr) || `The tool stopped without an answer (exit ${r.exitCode}).`,
      );
    let parsed: unknown;
    try {
      parsed = JSON.parse(r.result);
    } catch {
      return fail("BAD_RESULT", "The tool wrote an answer that is not JSON.");
    }
    if (
      typeof parsed !== "object" ||
      parsed === null ||
      typeof (parsed as { ok?: unknown }).ok !== "boolean"
    )
      return parsed && typeof parsed === "object" && "sdk" in parsed
        ? { ok: true as const, value: parsed }
        : fail("BAD_RESULT", "The tool's answer has the wrong shape.");
    const p = parsed as {
      ok: boolean;
      value?: unknown;
      error?: { code?: unknown; message?: unknown };
    };
    if (p.ok)
      return {
        ok: true as const,
        value: p.value ?? null,
        ...((p as { storage?: unknown }).storage !== undefined && {
          storage: (p as { storage?: unknown }).storage,
        }),
      };
    return fail(
      typeof p.error?.code === "string" ? p.error.code.slice(0, 40) : "TOOL_ERROR",
      scrub(String(p.error?.message ?? "The tool failed."), 1000),
    );
  }

  /** Finishes a call row and tells the pages. */
  async function settle(
    row: { id: string; actorUserId: string; botId: string | null; tool: string },
    appOwner: string,
    started: number,
    out: { ok: true; value: unknown } | { ok: false; error: { code: string; message: string } },
  ): Promise<CallResult> {
    const durationMs = Date.now() - started;
    await db
      .update(appCall)
      .set(
        out.ok
          ? { status: "ok", result: keep(out.value) as never, durationMs, finishedAt: new Date() }
          : {
              status: "failed",
              error: `${out.error.code}: ${out.error.message}`.slice(0, 1000),
              durationMs,
              finishedAt: new Date(),
            },
      )
      .where(eq(appCall.id, row.id));
    await audit(db, row.actorUserId, {
      kind: "tool_call",
      botId: row.botId,
      outcome: out.ok ? "ok" : "failed",
      subjectId: row.id,
      detail: auditToolDetail("app", row.tool),
    });
    tell(row.actorUserId, appOwner);
    return out.ok
      ? { status: "ok", callId: row.id, value: out.value, durationMs }
      : { status: "failed", callId: row.id, error: out.error, durationMs };
  }

  /** Runs a call that is allowed to run: execute, check the output against the tool's declaration, record it. */
  async function run(
    a: AppRow,
    v: typeof appVersion.$inferSelect,
    t: AppToolManifest,
    actor: ActiveActor,
    row: { id: string; actorUserId: string; botId: string | null; tool: string },
    input: unknown,
  ): Promise<CallResult> {
    const started = Date.now();
    let out: Outcome;
    let snapshot: Snapshot = {};
    try {
      snapshot = await loadSnapshot(db, a.id, actor.userId, t.storage);
    } catch (e) {
      if (!(e instanceof StorageError)) throw e;
      return settle(row, a.ownerUserId, started, {
        ok: false,
        error: { code: e.code, message: e.message },
      });
    }
    try {
      out = await execute(
        a,
        v,
        actor,
        { mode: "call", tool: t.name, input, storage: snapshot },
        APP_LIMITS.callTimeoutMs,
      );
    } catch (e) {
      // The call never started (busy, no runner): the row says so and the caller gets the reason.
      await db
        .update(appCall)
        .set({
          status: "failed",
          error: e instanceof AppError ? e.code : "FAILED",
          finishedAt: new Date(),
        })
        .where(eq(appCall.id, row.id));
      tell(row.actorUserId, a.ownerUserId);
      throw e;
    }
    if (out.ok && t.output) {
      const checked = validate(t.output, out.value, "result");
      out = checked.ok
        ? { ok: true as const, value: checked.value }
        : {
            ok: false as const,
            error: {
              code: "BAD_RESULT",
              message: `The tool's answer does not match its declaration: ${checked.error}`,
            },
          };
    }
    // What the tool wrote is checked against what it declared, then applied in one transaction. Nothing is written for a failed call.
    if (out.ok) {
      try {
        const ops = checkOps(out.storage, t.storage);
        if (ops.length > 0 && t.storage)
          await db.transaction(async (tx) => {
            await applyOps(tx as unknown as Database, a.id, actor.userId, t.storage!, ops);
          });
      } catch (e) {
        if (!(e instanceof StorageError)) throw e;
        out = { ok: false, error: { code: e.code, message: e.message } };
      }
    }
    return settle(row, a.ownerUserId, started, out);
  }

  /* ----------------------------------------------------------------- calls */

  async function call(actor: ActiveActor, req: CallRequest): Promise<CallResult> {
    const a = await resolve(actor, req.app);
    const v = await activeVersion(a);
    const t = v.manifest.tools.find((x) => x.name === req.tool);
    if (!t) throw new AppError("NOT_FOUND", `${a.name} has no tool called ${req.tool}.`);
    const checked = validate(t.input, req.input ?? {});
    if (!checked.ok) throw new AppError("INVALID", checked.error);
    const base = {
      appId: a.id,
      versionId: v.id,
      tool: t.name,
      kind: t.kind,
      actorUserId: actor.userId,
      botId: req.botId ?? null,
      conversationId: req.conversationId ?? null,
      source: req.source,
      input: keep(checked.value) as never,
    };
    const d = decide({
      kind: t.kind,
      approval: t.approval,
      override: a.settings.toolPolicy?.[t.name],
      input: checked.value,
      outside: req.outside === true,
    });
    if (d.decision === "deny") {
      const [row] = await db
        .insert(appCall)
        .values({ ...base, status: "denied", error: d.reason, finishedAt: new Date() })
        .returning({ id: appCall.id });
      await audit(db, actor.userId, {
        kind: "tool_call",
        botId: base.botId,
        outcome: "denied",
        subjectId: row!.id,
        detail: auditToolDetail("app", t.name),
      });
      tell(actor.userId, a.ownerUserId);
      return { status: "denied", callId: row!.id, reason: d.reason };
    }
    // Accounts arrive in a later phase: until then a tool that needs one cannot run, and no card is made for it.
    if (t.accounts.length)
      throw new AppError("NEEDS_ACCOUNT", `${t.name} needs the account ${t.accounts[0]}.`);
    if (d.decision === "ask") {
      const [row] = await db
        .insert(appCall)
        .values({ ...base, status: "pending_approval" })
        .returning({ id: appCall.id });
      tell(actor.userId, a.ownerUserId);
      return {
        status: "approval_required",
        callId: row!.id,
        app: a.slug,
        tool: t.name,
        kind: t.kind,
        input: checked.value,
        reason: d.reason,
      };
    }
    const [row] = await db
      .insert(appCall)
      .values({ ...base, status: "running" })
      .returning({ id: appCall.id });
    tell(actor.userId, a.ownerUserId);
    return run(
      a,
      v,
      t,
      actor,
      { id: row!.id, actorUserId: actor.userId, botId: base.botId, tool: t.name },
      checked.value,
    );
  }

  /** The person's answer to a call that waited for approval. The call runs as it was asked: same version, same input. */
  async function answer(
    actor: ActiveActor,
    callId: string,
    action: "accept" | "decline" | "cancel",
  ): Promise<CallResult> {
    const [pending] = await db
      .select()
      .from(appCall)
      .where(and(eq(appCall.id, callId), eq(appCall.actorUserId, actor.userId)));
    if (!pending) throw new AppError("NOT_FOUND", "That call is gone.");
    if (pending.status !== "pending_approval")
      throw new AppError("CONFLICT", "That call was already answered.");
    const [a] = await db.select().from(app).where(eq(app.id, pending.appId));
    const ownerOf = a?.ownerUserId ?? actor.userId;
    if (Date.now() - pending.createdAt.getTime() > APP_LIMITS.approvalTtlMs) {
      await db
        .update(appCall)
        .set({ status: "expired", finishedAt: new Date() })
        .where(and(eq(appCall.id, callId), eq(appCall.status, "pending_approval")));
      tell(actor.userId, ownerOf);
      throw new AppError("EXPIRED");
    }
    const deny = async (reason: string): Promise<CallResult> => {
      await db
        .update(appCall)
        .set({ status: "denied", error: reason, finishedAt: new Date() })
        .where(and(eq(appCall.id, callId), eq(appCall.status, "pending_approval")));
      await audit(db, actor.userId, {
        kind: "tool_call",
        botId: pending.botId,
        outcome: "denied",
        subjectId: callId,
        detail: auditToolDetail("app", pending.tool),
      });
      tell(actor.userId, ownerOf);
      return { status: "denied", callId, reason };
    };
    if (action !== "accept") return deny("The person said no.");
    if (!a || a.status !== "active" || (a.ownerUserId !== actor.userId && a.visibility !== "team"))
      return deny("The app is no longer available.");
    // The owner may have blocked the tool while the card waited.
    if (a.settings.toolPolicy?.[pending.tool] === "block")
      return deny("The owner blocked this tool.");
    const v = await versionRow(pending.versionId);
    const t = v.manifest.tools.find((x) => x.name === pending.tool);
    if (!t) return deny("The tool is gone from that version.");
    // Claim the call: only one answer starts it.
    const [claimed] = await db
      .update(appCall)
      .set({ status: "running" })
      .where(and(eq(appCall.id, callId), eq(appCall.status, "pending_approval")))
      .returning({ id: appCall.id });
    if (!claimed) throw new AppError("CONFLICT", "That call was already answered.");
    tell(actor.userId, ownerOf);
    return run(
      a,
      v,
      t,
      actor,
      { id: callId, actorUserId: actor.userId, botId: pending.botId, tool: t.name },
      pending.input,
    );
  }

  /* --------------------------------------------------------------- publish */

  /**
   * Everything publishing checks, without writing anything: the limits, the secrets scan, the page build and (when `describe` is true)
   * the run that reads the tools the code declares. A bot's new app is checked with `describe: false` while its code may not run yet.
   */
  async function assemble(
    actor: ActiveActor,
    p: {
      language: Parameters<typeof uiEntryOf>[1]["language"];
      runner: "host" | "browser" | "container";
      entry: string;
    },
    files: { path: string; content: string }[],
    o: { describe: boolean },
  ) {
    // An app has backend code (TypeScript or JavaScript on the host or in a container), a page (ui/index.html, or an HTML playground), or both.
    const backend =
      (p.language === "typescript" || p.language === "javascript") &&
      p.runner !== "browser" &&
      LANGUAGES[p.language].runners.includes(p.runner);
    const uiEntry = uiEntryOf(files, p);
    if (!backend && !uiEntry)
      throw new AppError(
        "INVALID",
        "An app needs backend code (TypeScript or JavaScript on the host or in a container) or a page (ui/index.html, or an HTML playground).",
      );
    if (backend && !files.some((f) => f.path === p.entry))
      throw new AppError("INVALID", `The entry file ${p.entry} is missing.`);
    if (files.length > APP_LIMITS.files)
      throw new AppError("INVALID", `An app may have at most ${APP_LIMITS.files} files.`);
    if (files.reduce((n, f) => n + f.content.length, 0) > APP_LIMITS.sourceBytes)
      throw new AppError("INVALID", "The source is too large.");
    const clash = files.find((f) => clashesWithSdk(f.path));
    if (clash) throw new AppError("INVALID", `The file ${clash.path} is reserved by the SDK.`);
    if (files.some((f) => hasKeyFormat(f.content)))
      throw new AppError(
        "INVALID",
        "A file looks like it holds a key or a token. Remove it before publishing.",
      );

    // The page is built now, so serving it later is cheap and a version never changes. A build error is the person's to fix.
    let page: { html: string; bytes: number } | undefined;
    if (uiEntry)
      page = await buildAppUi({ files, entry: uiEntry }).catch((e: unknown) => {
        throw new AppError("INVALID", `The page could not be built: ${uiBuildMessage(e)}`);
      });

    // The code describes itself: run it in describe mode and read the tools it declares. A page-only app has none.
    const runnerName: "host" | "container" = p.runner === "container" ? "container" : "host";
    let declared: unknown = { sdk: SDK_VERSION, tools: [], accounts: {} };
    if (backend && o.describe) {
      const probe = { ...({} as AppRow), settings: { runner: runnerName } } as AppRow;
      const described = await execute(
        probe,
        { entry: p.entry, files } as typeof appVersion.$inferSelect,
        actor,
        { mode: "describe" },
        APP_LIMITS.describeTimeoutMs,
      );
      if (!described.ok)
        throw new AppError(
          "INVALID",
          `The app could not describe itself: ${described.error.message}`,
        );
      declared = described.value;
    }
    let manifest: AppManifest | null = null;
    if (!backend || o.describe)
      try {
        manifest = checkManifest(
          declared,
          page && uiEntry ? { entry: uiEntry, bytes: page.bytes } : undefined,
        );
      } catch (e) {
        if (e instanceof ManifestError) throw new AppError("INVALID", e.problems.join(" "));
        throw e;
      }

    return {
      backend,
      uiEntry,
      page,
      runnerName,
      /** Null when the code was not run (`describe: false` and there is backend code). */
      manifest: backend && !o.describe ? null : manifest,
    };
  }

  async function publish(
    actor: ActiveActor,
    o: { playgroundId: string; slug?: string; name?: string; note?: string; botId?: string | null },
  ) {
    const [p] = await db
      .select()
      .from(playground)
      .where(and(eq(playground.id, o.playgroundId), eq(playground.status, "active")));
    if (!p || p.ownerUserId !== actor.userId)
      throw new AppError("NOT_FOUND", "No such playground.");
    const files = (
      await db
        .select({ path: playgroundFile.path, content: playgroundFile.content })
        .from(playgroundFile)
        .where(eq(playgroundFile.playgroundId, p.id))
        .orderBy(asc(playgroundFile.path))
    ).map((f) => ({ path: f.path, content: f.content }));
    const built = await assemble(actor, p, files, { describe: true });
    const { uiEntry, page, runnerName } = built;
    const manifest = built.manifest!;

    return db.transaction(async (tx) => {
      const [existing] = await tx
        .select()
        .from(app)
        .where(
          and(
            eq(app.ownerUserId, actor.userId),
            eq(app.sourcePlaygroundId, p.id),
            eq(app.status, "active"),
          ),
        )
        .for("update");
      let a = existing;
      let created = false;
      if (!a) {
        const mine = await tx
          .select({ slug: app.slug })
          .from(app)
          .where(and(eq(app.ownerUserId, actor.userId), eq(app.status, "active")));
        if (mine.length >= APP_LIMITS.appsPerOwner)
          throw new AppError("INVALID", `You can have at most ${APP_LIMITS.appsPerOwner} apps.`);
        const taken = new Set(mine.map((m) => m.slug));
        const wanted = o.slug ? o.slug.trim() : "";
        if (wanted && !/^[a-z][a-z0-9-]{0,39}$/.test(wanted))
          throw new AppError(
            "INVALID",
            "The slug must be lowercase words joined by -, starting with a letter.",
          );
        if (wanted && taken.has(wanted))
          throw new AppError("CONFLICT", `You already have an app called ${wanted}.`);
        const slug = wanted || freeSlug(slugify(o.name ?? p.title), taken);
        [a] = await tx
          .insert(app)
          .values({
            ownerUserId: actor.userId,
            slug,
            name: (o.name ?? p.title).trim().slice(0, 120),
            sourcePlaygroundId: p.id,
            settings: { runner: runnerName },
          })
          .returning();
        created = true;
      }
      const [prev] = a!.activeVersionId
        ? await tx.select().from(appVersion).where(eq(appVersion.id, a!.activeVersionId))
        : [];
      const [{ n } = { n: 0 }] = await tx
        .select({ n: sql<number>`coalesce(max(${appVersion.n}), 0)::int` })
        .from(appVersion)
        .where(eq(appVersion.appId, a!.id));
      const [version] = await tx
        .insert(appVersion)
        .values({
          appId: a!.id,
          n: n + 1,
          entry: p.entry,
          files,
          manifest,
          ui: page?.html ?? null,
          uiEntry,
          note: (o.note ?? "").slice(0, 500),
          publishedByUserId: actor.userId,
          publishedByBotId: o.botId ?? null,
        })
        .returning({ id: appVersion.id, n: appVersion.n });
      // A tool that is gone keeps no stale policy; the runner is the one the playground uses now.
      const names = new Set(manifest.tools.map((t) => t.name));
      const policy = Object.fromEntries(
        Object.entries(a!.settings.toolPolicy ?? {}).filter(([k]) => names.has(k)),
      );
      const [updated] = await tx
        .update(app)
        .set({
          activeVersionId: version!.id,
          settings: { ...a!.settings, runner: runnerName, toolPolicy: policy },
          version: sql`${app.version} + 1`,
          updatedAt: new Date(),
        })
        .where(eq(app.id, a!.id))
        .returning();
      tell(actor.userId);
      return {
        app: updated!,
        version: version!,
        manifest,
        created,
        changes: diffManifests(prev?.manifest, manifest),
      };
    });
  }

  /** What a publish would change, without publishing. Shown on the card a bot's publish request makes. */
  async function preview(actor: ActiveActor, playgroundId: string) {
    const [p] = await db
      .select()
      .from(playground)
      .where(
        and(
          eq(playground.id, playgroundId),
          eq(playground.ownerUserId, actor.userId),
          eq(playground.status, "active"),
        ),
      );
    if (!p) throw new AppError("NOT_FOUND", "No such playground.");
    const [existing] = await db
      .select()
      .from(app)
      .where(
        and(
          eq(app.ownerUserId, actor.userId),
          eq(app.sourcePlaygroundId, p.id),
          eq(app.status, "active"),
        ),
      );
    return { title: p.title, existing: existing ? { id: existing.id, slug: existing.slug } : null };
  }

  /* --------------------------------------------------------------- reading */

  const summaryOf = (a: AppRow, v: { n: number; manifest: AppManifest } | undefined) => ({
    id: a.id,
    slug: a.slug,
    name: a.name,
    description: a.description,
    visibility: a.visibility,
    ownerUserId: a.ownerUserId,
    sourcePlaygroundId: a.sourcePlaygroundId,
    version: v?.n ?? null,
    tools: v?.manifest.tools.length ?? 0,
    /** The page of the app, when it has one. */
    ui: v?.manifest.ui ?? null,
    accounts: v ? Object.keys(v.manifest.accounts) : [],
    updatedAt: a.updatedAt,
  });

  async function list(actor: ActiveActor) {
    const apps = await db.select().from(app).where(visible(actor)).orderBy(desc(app.updatedAt));
    const ids = apps.flatMap((a) => (a.activeVersionId ? [a.activeVersionId] : []));
    const versions = ids.length
      ? await db
          .select({ id: appVersion.id, n: appVersion.n, manifest: appVersion.manifest })
          .from(appVersion)
          .where(inArray(appVersion.id, ids))
      : [];
    const byId = new Map(versions.map((v) => [v.id, v]));
    return apps.map((a) =>
      summaryOf(a, a.activeVersionId ? byId.get(a.activeVersionId) : undefined),
    );
  }

  async function get(actor: ActiveActor, ref: string) {
    const a = await resolve(actor, ref);
    const versions = await db
      .select(versionColumns)
      .from(appVersion)
      .where(eq(appVersion.appId, a.id))
      .orderBy(desc(appVersion.n));
    const active = versions.find((v) => v.id === a.activeVersionId);
    return {
      ...summaryOf(a, active),
      isOwner: a.ownerUserId === actor.userId,
      settings: a.settings,
      versions: versions.map((v) => ({
        id: v.id,
        n: v.n,
        note: v.note,
        createdAt: v.createdAt,
        publishedByBotId: v.publishedByBotId,
        active: v.id === a.activeVersionId,
        tools: v.manifest.tools.length,
      })),
      manifest: active?.manifest ?? null,
      policies: Object.fromEntries(
        (active?.manifest.tools ?? []).map((t) => [
          t.name,
          describePolicy(t.kind, t.approval, a.settings.toolPolicy?.[t.name]),
        ]),
      ),
    };
  }

  /** Tools of the apps the caller may use, found by words in the name, the description and the app. `only` limits the apps (a bot's grants). */
  async function search(actor: ActiveActor, query: string, only?: readonly string[]) {
    const words = query.toLowerCase().split(/\s+/).filter(Boolean).slice(0, 8);
    const apps = (await list(actor)).filter((a) => !only || only.includes(a.id));
    const rows = apps.length
      ? await db
          .select()
          .from(app)
          .where(
            inArray(
              app.id,
              apps.map((a) => a.id),
            ),
          )
      : [];
    const versions = rows.some((r) => r.activeVersionId)
      ? await db
          .select({ id: appVersion.id, manifest: appVersion.manifest })
          .from(appVersion)
          .where(
            inArray(
              appVersion.id,
              rows.flatMap((r) => (r.activeVersionId ? [r.activeVersionId] : [])),
            ),
          )
      : [];
    const manifests = new Map(versions.map((v) => [v.id, v.manifest]));
    const hits: {
      path: string;
      app: string;
      tool: string;
      kind: AppToolKind;
      description: string;
      policy: string;
      needsAccounts: string[];
    }[] = [];
    for (const r of rows) {
      const m = r.activeVersionId ? manifests.get(r.activeVersionId) : undefined;
      for (const t of m?.tools ?? []) {
        const hay = `${r.slug} ${r.name} ${t.name} ${t.description}`.toLowerCase();
        if (words.every((w) => hay.includes(w)))
          hits.push({
            path: `apps.${r.slug}.${t.name}`,
            app: r.slug,
            tool: t.name,
            kind: t.kind,
            description: t.description,
            policy: describePolicy(t.kind, t.approval, r.settings.toolPolicy?.[t.name]),
            needsAccounts: t.accounts,
          });
      }
    }
    return hits;
  }

  /**
   * The page of an app, for the web app to draw in a sandboxed frame. The tools are the only ones the frame may call (the web app checks
   * every message against them, and the server checks every call again). The page is the version's: it never changes under a viewer.
   */
  async function pageOf(actor: ActiveActor, ref: string) {
    const a = await resolve(actor, ref);
    const v = await activeVersion(a);
    if (!v.ui) throw new AppError("NOT_FOUND", `${a.name} has no page.`);
    return {
      app: a.slug,
      name: a.name,
      version: v.n,
      html: v.ui,
      tools: v.manifest.tools.map((t) => ({
        name: t.name,
        kind: t.kind,
        description: t.description,
      })),
    };
  }

  /**
   * What the app keeps, for its Data page. Each collection the active version declares, with the caller's own records (or the shared ones)
   * as numbers. The owner also sees how many records other people hold, never their content.
   */
  async function dataOf(actor: ActiveActor, ref: string) {
    const a = await resolve(actor, ref);
    const v = await activeVersion(a);
    const isOwner = a.ownerUserId === actor.userId;
    const rows = await summarize(db, a.id, actor.userId, isOwner);
    const declared = new Map<string, "personal" | "shared">();
    for (const t of v.manifest.tools) {
      for (const c of t.storage?.collections ?? []) declared.set(c, "personal");
      for (const c of t.storage?.shared ?? []) declared.set(c, "shared");
    }
    // Records of a collection an older version declared still count: they are the person's data.
    for (const r of rows)
      if (!declared.has(r.collection))
        declared.set(r.collection, r.scope === "shared" ? "shared" : "personal");
    const collections = [...declared]
      .sort((x, y) => x[0].localeCompare(y[0]))
      .map(([name, kind]) => {
        const of = (scope: string) => rows.find((r) => r.collection === name && r.scope === scope);
        const own = of(kind === "shared" ? "shared" : "mine");
        return {
          name,
          kind,
          records: own?.records ?? 0,
          bytes: own?.bytes ?? 0,
          ...(isOwner && kind === "personal" && { otherRecords: of("others")?.records ?? 0 }),
        };
      });
    return { app: a.slug, collections };
  }

  /**
   * Deletes what the app keeps. `mine`: the caller's own records. `all` (owner only): every record of every person, shared ones included.
   * Versions and rollbacks never do this; only this does.
   */
  async function clearData(actor: ActiveActor, ref: string, scope: "mine" | "all") {
    const a = scope === "all" ? await owned(actor, ref) : await resolve(actor, ref);
    const where =
      scope === "all"
        ? eq(appRecord.appId, a.id)
        : and(eq(appRecord.appId, a.id), eq(appRecord.userId, actor.userId));
    const removed = await db.delete(appRecord).where(where).returning({ id: appRecord.id });
    await audit(db, actor.userId, {
      kind: "tool_call",
      outcome: "ok",
      subjectId: a.id,
      detail: auditToolDetail("app", `data.clear.${scope}`),
    });
    tell(actor.userId, a.ownerUserId);
    return { removed: removed.length };
  }

  async function describeTool(actor: ActiveActor, ref: string, tool: string) {
    const a = await resolve(actor, ref);
    const v = await activeVersion(a);
    const t = v.manifest.tools.find((x) => x.name === tool);
    if (!t) throw new AppError("NOT_FOUND", `${a.name} has no tool called ${tool}.`);
    return {
      app: a.slug,
      version: v.n,
      ...t,
      policy: describePolicy(t.kind, t.approval, a.settings.toolPolicy?.[t.name]),
    };
  }

  async function calls(actor: ActiveActor, ref: string, limit = 50) {
    const a = await resolve(actor, ref);
    const mine = a.ownerUserId === actor.userId;
    return db
      .select()
      .from(appCall)
      .where(and(eq(appCall.appId, a.id), mine ? undefined : eq(appCall.actorUserId, actor.userId)))
      .orderBy(desc(appCall.createdAt))
      .limit(Math.min(limit, APP_LIMITS.keepCalls));
  }

  /* --------------------------------------------------------------- owner */

  async function rollback(actor: ActiveActor, ref: string, n: number) {
    const a = await owned(actor, ref);
    const [v] = await db
      .select({ id: appVersion.id })
      .from(appVersion)
      .where(and(eq(appVersion.appId, a.id), eq(appVersion.n, n)));
    if (!v) throw new AppError("NOT_FOUND", `There is no version ${n}.`);
    await db
      .update(app)
      .set({ activeVersionId: v.id, version: sql`${app.version} + 1`, updatedAt: new Date() })
      .where(eq(app.id, a.id));
    tell(actor.userId);
    return get(actor, a.id);
  }

  /** The owner's choice for one tool; `null` goes back to what the tool declares. */
  async function setToolPolicy(
    actor: ActiveActor,
    ref: string,
    tool: string,
    policy: AppToolPolicy | null,
  ) {
    const a = await owned(actor, ref);
    const v = await activeVersion(a);
    if (!v.manifest.tools.some((t) => t.name === tool))
      throw new AppError("NOT_FOUND", `${a.name} has no tool called ${tool}.`);
    const next = { ...a.settings.toolPolicy };
    if (policy) next[tool] = policy;
    else delete next[tool];
    await db
      .update(app)
      .set({
        settings: { ...a.settings, toolPolicy: next },
        version: sql`${app.version} + 1`,
        updatedAt: new Date(),
      })
      .where(eq(app.id, a.id));
    tell(actor.userId);
    return get(actor, a.id);
  }

  async function update(
    actor: ActiveActor,
    ref: string,
    patch: { name?: string; description?: string; visibility?: "private" | "team" },
  ) {
    const a = await owned(actor, ref);
    await db
      .update(app)
      .set({
        ...(patch.name !== undefined && { name: patch.name.trim().slice(0, 120) }),
        ...(patch.description !== undefined && { description: patch.description.slice(0, 500) }),
        ...(patch.visibility !== undefined && { visibility: patch.visibility }),
        version: sql`${app.version} + 1`,
        updatedAt: new Date(),
      })
      .where(eq(app.id, a.id));
    tell(actor.userId);
    return get(actor, a.id);
  }

  async function archive(actor: ActiveActor, ref: string) {
    const a = await owned(actor, ref);
    await db.update(app).set({ status: "archived", updatedAt: new Date() }).where(eq(app.id, a.id));
    await db.delete(botApp).where(eq(botApp.appId, a.id));
    tell(actor.userId);
  }

  /* ------------------------------------------------------------- bot grants */

  async function botOwned(actor: ActiveActor, botId: string) {
    const [b] = await db
      .select({ id: bot.id })
      .from(bot)
      .where(and(eq(bot.id, botId), eq(bot.ownerUserId, actor.userId), eq(bot.archived, false)));
    if (!b) throw new AppError("NOT_FOUND", "No such bot.");
  }
  /** The apps a bot may use (ids), for a person who may see that bot. */
  async function botApps(actor: ActiveActor, botId: string) {
    const rows = await db
      .select({ id: app.id })
      .from(botApp)
      .innerJoin(app, eq(app.id, botApp.appId))
      .where(and(eq(botApp.botId, botId), visible(actor)));
    return rows.map((r) => r.id);
  }
  /** Replaces the apps a bot may use. Only the bot's owner grants, and only apps they may use themselves. */
  async function setBotApps(actor: ActiveActor, botId: string, appIds: string[]) {
    await botOwned(actor, botId);
    const ids = [...new Set(appIds)];
    if (ids.length > APP_LIMITS.appsPerBot)
      throw new AppError("INVALID", `A bot may use at most ${APP_LIMITS.appsPerBot} apps.`);
    const ok = ids.length
      ? await db
          .select({ id: app.id })
          .from(app)
          .where(and(inArray(app.id, ids), visible(actor)))
      : [];
    if (ok.length !== ids.length)
      throw new AppError("NOT_FOUND", "One of those apps is not available.");
    await db.transaction(async (tx) => {
      await tx.delete(botApp).where(eq(botApp.botId, botId));
      if (ids.length) await tx.insert(botApp).values(ids.map((appId) => ({ botId, appId })));
    });
    tell(actor.userId);
    return ids;
  }

  /** The caller's bots that may use an app (ids). The owner of an app sees their own bots; a team member sees theirs. */
  async function appBots(actor: ActiveActor, ref: string) {
    const a = await resolve(actor, ref);
    const rows = await db
      .select({ id: bot.id })
      .from(botApp)
      .innerJoin(bot, eq(bot.id, botApp.botId))
      .where(
        and(eq(botApp.appId, a.id), eq(bot.ownerUserId, actor.userId), eq(bot.archived, false)),
      );
    return rows.map((r) => r.id);
  }
  /**
   * Sets which of the caller's own bots may use an app. Other people's bots are left alone, so a team member can never change what the
   * owner granted. A person grants only apps they may use.
   */
  async function setAppBots(actor: ActiveActor, ref: string, botIds: string[]) {
    const a = await resolve(actor, ref);
    const ids = [...new Set(botIds)];
    if (ids.length > APP_LIMITS.botsPerApp)
      throw new AppError("INVALID", `At most ${APP_LIMITS.botsPerApp} bots may use one app.`);
    const mine = await db
      .select({ id: bot.id })
      .from(bot)
      .where(and(eq(bot.ownerUserId, actor.userId), eq(bot.archived, false)));
    const mineIds = new Set(mine.map((b) => b.id));
    if (ids.some((id) => !mineIds.has(id)))
      throw new AppError("NOT_FOUND", "One of those bots is not yours.");
    await db.transaction(async (tx) => {
      if (mineIds.size)
        await tx
          .delete(botApp)
          .where(and(eq(botApp.appId, a.id), inArray(botApp.botId, [...mineIds])));
      if (ids.length) await tx.insert(botApp).values(ids.map((botId) => ({ botId, appId: a.id })));
    });
    tell(actor.userId);
    return ids;
  }

  /** At the worker tick: calls whose card nobody answered in time. */
  async function expirePending(now = new Date()) {
    const cutoff = new Date(now.getTime() - APP_LIMITS.approvalTtlMs);
    const rows = await db
      .update(appCall)
      .set({ status: "expired", finishedAt: now })
      .where(and(eq(appCall.status, "pending_approval"), sql`${appCall.createdAt} < ${cutoff}`))
      .returning({ actor: appCall.actorUserId });
    if (rows.length) tell(...rows.map((r) => r.actor));
    return rows.length;
  }

  return {
    call,
    answer,
    publish,
    check: assemble,
    /** True when the server can run app code in a container. */
    canContain: () => Boolean(runners.container),
    preview,
    list,
    get,
    search,
    describe: describeTool,
    page: pageOf,
    data: dataOf,
    clearData,
    calls,
    rollback,
    setToolPolicy,
    update,
    archive,
    botApps,
    setBotApps,
    appBots,
    setAppBots,
    expirePending,
  };
}
export type Apps = ReturnType<typeof createApps>;
