import { topics } from "@zetta/core/live-topics";
import { hasKeyFormat } from "@zetta/core/secrets";
import type { Database } from "@zetta/db";
import { and, asc, desc, eq, getTableColumns, or, sql } from "@zetta/db/query";
import { user } from "@zetta/db/schema/auth";
import {
  PLAYGROUND_LANGUAGES,
  playground,
  playgroundFile,
  playgroundRun,
  playgroundRunOutput,
  type PlaygroundInputSpec,
} from "@zetta/db/schema/playground";
import { createLimiter, HarnessError } from "../chat/harness";
import { events } from "../events/bus";
import { audit } from "../features/audit";
import type { ActiveActor } from "../identity/access";
import type { PlaygroundFields, PlaygroundPatch } from "./fields";
import { hostVersion, LANGUAGES, PLAYGROUND_LIMITS } from "./languages";
import { hostRunner } from "./runner-host";
import { buildBrowser } from "./build-browser";
import { PlaygroundError, type Runner, type RunResult } from "./types";

export const PER_OWNER = 200;
export { PlaygroundError };
export { playgroundFields, playgroundPatch } from "./fields";

const bytes = (s: string) => Buffer.byteLength(s);

/** A value of an input, checked against its type. Throws INVALID with the input's name. */
function coerce(spec: Pick<PlaygroundInputSpec, "name" | "type">, v: unknown): unknown {
  const bad = (what: string) =>
    new PlaygroundError("INVALID", `Input "${spec.name}" must be ${what}.`);
  if (spec.type === "string") {
    if (typeof v !== "string" || v.length > 10_000) throw bad("text of up to 10000 characters");
  } else if (spec.type === "number") {
    if (typeof v !== "number" || !Number.isFinite(v)) throw bad("a number");
  } else if (spec.type === "boolean") {
    if (typeof v !== "boolean") throw bad("true or false");
  } else if (v === undefined) throw bad("JSON");
  return v;
}

/** The cross-field rules of a playground: entry among the files, a runner that fits the language, sizes, and no pasted key. */
function check(f: {
  title: string;
  language: PlaygroundFields["language"];
  runner: NonNullable<PlaygroundFields["runner"]>;
  entry: string;
  files: PlaygroundFields["files"];
  inputs: PlaygroundInputSpec[];
}) {
  if (!LANGUAGES[f.language].runners.includes(f.runner))
    throw new PlaygroundError(
      "INVALID",
      `${LANGUAGES[f.language].label} cannot run with the ${f.runner} runner.`,
    );
  const paths = new Set<string>();
  for (const file of f.files) {
    if (paths.has(file.path))
      throw new PlaygroundError("INVALID", `The file ${file.path} appears twice.`);
    paths.add(file.path);
    if (file.content.includes("\0"))
      throw new PlaygroundError("INVALID", `The file ${file.path} is not text.`);
  }
  if (!paths.has(f.entry))
    throw new PlaygroundError("INVALID", `The entry file ${f.entry} is not one of the files.`);
  if (f.files.reduce((n, file) => n + bytes(file.content), 0) > PLAYGROUND_LIMITS.sourceBytes)
    throw new PlaygroundError("TOO_LARGE", "The files are over 1 MB together.");
  const names = new Set<string>();
  for (const i of f.inputs) {
    if (names.has(i.name))
      throw new PlaygroundError("INVALID", `The input ${i.name} appears twice.`);
    names.add(i.name);
    if (i.default !== undefined) coerce(i, i.default);
  }
  // A pasted key would go to everyone the playground is shared with. Credential formats only: code is full of `token = ...`.
  const text = [f.title, ...f.files.map((x) => x.content), JSON.stringify(f.inputs)].join("\n");
  if (hasKeyFormat(text)) throw new PlaygroundError("SECRET_REJECTED");
}

/** The values of a run: each declared input from the caller, else its default. A name that is not declared is refused. */
export function resolveInputs(
  specs: readonly PlaygroundInputSpec[],
  given: Record<string, unknown> = {},
) {
  const known = new Set(specs.map((s) => s.name));
  for (const key of Object.keys(given))
    if (!known.has(key))
      throw new PlaygroundError("INVALID", `The playground has no input named ${key}.`);
  const values: Record<string, unknown> = {};
  for (const s of specs) {
    const v = given[s.name] ?? s.default;
    if (v !== undefined) values[s.name] = coerce(s, v);
  }
  if (bytes(JSON.stringify(values)) > PLAYGROUND_LIMITS.inputsBytes)
    throw new PlaygroundError("TOO_LARGE", "The inputs are over 64 KB.");
  return values;
}

export type PlaygroundDeps = {
  runners?: Partial<Record<"host" | "container", Runner>>;
  /** At most this many runs at once, in all and per person. A run over the limit is refused, never queued. */
  limits?: { global: number; perUser: number };
};
/** Where a bot made the playground or the run. */
export type Origin = { botId?: string | null; conversationId?: string | null };

const listColumns = {
  id: playground.id,
  title: playground.title,
  language: playground.language,
  runner: playground.runner,
  visibility: playground.visibility,
  ownerUserId: playground.ownerUserId,
  ownerName: user.name,
  createdByBotId: playground.createdByBotId,
  version: playground.version,
  createdAt: playground.createdAt,
  updatedAt: playground.updatedAt,
};
const {
  stdout: _stdout,
  stderr: _stderr,
  files: _files,
  ...runSummary
} = getTableColumns(playgroundRun);

/**
 * Playgrounds: saved code that people and bots run (see docs/decisions/playground.md). The owner reads, edits, runs and archives one.
 * With `team` visibility every member reads, runs and forks it. A playground that is not readable to the caller is NOT_FOUND.
 * Archive, never delete: the row and its runs stay.
 */
export function createPlayground(db: Database, deps: PlaygroundDeps = {}) {
  const runners: Partial<Record<"host" | "container", Runner>> = {
    host: hostRunner,
    ...deps.runners,
  };
  const limiter = createLimiter({ ...(deps.limits ?? { global: 4, perUser: 2 }), waitMs: 0 });
  /** The runs of this process that can still be cancelled. */
  const live = new Map<string, AbortController>();

  const readable = (actor: ActiveActor) =>
    and(
      eq(playground.status, "active"),
      or(eq(playground.ownerUserId, actor.userId), eq(playground.visibility, "team")),
    );

  async function load(actor: ActiveActor, id: string) {
    const [row] = await db
      .select({ ...getTableColumns(playground), ownerName: user.name })
      .from(playground)
      .innerJoin(user, eq(user.id, playground.ownerUserId))
      .where(and(eq(playground.id, id), readable(actor)));
    if (!row) throw new PlaygroundError("NOT_FOUND");
    return row;
  }
  async function loadOwned(actor: ActiveActor, id: string) {
    const row = await load(actor, id);
    if (row.ownerUserId !== actor.userId) throw new PlaygroundError("FORBIDDEN");
    return row;
  }
  const filesOf = (id: string) =>
    db
      .select({
        path: playgroundFile.path,
        content: playgroundFile.content,
        size: playgroundFile.size,
      })
      .from(playgroundFile)
      .where(eq(playgroundFile.playgroundId, id))
      .orderBy(asc(playgroundFile.path));
  const fileRows = (id: string, files: PlaygroundFields["files"]) =>
    files.map((f) => ({
      playgroundId: id,
      path: f.path,
      content: f.content,
      size: bytes(f.content),
    }));
  const tell = (owner: string, actorId: string, id: string) =>
    events.publish([owner, actorId], topics.playground(id));

  /** The run row for the web: no files and no output text (`getRun` has them). */
  const summary = async (id: string) => {
    const [row] = await db.select(runSummary).from(playgroundRun).where(eq(playgroundRun.id, id));
    return row!;
  };

  async function finish(
    p: { id: string; ownerUserId: string },
    actor: ActiveActor,
    runId: string,
    botId: string | null,
    started: number,
    result: RunResult | { status: "failed"; error: string },
  ) {
    const failedToStart = "error" in result;
    const r: RunResult = failedToStart
      ? {
          status: "failed",
          exitCode: null,
          stdout: "",
          stderr: result.error,
          truncated: false,
          outputs: [],
          runtimeVersion: "",
        }
      : result;
    await db.transaction(async (tx) => {
      await tx
        .update(playgroundRun)
        .set({
          status: r.status,
          exitCode: r.exitCode,
          stdout: r.stdout,
          stderr: r.stderr,
          output: r.truncated ? "truncated" : "complete",
          runtimeVersion: r.runtimeVersion,
          durationMs: Date.now() - started,
          finishedAt: new Date(),
        })
        .where(eq(playgroundRun.id, runId));
      if (r.outputs.length)
        await tx.insert(playgroundRunOutput).values(
          r.outputs.map((o) => ({
            runId,
            path: o.path,
            content: o.content,
            mimeType: o.mimeType,
            size: o.content.length,
          })),
        );
      // Keep the newest runs only.
      const old = sql`(select id from ${playgroundRun} where ${playgroundRun.playgroundId} = ${p.id} order by ${playgroundRun.startedAt} desc offset ${PLAYGROUND_LIMITS.keepRuns})`;
      await tx.delete(playgroundRunOutput).where(sql`${playgroundRunOutput.runId} in ${old}`);
      await tx.delete(playgroundRun).where(sql`${playgroundRun.id} in ${old}`);
    });
    await audit(db, actor.userId, {
      kind: "tool_call",
      outcome:
        r.status === "ok"
          ? "ok"
          : r.status === "timeout"
            ? "timeout"
            : r.status === "cancelled"
              ? "cancelled"
              : "failed",
      botId,
      subjectId: p.id,
      detail: "playground:run",
    });
    tell(p.ownerUserId, actor.userId, p.id);
  }

  async function get(actor: ActiveActor, id: string) {
    const row = await load(actor, id);
    return { ...row, mine: row.ownerUserId === actor.userId, files: await filesOf(id) };
  }

  async function create(actor: ActiveActor, input: PlaygroundFields, origin: Origin = {}) {
    const f = {
      ...input,
      runner:
        input.runner ?? (LANGUAGES[input.language].runners.includes("host") ? "host" : "browser"),
      entry:
        input.entry ??
        (input.files.some((x) => x.path === LANGUAGES[input.language].defaultEntry)
          ? LANGUAGES[input.language].defaultEntry
          : input.files[0]!.path),
      inputs: input.inputs ?? [],
    };
    check(f);
    const [count] = await db
      .select({ n: sql<number>`count(*)::int` })
      .from(playground)
      .where(and(eq(playground.ownerUserId, actor.userId), eq(playground.status, "active")));
    if ((count?.n ?? 0) >= PER_OWNER)
      throw new PlaygroundError(
        "TOO_LARGE",
        `You have ${PER_OWNER} playgrounds. Archive some first.`,
      );
    const id = await db.transaction(async (tx) => {
      const [row] = await tx
        .insert(playground)
        .values({
          ownerUserId: actor.userId,
          title: f.title,
          language: f.language,
          runner: f.runner,
          entry: f.entry,
          inputs: f.inputs,
          visibility: input.visibility ?? "private",
          createdByBotId: origin.botId ?? null,
          conversationId: origin.conversationId ?? null,
        })
        .returning({ id: playground.id });
      await tx.insert(playgroundFile).values(fileRows(row!.id, f.files));
      return row!.id;
    });
    return get(actor, id);
  }

  return {
    get,
    create,
    /** What this server can run: the CLI version on the host per language, and the runners each language allows. */
    async languages() {
      return Promise.all(
        PLAYGROUND_LANGUAGES.map(async (id) => ({
          id,
          label: LANGUAGES[id].label,
          defaultEntry: LANGUAGES[id].defaultEntry,
          runners: LANGUAGES[id].runners,
          hostVersion: await hostVersion(id),
          container: Boolean(runners.container) && LANGUAGES[id].runners.includes("container"),
        })),
      );
    },

    /** `mine`: the caller's playgrounds. `team`: every one shared with the team. The files are left out; `get` has them. */
    async list(actor: ActiveActor, scope: "mine" | "team" = "mine", q?: string) {
      const like = q?.trim() ? `%${q.trim().replace(/[\\%_]/g, "\\$&")}%` : undefined;
      return db
        .select(listColumns)
        .from(playground)
        .innerJoin(user, eq(user.id, playground.ownerUserId))
        .where(
          and(
            eq(playground.status, "active"),
            scope === "mine"
              ? eq(playground.ownerUserId, actor.userId)
              : eq(playground.visibility, "team"),
            like ? sql`${playground.title} ilike ${like}` : undefined,
          ),
        )
        .orderBy(desc(playground.updatedAt))
        .limit(200);
    },

    /** Only the owner edits. `files`, when given, replaces all files. A stale `expectedVersion` is a CONFLICT. */
    async update(actor: ActiveActor, id: string, expectedVersion: number, patch: PlaygroundPatch) {
      const cur = await loadOwned(actor, id);
      const files = patch.files ?? (await filesOf(id));
      const next = {
        title: patch.title ?? cur.title,
        language: patch.language ?? cur.language,
        runner: patch.runner ?? cur.runner,
        entry: patch.entry ?? cur.entry,
        inputs: patch.inputs ?? cur.inputs,
        files,
      };
      check(next);
      await db.transaction(async (tx) => {
        const changed = await tx
          .update(playground)
          .set({
            title: next.title,
            language: next.language,
            runner: next.runner,
            entry: next.entry,
            inputs: next.inputs,
            visibility: patch.visibility ?? cur.visibility,
            version: sql`${playground.version} + 1`,
            updatedAt: new Date(),
          })
          .where(and(eq(playground.id, id), eq(playground.version, expectedVersion)))
          .returning({ id: playground.id });
        if (!changed.length) throw new PlaygroundError("CONFLICT");
        if (patch.files) {
          await tx.delete(playgroundFile).where(eq(playgroundFile.playgroundId, id));
          await tx.insert(playgroundFile).values(fileRows(id, patch.files));
        }
      });
      tell(cur.ownerUserId, actor.userId, id);
      return get(actor, id);
    },

    async archive(actor: ActiveActor, id: string) {
      const cur = await loadOwned(actor, id);
      await db
        .update(playground)
        .set({ status: "archived", version: sql`${playground.version} + 1`, updatedAt: new Date() })
        .where(eq(playground.id, id));
      return { id: cur.id };
    },

    /** A private copy of a playground the caller can read, owned by the caller. */
    async fork(actor: ActiveActor, id: string, origin: Origin = {}) {
      const src = await get(actor, id);
      return create(
        actor,
        {
          title: `${src.title} (copy)`.slice(0, 120),
          language: src.language,
          runner: src.runner,
          entry: src.entry,
          files: src.files.map(({ path, content }) => ({ path, content })),
          inputs: src.inputs,
        },
        origin,
      );
    },

    /**
     * Starts a run of the saved files and returns its row (`running`) with `done`, which settles with the final row. A person's route
     * ignores `done`; a bot's tool waits for it. A run over the concurrency limit is BUSY, not queued.
     */
    async run(
      actor: ActiveActor,
      id: string,
      opts: { inputs?: Record<string, unknown>; timeoutMs?: number; botId?: string | null } = {},
    ) {
      const p = await load(actor, id);
      if (p.runner === "browser")
        throw new PlaygroundError(
          "INVALID",
          "This playground runs in the page. Open it and press Run there.",
        );
      const runner = runners[p.runner];
      if (!runner)
        throw new PlaygroundError(
          "UNAVAILABLE",
          `The ${p.runner} runner is not set up on this server.`,
        );
      const files = (await filesOf(id)).map(({ path, content }) => ({ path, content }));
      const inputs = resolveInputs(p.inputs, opts.inputs);
      const timeoutMs = Math.min(
        opts.timeoutMs ?? PLAYGROUND_LIMITS.timeoutMs,
        PLAYGROUND_LIMITS.maxTimeoutMs,
      );

      let release: () => void;
      try {
        release = await limiter.acquire(actor.userId);
      } catch (e) {
        if (e instanceof HarnessError && e.code === "busy")
          throw new PlaygroundError("BUSY", "Too many runs are going. Try again when one ends.");
        throw e;
      }
      const botId = opts.botId ?? null;
      let runId: string;
      try {
        const [row] = await db
          .insert(playgroundRun)
          .values({
            playgroundId: id,
            actorUserId: actor.userId,
            botId,
            runner: p.runner,
            entry: p.entry,
            files,
            inputs,
          })
          .returning({ id: playgroundRun.id });
        runId = row!.id;
      } catch (e) {
        release();
        throw e;
      }
      const controller = new AbortController();
      live.set(runId, controller);
      tell(p.ownerUserId, actor.userId, id);
      const started = Date.now();
      const done = (async () => {
        try {
          const result = await runner(
            { language: p.language, entry: p.entry, files, inputs, timeoutMs },
            controller.signal,
          );
          await finish(p, actor, runId, botId, started, result);
        } catch (e) {
          const why =
            e instanceof PlaygroundError ? (e.detail ?? e.code) : "The run failed to start.";
          await finish(p, actor, runId, botId, started, { status: "failed", error: why });
        } finally {
          live.delete(runId);
          release();
        }
        return summary(runId);
      })();
      // A failed write while finishing must not become an unhandled rejection; the boot sweep marks the run interrupted.
      done.catch((e) =>
        console.error(
          `playground: finish failed name=${(e as Error | undefined)?.name ?? typeof e}`,
        ),
      );
      return { run: await summary(runId), done };
    },

    /**
     * Builds a browser playground into one HTML page for the iframe. `files` and `entry` are the draft on screen, so unsaved edits show;
     * without them the saved ones are used. A build holds a run slot while it bundles.
     */
    async build(
      actor: ActiveActor,
      id: string,
      draft: {
        files?: PlaygroundFields["files"];
        entry?: string;
        inputs?: Record<string, unknown>;
      } = {},
    ) {
      const p = await load(actor, id);
      if (p.runner !== "browser")
        throw new PlaygroundError("INVALID", "This playground runs on the server. Use Run.");
      const files =
        draft.files ?? (await filesOf(id)).map(({ path, content }) => ({ path, content }));
      const entry = draft.entry ?? p.entry;
      check({
        title: p.title,
        language: p.language,
        runner: p.runner,
        entry,
        files,
        inputs: p.inputs,
      });
      const inputs = resolveInputs(p.inputs, draft.inputs);
      let release: () => void;
      try {
        release = await limiter.acquire(actor.userId);
      } catch (e) {
        if (e instanceof HarnessError && e.code === "busy")
          throw new PlaygroundError("BUSY", "Too many runs are going. Try again when one ends.");
        throw e;
      }
      try {
        return await buildBrowser({ language: p.language, entry, files, inputs });
      } finally {
        release();
      }
    },

    async runs(actor: ActiveActor, id: string) {
      await load(actor, id);
      return db
        .select(runSummary)
        .from(playgroundRun)
        .where(eq(playgroundRun.playgroundId, id))
        .orderBy(desc(playgroundRun.startedAt))
        .limit(PLAYGROUND_LIMITS.keepRuns);
    },

    /** One run with its files, text and the names of its `out/` files. */
    async getRun(actor: ActiveActor, runId: string) {
      const [run] = await db.select().from(playgroundRun).where(eq(playgroundRun.id, runId));
      if (!run) throw new PlaygroundError("NOT_FOUND");
      await load(actor, run.playgroundId);
      const outputs = await db
        .select({
          path: playgroundRunOutput.path,
          mimeType: playgroundRunOutput.mimeType,
          size: playgroundRunOutput.size,
        })
        .from(playgroundRunOutput)
        .where(eq(playgroundRunOutput.runId, runId))
        .orderBy(asc(playgroundRunOutput.path));
      return { ...run, outputs };
    },

    async output(actor: ActiveActor, runId: string, path: string) {
      const [run] = await db
        .select({ playgroundId: playgroundRun.playgroundId })
        .from(playgroundRun)
        .where(eq(playgroundRun.id, runId));
      if (!run) throw new PlaygroundError("NOT_FOUND");
      await load(actor, run.playgroundId);
      const [file] = await db
        .select({ content: playgroundRunOutput.content, mimeType: playgroundRunOutput.mimeType })
        .from(playgroundRunOutput)
        .where(and(eq(playgroundRunOutput.runId, runId), eq(playgroundRunOutput.path, path)));
      if (!file) throw new PlaygroundError("NOT_FOUND");
      return file;
    },

    /** Stops a run that this process started. The runner ends the script and the run settles as `cancelled`. */
    async cancel(actor: ActiveActor, runId: string) {
      const [run] = await db.select().from(playgroundRun).where(eq(playgroundRun.id, runId));
      if (!run) throw new PlaygroundError("NOT_FOUND");
      await load(actor, run.playgroundId);
      if (run.actorUserId !== actor.userId) throw new PlaygroundError("FORBIDDEN");
      const controller = live.get(runId);
      if (!controller) throw new PlaygroundError("CONFLICT");
      controller.abort();
      return { cancelled: true };
    },

    /** At boot: a run still `running` lost its process. Never leave it looking alive. Returns how many. */
    async interruptRunning() {
      const rows = await db
        .update(playgroundRun)
        .set({ status: "interrupted", finishedAt: new Date() })
        .where(eq(playgroundRun.status, "running"))
        .returning({ id: playgroundRun.id });
      return rows.length;
    },
  };
}
export type Playground = ReturnType<typeof createPlayground>;
