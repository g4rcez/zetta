import { botImportDraftSchema, type BotImportDraft } from "../../bots/import/draft";
import { ImportError } from "../../bots/import/errors";
import { createBotImport, type BotImport } from "../../bots/import/service";
import { describeSchedule, validTimezone } from "../../features/schedule";
import { plan, short } from "./resolve";
import type { ChiefArgs } from "./schemas";
import type { Applied, ApplyCtx, ChiefCtx, ChiefDeps, DiffLine, Outcome } from "./types";

/**
 * `zetta:import_bot`: a bot from the Grok Bot marketplace. `preview` reads the listing. `install` has the person's own engine adapt it
 * and proposes the result as a card that lists everything it would create; only Approve creates anything, and it creates exactly
 * what the card showed (the draft is kept in the proposal, so approving does not ask the engine again).
 */

/** Built per call from the services Chief already holds, so there is no second wiring to keep in step. */
function importer(deps: ChiefDeps): BotImport | undefined {
  const { botImport, skills, memory, routines } = deps;
  if (!botImport || !skills || !memory || !routines) return undefined;
  return createBotImport({
    db: deps.db,
    chat: deps.chat,
    skills,
    memory,
    routines,
    source: botImport.source,
    analyzer: botImport.analyzer,
  });
}

const routineWords = (r: BotImportDraft["routines"][number], timezone: string) => {
  const s = r.schedule;
  const when =
    s.kind === "daily"
      ? describeSchedule({ timezone, dailyAt: s.dailyAt, weekdays: s.weekdays, everyMinutes: null })
      : s.kind === "interval"
        ? describeSchedule({ timezone, dailyAt: null, everyMinutes: s.everyMinutes })
        : "no schedule Zetta can run";
  return `${r.title}: ${when}, ${r.state === "active" ? "switched on" : `paused${r.note ? ` (${r.note})` : ""}`}`;
};

/** What the card shows: every part of the draft, so approving is an informed yes. */
function diffOf(d: BotImportDraft): DiffLine[] {
  const line = (field: string, to: unknown): DiffLine => ({ field, from: null, to });
  return [
    line("bot", `${d.name}, by ${d.source.creator || "an unknown creator"} (${d.source.url})`),
    line("description", short(d.description)),
    ...(d.personality ? [line("personality", short(d.personality))] : []),
    line("instructions", short(d.instructions)),
    ...d.skills.map((s) =>
      line(
        "skill",
        short(
          `${s.name}: ${s.description}${s.warnings.length ? ` [${s.warnings.join(", ")}]` : ""}`,
        ),
      ),
    ),
    ...d.notes.map((n) => line("note", short(n.content, 200))),
    ...d.routines.map((r) => line("routine", routineWords(r, d.timezone))),
    ...d.integrations.map((i) =>
      line(
        "needs setup",
        i.pluginId
          ? `${i.name}: connect the ${i.pluginId} plugin`
          : `${i.name}: no Zetta equivalent`,
      ),
    ),
    ...d.warnings.map((w) => line("note to you", w)),
  ];
}

export async function runImportBot(ctx: ChiefCtx, a: ChiefArgs<"import_bot">): Promise<Outcome> {
  const imp = importer(ctx.deps);
  if (!imp) return { error: "importing bots is not available on this server." };
  try {
    if (a.action === "preview") {
      const p = await imp.preview(a.source);
      return {
        read: `import_bot.preview:\n${JSON.stringify({
          name: p.name,
          creator: p.creatorName,
          description: short(p.description, 600),
          skills: p.skills.map((s) => ({ name: s.name, description: short(s.description, 200) })),
          notes: p.memories.length,
          routines: p.routines.map((r) => ({ name: r.name, schedule: r.schedule })),
          integrations: p.integrations.map((i) => ({ name: i.name, zettaPlugin: i.pluginId })),
          url: p.url,
        })}`,
      };
    }
    if (!validTimezone(a.timezone))
      return { error: `"${a.timezone}" is not an IANA timezone (for example America/Sao_Paulo).` };
    const draft = await imp.analyze(ctx.actor.userId, a.source, { timezone: a.timezone });
    return plan(`Import ${draft.name} from the Grok Bot marketplace`, diffOf(draft), {
      tool: "import_bot",
      op: "install",
      draft,
    });
  } catch (e) {
    // A reason a person can act on (not signed in to an engine, a bad link, the site changed): the chief passes it on.
    if (e instanceof ImportError) return { error: e.message };
    throw e;
  }
}

export async function applyImportBot(ctx: ApplyCtx, p: Record<string, unknown>): Promise<Applied> {
  const imp = importer(ctx.deps);
  if (!imp) throw new Error("bot import unavailable");
  // The proposal's draft is read back through the same schema the install checks, so an old or edited row cannot slip past it.
  const draft = botImportDraftSchema.parse(p.draft);
  const r = await imp.install(ctx.actor, draft);
  const paused = r.routines.filter((x) => x.state === "paused");
  return [
    `Created ${r.bot.name} with ${r.skills.length} skill${r.skills.length === 1 ? "" : "s"}, ${r.notes} note${r.notes === 1 ? "" : "s"} and ${r.routines.length} routine${r.routines.length === 1 ? "" : "s"}.`,
    paused.length
      ? `Paused: ${paused.map((x) => `${x.title}${x.reason ? ` (${x.reason})` : ""}`).join("; ")}.`
      : "",
    r.integrations.length
      ? `It needs: ${r.integrations.map((i) => (i.pluginId ? `${i.name} (the ${i.pluginId} plugin)` : `${i.name} (no Zetta equivalent)`)).join(", ")}.`
      : "",
  ]
    .filter(Boolean)
    .join(" ");
}
