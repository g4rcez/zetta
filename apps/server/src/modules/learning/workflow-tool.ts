import { z } from "zod";
import type { Lessons, LessonView } from "./lessons";
import type { Progress } from "./progress";

/**
 * The `lessons` tool of a workflow's `zetta` step (features/workflow.ts): what a weekly check of the bots' lessons needs. `list` and
 * `stats` only read; `keep`, `drop` and `restore` change a lesson, so the workflow must have an approval step right before them (the
 * same rule as every other tool that changes something). Nothing here ever deletes: a dropped lesson is archived, with a way back.
 */

export const LESSON_TOOLS = {
  list: "read",
  stats: "read",
  keep: "write",
  drop: "write",
  restore: "write",
  /** A lesson that waits for the person starts on trial, or is turned down. Only the Chief's block uses these. */
  accept: "write",
  reject: "write",
} as const;
export type LessonTool = keyof typeof LESSON_TOOLS;
/** A loop body cannot hold an approval, so the writes take every id at once. */
const MAX_IDS = 20;
const MAX_LIST = 50;
const UUID = /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/gi;

const listArgs = z.strictObject({
  bot: z.string().uuid().optional(),
  status: z.enum(["waiting", "trial", "kept", "dropped", "all"]).optional(),
  label: z.enum(["helps", "unclear", "hurts", "unused"]).optional(),
  limit: z.number().int().min(1).max(MAX_LIST).optional(),
});
const statsArgs = z.strictObject({ bot: z.string().uuid() });

/** The ids a write works on: a list, or text that holds them (a previous answer, a line each, commas...). Anything else in the text is ignored. */
export function idsOf(v: unknown): string[] {
  const raw = Array.isArray(v) ? v.map(String).join("\n") : typeof v === "string" ? v : "";
  return [...new Set((raw.match(UUID) ?? []).map((x) => x.toLowerCase()))];
}

const clip = (t: string, n = 110) => (t.length > n ? `${t.slice(0, n - 1)}…` : t);

function line(l: LessonView) {
  const r = l.results;
  const used = r ? `${r.label}: ${r.reason}` : "not used yet";
  return `${l.id} | ${l.status} | ${used} | “${clip(l.text)}”`;
}

export class LessonToolError extends Error {
  constructor(readonly safe: string) {
    super(safe);
  }
}

export function createLessonTools(deps: { lessons: Lessons; progress: Progress }) {
  return {
    /** Whether a tool only reads. An unknown tool counts as a write, so it can never skip the approval step. */
    effect(tool: string): "read" | "write" {
      return LESSON_TOOLS[tool as LessonTool] === "read" ? "read" : "write";
    },

    async call(owner: string, tool: string, args: Record<string, unknown>): Promise<string> {
      if (!(tool in LESSON_TOOLS)) throw new LessonToolError("unknown_tool");
      if (tool === "list") {
        const a = listArgs.parse(args);
        // Without a status: what is in use (on trial or kept). What was dropped or is still waiting is asked for by name.
        const wanted = a.status ? [a.status] : (["trial", "kept"] as const);
        const rows = (
          await Promise.all(
            wanted.map((status) =>
              deps.lessons.list(owner, { status, ...(a.bot ? { bot: a.bot } : {}) }),
            ),
          )
        )
          .flat()
          .filter((l) => !a.label || l.results?.label === a.label);
        const shown = rows.slice(0, a.limit ?? MAX_LIST);
        if (!shown.length) return "No lessons match.";
        return [
          `${shown.length}${rows.length > shown.length ? ` of ${rows.length}` : ""} lessons (id | status | what happened after it was used | text):`,
          ...shown.map(line),
        ].join("\n");
      }
      if (tool === "stats") {
        const { bot } = statsArgs.parse(args);
        const p = await deps.progress.weekly(owner, bot);
        const side = (s: typeof p.recent) =>
          s ? `${s.per100} per 100 replies (${s.stepIns} of ${s.replies})` : "not enough replies";
        return [
          `Times the person stepped in: last four weeks ${side(p.recent)}; the four weeks before ${side(p.earlier)}.`,
          `Lessons: on trial ${p.lessons.trial}, kept ${p.lessons.kept}, dropped ${p.lessons.dropped}, waiting ${p.lessons.waiting}.`,
        ].join("\n");
      }
      const ids = idsOf(args.ids);
      if (!ids.length) throw new LessonToolError("no_ids");
      if (ids.length > MAX_IDS) throw new LessonToolError("too_many_ids");
      const out: string[] = [];
      for (const id of ids) {
        try {
          if (tool === "keep") await deps.lessons.keep(owner, id, "person");
          else if (tool === "restore") await deps.lessons.restore(owner, id, "person");
          else if (tool === "accept") await deps.lessons.accept(owner, id);
          else if (tool === "reject") await deps.lessons.reject(owner, id, "person");
          else await deps.lessons.drop(owner, id, "person", "person", "dropped in a lesson check");
          out.push(`${id}: done`);
        } catch (e) {
          // One that cannot be done (it is not the person's, or already is what was asked) does not stop the others.
          out.push(`${id}: not done (${e instanceof Error ? e.message : "failed"})`);
        }
      }
      return out.join("\n");
    },
  };
}
export type LessonTools = ReturnType<typeof createLessonTools>;
