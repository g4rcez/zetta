import { addWorkingMs } from "@zetta/core/working-days";
import { mentionToken } from "@zetta/core/mentions";
import {
  ALLOWED_WORK_ACTIONS,
  defaultWorkOptions,
  isWorkCard,
  MANAGER_WORK_KINDS,
  WORK_OPTIONS_MAX,
  type WorkAction,
  type WorkCandidate,
  type WorkCardKind,
  type WorkData,
  type WorkDecision,
  type WorkOption,
  type WorkView,
} from "@zetta/core/work-suggestions";
import type { Database } from "@zetta/db";
import { and, asc, desc, eq, inArray, isNotNull, ne } from "@zetta/db/query";
import { bot, conversation } from "@zetta/db/schema/chat";
import { attentionItem } from "@zetta/db/schema/features";
import { projectMember } from "@zetta/db/schema/projects";
import type { WorkWatchKind } from "@zetta/db/schema/work";
import type { DiscussionStore } from "../discussions/store";
import { raiseAttention } from "../features/attention";
import { AccessError, type ActiveActor } from "../identity/access";
import { chatWith, sayInChat, type BotChat } from "../projects/work";
import type { TaskStore } from "../tasks/store";
import { createTeamPeople } from "../teams/people";
import { blockedText, nudgeText, raiseWork, stuckText, workKey } from "./cards";
import { factsOf, fingerprintOf, loadFacts, type TaskFacts } from "./facts";
import { ACCEPTED_MS, MORE_TIME_MS, PERSON_IDLE_MS } from "./thresholds";
import { createWorkWatch } from "./watch";

type CardRow = typeof attentionItem.$inferSelect;

/** The person asked for something the card does not offer, or left out what the step needs. The message is shown as it is. */
export class WorkError extends Error {
  constructor(
    readonly code: "NOT_AN_OPTION" | "INPUT_REQUIRED" | "NO_TASK" | "NOT_POSSIBLE",
    message: string,
  ) {
    super(message);
    this.name = "WorkError";
  }
}

const TEXT_MAX = 4000;
const HISTORY = 3;
const CANDIDATES = 12;
const WATCH_OF: Record<WorkCardKind, WorkWatchKind> = {
  work_stuck: "stuck",
  work_blocked: "blocked",
  work_drift: "drift",
  work_checkin: "checkin",
  work_nudge: "checkin",
};
/** Answers that leave the task as it was: the card stays away for a working day instead of coming back on the next scan. */
const ANSWER_HUSHES: readonly WorkAction[] = ["tell", "resume", "reassign"];
const first = (name: string) => name.trim().split(/\s+/)[0] || name;

export type WorkDeps = {
  db: Database;
  tasks: Pick<TaskStore, "update" | "remove" | "reassign">;
  chat: BotChat;
  discussions: Pick<DiscussionStore, "byConversation" | "postAsOwner">;
  /** A card for a manager was raised: whoever writes suggestions reads the task now. A failing listener never breaks the card. */
  onRaised?: (cardId: string) => void;
  now?: () => Date;
};

/**
 * What the buttons of a work card do (core/work-suggestions.ts), and the same steps offered outside a card ("Tell them…" on a project
 * page). Every step returns one sentence that says what happened, for the person who pressed the button.
 */
export function createWorkActions(deps: WorkDeps) {
  const { db, tasks, chat, discussions } = deps;
  const now = deps.now ?? (() => new Date());
  const watch = createWorkWatch(db);
  const people = createTeamPeople(db);

  /** Who a task could be given to: the others on its project, or (outside a project) the owner's other bots and team people. */
  async function candidatesFor(f: TaskFacts): Promise<WorkCandidate[]> {
    const owner = f.task.ownerUserId;
    const [bots, persons] = await Promise.all([
      f.project
        ? db
            .select({ id: bot.id, name: bot.name })
            .from(projectMember)
            .innerJoin(bot, eq(bot.id, projectMember.botId))
            .where(
              and(
                eq(projectMember.projectId, f.project.id),
                eq(projectMember.kind, "bot"),
                eq(bot.archived, false),
              ),
            )
            .orderBy(asc(bot.name))
        : db
            .select({ id: bot.id, name: bot.name })
            .from(bot)
            .where(and(eq(bot.ownerUserId, owner), eq(bot.archived, false)))
            .orderBy(asc(bot.name))
            .limit(CANDIDATES),
      people.ofOwner(owner),
    ]);
    const onProject = f.project
      ? new Set(
          (
            await db
              .select({ userId: projectMember.userId })
              .from(projectMember)
              .where(
                and(eq(projectMember.projectId, f.project.id), eq(projectMember.kind, "person")),
              )
          ).map((r) => r.userId),
        )
      : undefined;
    const current = f.worker ? `${f.worker.kind}:${f.worker.id}` : "";
    return [
      ...bots.map((b) => ({ key: `bot:${b.id}`, kind: "bot" as const, name: b.name })),
      ...persons
        .filter((p) => !onProject || onProject.has(p.userId))
        .map((p) => ({ key: `person:${p.userId}`, kind: "person" as const, name: p.name })),
    ]
      .filter((c) => c.key !== current)
      .slice(0, CANDIDATES * 2);
  }

  /** The buttons of a card: what Zetta suggested when that still fits the card, else the usual steps of its kind. */
  function optionsFor(row: Pick<CardRow, "kind" | "work">, f: TaskFacts): WorkOption[] {
    const kind = row.kind as WorkCardKind;
    const subject = { worker: f.worker, managerName: f.ownerName };
    const suggested = (row.work?.options ?? []).filter((o) =>
      ALLOWED_WORK_ACTIONS[kind].includes(o.action),
    );
    return (suggested.length ? suggested : defaultWorkOptions(kind, subject)).slice(
      0,
      WORK_OPTIONS_MAX,
    );
  }

  /** The manager's words reach a bot where it works on the task: its room, the task's chat, or the manager's chat with it. */
  async function tellBot(actor: ActiveActor, f: TaskFacts, botId: string, text: string) {
    // The id lets the bot read and move the task with zetta:task get/update, however long the board is.
    const content = `About the task “${f.task.title}” (id ${f.task.id}): ${text}`;
    const [conv] = f.task.conversationId
      ? await db
          .select({ id: conversation.id, kind: conversation.kind, botId: conversation.botId })
          .from(conversation)
          .where(
            and(
              eq(conversation.id, f.task.conversationId),
              eq(conversation.ownerUserId, actor.userId),
            ),
          )
      : [];
    if (conv?.kind === "discussion") {
      const room = await discussions.byConversation(conv.id);
      if (room && room.status !== "resolved" && room.status !== "cancelled") {
        const [b] = await db.select({ name: bot.name }).from(bot).where(eq(bot.id, botId));
        await discussions.postAsOwner(
          actor,
          room.id,
          `${mentionToken("bot", botId, b?.name ?? "bot")} ${content}`,
        );
        return;
      }
    }
    const conversationId =
      conv?.kind === "chat" && conv.botId === botId
        ? conv.id
        : await chatWith(db, chat, actor, botId);
    await sayInChat(chat, actor, conversationId, content);
  }

  /** The manager says something about a task to whoever does it. A stopped bot starts again: it was just told what to do. */
  async function tell(actor: ActiveActor, f: TaskFacts, text: string): Promise<string> {
    if (f.task.ownerUserId !== actor.userId) throw new AccessError("NOT_FOUND");
    if (!f.worker)
      throw new WorkError("NOT_POSSIBLE", "Nobody is on this task yet. Give it to someone first.");
    if (f.worker.kind === "person") {
      if (f.worker.id === actor.userId)
        throw new WorkError("NOT_POSSIBLE", "This task is yours: there is nobody to tell.");
      await raiseWork(db, "work_nudge", f, nudgeText(f, text));
      return `Sent to ${first(f.worker.name)}. It is in their Inbox, and the answer comes back to you.`;
    }
    await tellBot(actor, f, f.worker.id, text);
    if (f.task.followUp === "paused" && f.task.conversationId)
      await tasks.update(actor, f.task.id, { followUp: "auto" });
    return `Sent to ${f.worker.name}. It reads it now and goes on from there.`;
  }

  async function reassign(actor: ActiveActor, f: TaskFacts, target: string): Promise<string> {
    const candidate = (await candidatesFor(f)).find((c) => c.key === target);
    if (!candidate)
      throw new WorkError("NOT_AN_OPTION", "That is not someone this task can go to.");
    const id = target.slice(target.indexOf(":") + 1);
    if (candidate.kind === "person") {
      const teamId = (await people.ofOwner(actor.userId)).find((p) => p.userId === id)?.teamId;
      await tasks.reassign(actor, f.task.id, {
        kind: "person",
        userId: id,
        teamId: teamId ?? null,
      });
      return `Given to ${first(candidate.name)}. It is in their Inbox.`;
    }
    const conversationId = await chatWith(db, chat, actor, id);
    await tasks.reassign(actor, f.task.id, { kind: "bot", botId: id, conversationId });
    const about = [
      `The task “${f.task.title}” is yours now. It is already on your board: add your steps to it and keep it up to date, do not add another one.`,
      f.task.description.trim() && `What was asked:\n${f.task.description.trim()}`,
      f.task.progress.trim() &&
        `Where it stands, from who had it before:\n${f.task.progress.trim()}`,
    ]
      .filter(Boolean)
      .join("\n\n");
    await sayInChat(chat, actor, conversationId, about);
    return `Given to ${candidate.name}. It has been told and starts now.`;
  }

  /** No card of this kind until the time passes, unless the task changes first. */
  const hush = (f: TaskFacts, kind: WorkWatchKind, until: Date) =>
    watch.set(f.task.id, kind, { quietUntil: until, fingerprint: fingerprintOf(f.task) });

  async function perform(
    actor: ActiveActor,
    kind: WorkCardKind,
    f: TaskFacts,
    action: WorkAction,
    text: string,
    target: string | undefined,
  ): Promise<string> {
    const id = f.task.id;
    switch (action) {
      case "tell":
        return tell(actor, f, text);
      case "resume": {
        if (f.worker?.kind !== "bot")
          throw new WorkError("NOT_POSSIBLE", "Only a bot can be asked to continue.");
        // A task the bot is called back for starts again by itself; any other is restarted with a message.
        if (f.task.conversationId) {
          await tasks.update(actor, id, { followUp: "auto" });
          return `${f.worker.name} picks it up again in a couple of minutes.`;
        }
        return tell(actor, f, "Please continue with this task and finish it.");
      }
      case "reassign":
        return reassign(actor, f, target ?? "");
      case "mark_done":
        await tasks.update(actor, id, { status: "done" });
        return "Closed as done.";
      case "drop":
        await tasks.remove(actor, id);
        return "The task was deleted.";
      case "more_time":
        await hush(f, WATCH_OF[kind], addWorkingMs(now(), MORE_TIME_MS));
        return "Okay. You hear about it again tomorrow if nothing changes.";
      case "accept":
        await hush(f, "drift", new Date(+now() + ACCEPTED_MS));
        return "Okay. Nobody asks about its direction again unless the task changes.";
      case "on_it":
        await watch.set(id, "checkin", {
          verdict: "on_it",
          quietUntil: addWorkingMs(now(), PERSON_IDLE_MS),
          fingerprint: fingerprintOf(f.task),
        });
        if (kind === "work_nudge") await reply(f, "I'm on it.");
        return kind === "work_nudge"
          ? `Thanks. ${first(f.ownerName)} can see you are on it.`
          : "Thanks.";
      case "im_blocked":
        // The store tells the owner: a task moved to Blocked by who does it raises their card (see `blocked` below).
        await tasks.update(actor, id, { status: "blocked", progress: text });
        return `${first(f.ownerName)} was told, so they can help.`;
      case "its_done":
        await tasks.update(actor, id, { status: "done" });
        return "Closed as done.";
      case "reply":
        await reply(f, text);
        return `Sent to ${first(f.ownerName)}.`;
    }
  }

  /** What the person answered goes back to the manager as an update: it is news, not another decision. */
  async function reply(f: TaskFacts, text: string) {
    await raiseAttention(db, f.task.ownerUserId, {
      kind: "work_reply",
      subjectId: f.task.id,
      title: `${f.worker?.name ?? "Someone"} about “${f.task.title.slice(0, 80)}”`,
      detail: text,
      resultLink: `/tasks/${f.task.id}`,
      source: "manual",
    });
  }

  function raised(card: { id: string } | undefined) {
    try {
      if (card) deps.onRaised?.(card.id);
    } catch {
      // The card is there with its usual steps: suggestions are extra.
    }
  }

  const factsFor = async (row: Pick<CardRow, "subjectId">) => {
    const f = row.subjectId ? await factsOf(db, row.subjectId) : undefined;
    if (!f)
      throw new WorkError("NO_TASK", "The task this card is about is gone. Dismiss the card.");
    return f;
  };

  return {
    /** Who a task could be given to (see `candidatesFor`). */
    candidates: candidatesFor,
    /** What each work card shows, for the Inbox: one read per table for all of them. */
    async views(rows: readonly CardRow[]): Promise<Map<string, WorkView>> {
      const cards = rows.filter((r) => isWorkCard(r.kind) && r.subjectId);
      if (!cards.length) return new Map();
      const facts = await loadFacts(
        db,
        cards.map((r) => r.subjectId!),
      );
      const earlier = await db
        .select({ subjectId: attentionItem.subjectId, work: attentionItem.work })
        .from(attentionItem)
        .where(
          and(
            eq(attentionItem.ownerUserId, cards[0]!.ownerUserId),
            inArray(
              attentionItem.subjectId,
              cards.map((r) => r.subjectId!),
            ),
            inArray(attentionItem.status, ["resolved", "cancelled"]),
            isNotNull(attentionItem.work),
          ),
        )
        .orderBy(desc(attentionItem.updatedAt))
        .limit(200);
      const history = new Map<string, WorkDecision[]>();
      for (const e of earlier) {
        const chosen = e.work?.chosen;
        if (!chosen || !e.subjectId) continue;
        const list = history.get(e.subjectId) ?? [];
        if (list.length < HISTORY) history.set(e.subjectId, [...list, chosen]);
      }
      const reach = new Map<string, Promise<WorkCandidate[]>>();
      const out = new Map<string, WorkView>();
      for (const row of cards) {
        const f = facts.get(row.subjectId!);
        if (!f) continue;
        const options = optionsFor(row, f);
        const scope = `${f.project?.id ?? f.task.ownerUserId}:${f.worker?.id ?? ""}`;
        const candidates = options.some((o) => o.input === "target")
          ? await (reach.get(scope) ?? reach.set(scope, candidatesFor(f)).get(scope)!)
          : [];
        out.set(row.id, {
          summary: row.work?.summary ?? "",
          // Giving the task to someone else is offered only when there is someone else.
          options: options.filter((o) => o.input !== "target" || candidates.length > 0),
          candidates,
          history: history.get(row.subjectId!) ?? [],
          task: {
            id: f.task.id,
            title: f.task.title,
            status: f.task.status,
            stepsDone: f.stepsDone,
            stepsTotal: f.stepsTotal,
          },
          worker: f.worker,
          since: f.task.updatedAt.toISOString(),
          note: f.task.progress,
          project: f.project ? { id: f.project.id, name: f.project.name } : null,
        });
      }
      return out;
    },
    /** One button of a card. `option` is its id; without it the first one runs (the `A` key). */
    async run(
      actor: ActiveActor,
      row: CardRow,
      input: {
        option?: string | undefined;
        text?: string | undefined;
        target?: string | undefined;
      },
    ) {
      const kind = row.kind as WorkCardKind;
      const f = await factsFor(row);
      const options = optionsFor(row, f);
      const chosen = input.option ? options.find((o) => o.id === input.option) : options[0];
      if (!chosen) throw new WorkError("NOT_AN_OPTION", "This card does not offer that step.");
      const text = (input.text ?? "").trim().slice(0, TEXT_MAX) || (chosen.text ?? "").trim();
      if (chosen.input === "text" && !text)
        throw new WorkError("INPUT_REQUIRED", `Write a message first: “${chosen.label}” sends it.`);
      const target = input.target ?? chosen.target;
      if (chosen.input === "target" && !target)
        throw new WorkError("INPUT_REQUIRED", "Pick who gets the task first.");
      const done = await perform(actor, kind, f, chosen.action, text, target);
      // The answer was given: the scan must not raise the same card again in a couple of minutes. A task that is still as it was a
      // working day later is said again; a task that moved (the bot did what it was told) is not idle and raises nothing.
      if (ANSWER_HUSHES.includes(chosen.action) && MANAGER_WORK_KINDS.includes(kind)) {
        const after = await factsOf(db, f.task.id);
        if (after) await hush(after, WATCH_OF[kind], addWorkingMs(now(), MORE_TIME_MS));
      }
      const decision: WorkDecision = {
        action: chosen.action,
        label: chosen.label,
        text: chosen.input === "text" ? text : "",
        at: now().toISOString(),
      };
      const work: WorkData = { ...row.work, chosen: decision };
      await db.update(attentionItem).set({ work }).where(eq(attentionItem.id, row.id));
      return { done };
    },
    /** "Not now": nothing is done. A manager's card comes back tomorrow unless the task changes; a person's card just closes. */
    async notNow(row: CardRow) {
      const kind = row.kind as WorkCardKind;
      if (!MANAGER_WORK_KINDS.includes(kind) || !row.subjectId) return;
      const f = await factsOf(db, row.subjectId);
      if (f) await hush(f, WATCH_OF[kind], addWorkingMs(now(), MORE_TIME_MS));
    },
    /** "Tell them…" outside a card: the owner writes to whoever does one of their tasks. */
    async tellAbout(actor: ActiveActor, taskId: string, text: string) {
      const f = await factsOf(db, taskId);
      if (!f || f.task.ownerUserId !== actor.userId) throw new AccessError("NOT_FOUND");
      const message = text.trim().slice(0, TEXT_MAX);
      if (!message) throw new WorkError("INPUT_REQUIRED", "Write a message first.");
      return { done: await tell(actor, f, message) };
    },
    /** The server stopped calling a bot back for a task: the owner gets "<bot> stopped on <task>", with why in plain words. */
    async stopped(taskId: string, reason: string) {
      const f = await factsOf(db, taskId);
      if (!f) return;
      raised(await raiseWork(db, "work_stuck", f, stuckText(f, { kind: "stopped", reason })));
    },
    /** Whoever does a task moved it to Blocked: the owner gets the card, with what the worker said is in the way. */
    async blocked(taskId: string) {
      const f = await factsOf(db, taskId);
      if (!f || f.task.status !== "blocked") return;
      // A person's own answer to "still working on this?" is over once they said they are blocked.
      if (f.task.assigneeUserId)
        await db
          .update(attentionItem)
          .set({ status: "resolved", updatedAt: now() })
          .where(
            and(
              eq(attentionItem.ownerUserId, f.task.assigneeUserId),
              eq(attentionItem.sourceKey, workKey("work_checkin", taskId)),
              ne(attentionItem.status, "resolved"),
            ),
          );
      raised(await raiseWork(db, "work_blocked", f, blockedText(f)));
    },
  };
}
export type WorkActions = ReturnType<typeof createWorkActions>;
