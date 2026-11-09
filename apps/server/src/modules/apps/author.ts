import type { ActiveActor } from "../identity/access";
import type { Playground } from "../playground/service";
import { type AppToolArgs, type AppWriteArgs } from "./fields";
import { appGuide } from "./guide";
import { AppError, type Apps } from "./service";

/**
 * How a bot makes an app (the chat tool `zetta:app`). The files go into a playground the person owns (so they can open and edit the code
 * like any other) and are then published as an app version.
 *
 * Where the code runs decides whether the person must say yes first. Describing an app RUNS its code, and code on the host is not
 * sandboxed, so for a new or changed backend on the host runner nothing runs until the person approves a card. In a container, or for a
 * page with no backend (building a page runs nothing), the bot publishes straight away and gets every error back to fix.
 */
export type AuthorContext = { botId: string; conversationId?: string | null };
export type AuthorResult =
  | {
      status: "published";
      app: { id: string; slug: string; name: string };
      version: number;
      tools: string[];
      page: boolean;
      changes: { added: string[]; removed: string[]; changed: string[] };
    }
  | {
      /** Nothing ran and nothing was written: the person has to approve a card first. */
      status: "needs_approval";
      title: string;
      files: string[];
      reason: string;
    }
  | { status: "archived"; slug: string }
  | { status: "guide"; text: string }
  | {
      status: "read";
      app: { id: string; slug: string; name: string; description: string; version: number | null };
      files: { path: string; content: string }[];
      tools: { name: string; kind: string; description: string }[];
      page: boolean;
    }
  | {
      status: "listed";
      apps: {
        id: string;
        slug: string;
        name: string;
        version: number | null;
        tools: number;
        page: boolean;
      }[];
    };

const BACKEND = "index.ts";
const PAGE = "ui/index.html";

export function createAppAuthor(deps: { apps: Apps; playgrounds: Playground }) {
  const { apps, playgrounds } = deps;

  const sourceOf = (files: readonly { path: string }[]) => {
    const backend = files.some((f) => f.path === BACKEND);
    const page = files.some((f) => f.path === PAGE);
    if (!backend && !page)
      throw new AppError(
        "INVALID",
        `An app needs ${BACKEND} (the backend: export default defineApp({...}) from "zetta-app") and/or ${PAGE} (the page).`,
      );
    return { backend, page };
  };
  /** A new app's backend runs in a container when the server has one; otherwise on the host, behind the person's approval. */
  const runnerForNew = (backend: boolean) =>
    !backend
      ? ("browser" as const)
      : apps.canContain()
        ? ("container" as const)
        : ("host" as const);

  async function create(
    actor: ActiveActor,
    a: Extract<AppWriteArgs, { action: "create" }>,
    ctx: AuthorContext,
    approved: boolean,
  ): Promise<AuthorResult> {
    const { backend } = sourceOf(a.files);
    const runner = runnerForNew(backend);
    const src = {
      language: backend ? ("typescript" as const) : ("html" as const),
      runner,
      entry: backend ? BACKEND : PAGE,
    };
    // Safe to run now: a page is only built, and a container is isolated. Host code waits for the person.
    const safe = !backend || runner === "container";
    await apps.check(actor, src, a.files, { describe: safe });
    if (!safe && !approved)
      return {
        status: "needs_approval",
        title: a.title,
        files: a.files.map((f) => f.path),
        reason: "The backend would run on the server host, which is not sandboxed.",
      };
    const p = await playgrounds.create(
      actor,
      {
        title: a.title,
        language: src.language,
        runner: src.runner,
        entry: src.entry,
        files: a.files,
      },
      { botId: ctx.botId, conversationId: ctx.conversationId ?? null },
    );
    try {
      const r = await apps.publish(actor, {
        playgroundId: p.id,
        name: a.title,
        note: a.note,
        botId: ctx.botId,
      });
      if (a.description) await apps.update(actor, r.app.slug, { description: a.description });
      return published(r);
    } catch (e) {
      // Do not leave a half-made playground behind a publish that failed.
      await playgrounds.archive(actor, p.id).catch(() => undefined);
      throw e;
    }
  }

  async function update(
    actor: ActiveActor,
    a: Extract<AppWriteArgs, { action: "update" }>,
    ctx: AuthorContext,
    approved: boolean,
  ): Promise<AuthorResult> {
    const detail = await apps.get(actor, a.app);
    if (!detail.isOwner) throw new AppError("FORBIDDEN");
    if (!detail.sourcePlaygroundId)
      throw new AppError("INVALID", "This app has no source playground to change.");
    const p = await playgrounds.get(actor, detail.sourcePlaygroundId);
    const before = new Map(p.files.map((f) => [f.path, f.content]));
    const next = new Map(before);
    for (const path of a.remove ?? []) next.delete(path);
    for (const f of a.files ?? []) next.set(f.path, f.content);
    const files = [...next].map(([path, content]) => ({ path, content }));
    const { backend } = sourceOf(files);
    // Only the page changed: the code that already ran (and was approved) is the same, so nothing new runs.
    const changed = [...new Set([...before.keys(), ...next.keys()])].filter(
      (path) => before.get(path) !== next.get(path),
    );
    const backendChanged = changed.some((path) => !path.startsWith("ui/"));
    const safe = !backend || p.runner === "container" || !backendChanged;
    await apps.check(actor, { language: p.language, runner: p.runner, entry: p.entry }, files, {
      describe: safe,
    });
    if (!safe && !approved)
      return {
        status: "needs_approval",
        title: a.title ?? detail.name,
        files: changed,
        reason: "The changed backend would run on the server host, which is not sandboxed.",
      };
    if (changed.length || a.title)
      await playgrounds.update(actor, p.id, p.version, {
        files,
        ...(a.title && { title: a.title }),
      });
    const r = await apps.publish(actor, { playgroundId: p.id, note: a.note, botId: ctx.botId });
    if (a.description !== undefined)
      await apps.update(actor, r.app.slug, { description: a.description });
    if (a.title) await apps.update(actor, r.app.slug, { name: a.title });
    return published(r);
  }

  const published = (r: Awaited<ReturnType<Apps["publish"]>>): AuthorResult => ({
    status: "published",
    app: { id: r.app.id, slug: r.app.slug, name: r.app.name },
    version: r.version.n,
    tools: r.manifest.tools.map((t) => t.name),
    page: Boolean(r.manifest.ui),
    changes: {
      added: r.changes.added,
      removed: r.changes.removed,
      changed: r.changes.changed.map((c) => `${c.name} (${c.what.join(", ")})`),
    },
  });

  return {
    /** `approved`: the person already said yes on a card, so host code may run now. */
    async run(
      actor: ActiveActor,
      args: AppToolArgs,
      ctx: AuthorContext,
      approved = false,
    ): Promise<AuthorResult> {
      if (args.action === "guide") return { status: "guide", text: appGuide() };
      if (args.action === "create") return create(actor, args, ctx, approved);
      if (args.action === "update") return update(actor, args, ctx, approved);
      if (args.action === "list") {
        const all = await apps.list(actor);
        return {
          status: "listed",
          apps: all
            .filter((x) => x.ownerUserId === actor.userId)
            .map((x) => ({
              id: x.id,
              slug: x.slug,
              name: x.name,
              version: x.version,
              tools: x.tools,
              page: Boolean(x.ui),
            })),
        };
      }
      const detail = await apps.get(actor, args.app);
      if (!detail.isOwner) throw new AppError("FORBIDDEN");
      if (args.action === "archive") {
        await apps.archive(actor, detail.id);
        return { status: "archived", slug: detail.slug };
      }
      const files = detail.sourcePlaygroundId
        ? (await playgrounds.get(actor, detail.sourcePlaygroundId)).files.map((f) => ({
            path: f.path,
            content: f.content,
          }))
        : [];
      return {
        status: "read",
        app: {
          id: detail.id,
          slug: detail.slug,
          name: detail.name,
          description: detail.description,
          version: detail.version,
        },
        files,
        tools: (detail.manifest?.tools ?? []).map((t) => ({
          name: t.name,
          kind: t.kind,
          description: t.description,
        })),
        page: Boolean(detail.manifest?.ui),
      };
    },
  };
}
export type AppAuthor = ReturnType<typeof createAppAuthor>;
