import {
  BATCH_BOTS_PER_OWNER_PER_DAY,
  BATCH_MIN_OWNER_MESSAGES,
  BATCH_QUIET_MS,
  BATCH_RUN_NOW_COOLDOWN_MS,
  CANDIDATE_DAYS,
  type LessonBasis,
} from "@zetta/core/learning";
import type { Database } from "@zetta/db";
import { and, desc, eq } from "@zetta/db/query";
import { bot } from "@zetta/db/schema/chat";
import { learningRun, type BotLessonRow, type LearningRunRow } from "@zetta/db/schema/learning";
import { firstObject } from "../chat/bot-interview";
import { topics } from "@zetta/core/live-topics";
import type { NativeHarness, RunCli } from "../chat/harness";
import { events } from "../events/bus";
import { raiseAttention } from "../features/attention";
import { LessonError, type Lessons } from "./lessons";
import {
  assembleTranscript,
  batchPrompt,
  type KnownLesson,
  type PassChat,
  type PassChatMessage,
} from "./transcript";
import { jaccard } from "./text";
import { parseCandidates, validateCandidate } from "./validate";

/**
 * The daily pass (docs/decisions/lessons.md): once a day per bot, one engine call reads that day's chats between the person and the bot
 * and proposes candidate lessons with quotes of the person's own words. Nothing the model says is trusted: every quote is checked
 * against the messages, and a candidate is used only when the person said it outright or it showed up in two chats or on two days.
 * This is the only recurring model call of the learning work.
 */

const DAY = 86_400_000;
/** The first pass of a bot reads one day; a bot that was quiet for a while is not read further back than this. */
const FIRST_WINDOW_MS = DAY;
const MAX_WINDOW_MS = 3 * DAY;
const MAX_KNOWN = 40;
const RUN_MS = 3 * 60_000;
/** A bot that was not ready (too little said, a chat still going) is looked at again after this. */
const RECHECK_MS = 10 * 60_000;
const BOTS_PER_TICK = 2;
const EXPIRE_EVERY_MS = 3_600_000;

export class RunError extends Error {
  constructor(
    readonly code: "NOT_FOUND" | "OFF" | "COOLDOWN" | "NOTHING_NEW" | "NO_ENGINE" | "BUSY",
    readonly safe: string,
  ) {
    super(code);
  }
}

type Chief = { harness: NativeHarness; model: string | null };
/** `done` settles with the finished run once the engine has answered; the claim itself is quick. */
type PassResult = { run?: LearningRunRow; reason?: string; done?: Promise<LearningRunRow> };

export function createBatch(
  db: Database,
  deps: { lessons: Lessons; cli: RunCli; now?: () => Date },
) {
  const now = () => deps.now?.() ?? new Date();
  const dayOf = (d: Date) => d.toISOString().slice(0, 10);
  let busy = false,
    lastExpire = 0;
  const notReadyUntil = new Map<string, number>();

  /** The owner's chief engine, as the memory screen picks it: the bot's own may be one that only chats (fixture) or decides. */
  async function engineOf(owner: string): Promise<Chief | undefined> {
    const [chief] = await db
      .select()
      .from(bot)
      .where(and(eq(bot.ownerUserId, owner), eq(bot.kind, "chief"), eq(bot.archived, false)))
      .orderBy(bot.createdAt)
      .limit(1);
    if (!chief || chief.harness === "fixture" || chief.harness === "decision") return undefined;
    return { harness: chief.harness as NativeHarness, model: chief.model ?? null };
  }

  /** From where a bot's chats are read: where its last pass stopped, and never further back than three days. */
  async function windowFor(botId: string, at: Date) {
    const [last] = await db
      .select({ to: learningRun.windowTo })
      .from(learningRun)
      .where(and(eq(learningRun.botId, botId), eq(learningRun.status, "done")))
      .orderBy(desc(learningRun.startedAt))
      .limit(1);
    const floor = at.getTime() - MAX_WINDOW_MS;
    const from = last ? Math.max(last.to.getTime(), floor) : at.getTime() - FIRST_WINDOW_MS;
    return { from: new Date(from), to: at };
  }

  /** The person's chats with this bot in the window, as the pass reads them. Routine runs, saved tests, loops and memory jobs are not chats. */
  async function gather(owner: string, botId: string, from: Date, to: Date) {
    const q = db.$client.query.bind(db.$client);
    const { rows } = await q<{
      id: string;
      conversation_id: string;
      role: "user" | "assistant";
      content: string;
      status: string;
      meta: Record<string, unknown> | null;
      created_at: Date;
    }>(
      `select m.id, m.conversation_id, m.role, m.content, m.status, m.meta, m.created_at
         from message m join conversation c on c.id = m.conversation_id
        where c.owner_user_id = $1 and c.bot_id = $2 and c.kind = 'chat'
          and m.created_at > $3 and m.created_at <= $4
          and m.role in ('user', 'assistant') and m.parent_message_id is null and m.status in ('complete', 'cancelled', 'running')
          and not exists (select 1 from routine_run r where r.conversation_id = c.id)
          and not exists (select 1 from bot_drive_run d where d.conversation_id = c.id)
          and not exists (select 1 from memory_job j where j.conversation_id = c.id)
          and not exists (select 1 from goal_loop g where g.conversation_id = c.id)
        order by c.id, m.seq`,
      [owner, botId, from, to],
    );
    if (!rows.length) return { chats: [] as PassChat[], lastAt: undefined, running: false };
    const ids = rows.map((r) => r.id);
    const attached = new Set(
      (
        await q<{ message_id: string }>(
          "select distinct message_id from attachment where message_id = any($1::uuid[])",
          [ids],
        )
      ).rows.map((r) => r.message_id),
    );
    const rated = (
      await q<{ message_id: string; rating: "up" | "down"; reason: string }>(
        "select message_id, rating, reason from message_feedback where message_id = any($1::uuid[]) and owner_user_id = $2",
        [ids, owner],
      )
    ).rows;
    const byChat = new Map<string, PassChat>();
    let lastAt = 0,
      running = false;
    for (const r of rows) {
      lastAt = Math.max(lastAt, new Date(r.created_at).getTime());
      if (r.status === "running") {
        running = true;
        continue;
      }
      const meta = r.meta ?? {};
      const own =
        r.role === "user" &&
        r.status === "complete" &&
        !attached.has(r.id) &&
        r.content.length <= 4000 &&
        !("fileRefs" in meta) &&
        !("quote" in meta) &&
        !("poll" in meta) &&
        !("stop" in meta);
      const message: PassChatMessage = {
        id: r.id,
        role: r.role,
        content: r.content,
        status: r.status,
        day: dayOf(new Date(r.created_at)),
        eligible: own,
        ...("steer" in meta ? { steered: true } : {}),
      };
      let chat = byChat.get(r.conversation_id);
      if (!chat) {
        chat = {
          conversationId: r.conversation_id,
          messages: [],
          ratings: new Map(
            rated.map((x) => [x.message_id, { rating: x.rating, reason: x.reason }] as const),
          ),
        };
        byChat.set(r.conversation_id, chat);
      }
      chat.messages.push(message);
    }
    return { chats: [...byChat.values()], lastAt: lastAt ? new Date(lastAt) : undefined, running };
  }

  type Counts = {
    proposed: number;
    started: number;
    waitingYou: number;
    waitingSecond: number;
    refused: number;
    seen: number;
  };

  /** What a validated candidate does next: starts on trial, or waits for the person, or for a second sighting. */
  async function advance(
    l: BotLessonRow,
    said: boolean,
    b: { id: string; autoLearn: string },
    counts: Counts,
    started: BotLessonRow[],
  ) {
    const spread = await deps.lessons.spread(l.id);
    const basis: LessonBasis | null = said
      ? "said"
      : spread.chats >= 2 || spread.days >= 2
        ? "repeated"
        : null;
    if (!basis) {
      counts.waitingSecond++;
      return;
    }
    const v = await deps.lessons.validate(l.ownerUserId, l.id, basis);
    // A procedure is never used on its own, and a bot that only suggests waits for the person.
    if (v.kind !== "rule" || b.autoLearn !== "auto") {
      counts.waitingYou++;
      return;
    }
    try {
      started.push(await deps.lessons.promote(l.ownerUserId, l.id, basis, "system"));
      counts.started++;
    } catch (e) {
      if (!(e instanceof LessonError)) throw e;
      counts.refused++;
    }
  }

  async function execute(
    run: LearningRunRow,
    b: { id: string; name: string; autoLearn: string },
    chief: Chief,
    chats: PassChat[],
  ) {
    const owner = run.ownerUserId;
    const pass = assembleTranscript(chats);
    const known = (await deps.lessons.known(b.id)).slice(0, MAX_KNOWN);
    const aliases = new Map<string, BotLessonRow>(known.map((k, i) => [`L${i + 1}`, k]));
    const list: KnownLesson[] = known.map((k, i) => ({
      alias: `L${i + 1}`,
      status: k.status,
      text: k.text,
    }));
    const out = await deps.cli({
      harness: chief.harness,
      prompt: batchPrompt(b.name, pass.text, list),
      model: chief.model,
      userId: owner,
      botId: b.id,
      timeoutMs: RUN_MS,
      light: "on",
    });
    const proposals = parseCandidates(firstObject(out));
    const counts: Counts = {
      proposed: 0,
      started: 0,
      waitingYou: 0,
      waitingSecond: 0,
      refused: 0,
      seen: 0,
    };
    const started: BotLessonRow[] = [];
    const touched = new Set<string>();
    for (const c of proposals) {
      const v = validateCandidate(c, pass.messages);
      if (!v.ok) {
        counts.refused++;
        continue;
      }
      let lesson = c.id ? aliases.get(c.id) : undefined;
      lesson ??= known.find((k) => jaccard(k.text, v.text) >= 0.6);
      if (lesson) {
        const added = await deps.lessons.addEvidence(
          lesson.id,
          v.evidence.map((e) => ({ ...e })),
        );
        if (added) {
          counts.seen++;
          lesson = await deps.lessons.seenAgain(
            owner,
            lesson.id,
            `${added} new quote${added === 1 ? "" : "s"}`,
          );
        }
      } else {
        lesson = await deps.lessons.propose({
          ownerUserId: owner,
          botId: b.id,
          text: v.text,
          topic: v.topic,
          kind: v.kind,
          scope: v.scope,
        });
        await deps.lessons.addEvidence(
          lesson.id,
          v.evidence.map((e) => ({ ...e })),
        );
        counts.proposed++;
        known.push(lesson);
      }
      // A lesson that was dropped, turned down or is already in use is not started again by a new sighting.
      if (lesson.status === "candidate" && !touched.has(lesson.id)) {
        touched.add(lesson.id);
        await advance(
          lesson,
          v.evidence.some((e) => e.said),
          b,
          counts,
          started,
        );
      }
    }
    return { counts, started, tokensRead: pass.text.length };
  }

  const summary = (c: Counts) =>
    [
      c.started && `${c.started} started on trial`,
      c.waitingYou && `${c.waitingYou} waiting for you`,
      c.waitingSecond && `${c.waitingSecond} waiting for a second sighting`,
      c.seen && `${c.seen} seen again`,
      c.refused && `${c.refused} refused by the checks`,
    ]
      .filter(Boolean)
      .join(" · ") || "Nothing worth keeping.";

  /** One reading of one bot's chats, from the claim to the notice. `trigger` says whether the person asked. */
  async function pass(
    b: { id: string; ownerUserId: string; name: string; autoLearn: string },
    trigger: "daily" | "manual",
  ): Promise<PassResult> {
    const at = now();
    const { from, to } = await windowFor(b.id, at);
    const read = await gather(b.ownerUserId, b.id, from, to);
    const said = read.chats.reduce(
      (n, c) => n + c.messages.filter((m) => m.role === "user").length,
      0,
    );
    if (trigger === "daily") {
      if (said < BATCH_MIN_OWNER_MESSAGES) return { reason: "too little new" };
      if (read.running || !read.lastAt || at.getTime() - read.lastAt.getTime() < BATCH_QUIET_MS)
        return { reason: "a chat is still going" };
    } else if (said < 1) return { reason: "nothing new" };
    const chief = await engineOf(b.ownerUserId);
    // The claim: one daily pass per bot per day. A second server, or a restart, finds the row and stops.
    const [run] = await db
      .insert(learningRun)
      .values({
        ownerUserId: b.ownerUserId,
        botId: b.id,
        day: dayOf(at),
        trigger,
        windowFrom: from,
        windowTo: to,
        ...(chief
          ? {}
          : {
              status: "skipped" as const,
              detail: "Your chief needs a real engine to read the chats.",
              finishedAt: at,
            }),
      })
      .onConflictDoNothing()
      .returning();
    if (!run) return { reason: "already run today" };
    if (!chief) return { run, reason: "no engine" };
    const done = (async (): Promise<LearningRunRow> => {
      try {
        const r = await execute(run, b, chief, read.chats);
        const detail = summary(r.counts);
        const [fin] = await db
          .update(learningRun)
          .set({
            status: "done",
            detail,
            candidates: r.counts.proposed,
            promoted: r.counts.started,
            finishedAt: now(),
          })
          .where(eq(learningRun.id, run.id))
          .returning();
        if (r.counts.started || r.counts.waitingYou)
          await raiseAttention(db, b.ownerUserId, {
            kind: "memory_updated",
            botId: b.id,
            title: `${b.name} learned ${r.counts.started + r.counts.waitingYou === 1 ? "something" : `${r.counts.started + r.counts.waitingYou} things`} from you`,
            detail:
              r.started
                .slice(0, 5)
                .map((l) => `• ${l.text}`)
                .join("\n") || detail,
            nextAction: "Read what it learned, and remove anything that is wrong.",
            resultLink: `/bots/${b.id}/settings?tab=skills`,
            source: "bot",
            sourceKey: `lessons:${b.id}:${dayOf(at)}`,
          }).catch(() => undefined);
        return fin ?? run;
      } catch (e) {
        const [failed] = await db
          .update(learningRun)
          .set({
            status: "failed",
            detail: e instanceof Error ? e.message.slice(0, 200) : "The engine did not answer.",
            finishedAt: now(),
          })
          .where(eq(learningRun.id, run.id))
          .returning();
        return failed ?? run;
      } finally {
        events.publish([b.ownerUserId], topics.botLearning(b.id));
      }
    })();
    return { run, done };
  }

  return {
    /**
     * The 30-second ticker: closes candidates nobody saw again, then reads the chats of a few bots that are due. A bot is due when it
     * has not been read today, its person lets the daily pass run, and it learns (`autoLearn` is not off). Most ticks find nothing.
     */
    async tick() {
      if (busy || process.env.ZETTA_LESSON_BATCH === "off") return 0;
      busy = true;
      try {
        const at = now();
        if (at.getTime() - lastExpire > EXPIRE_EVERY_MS) {
          lastExpire = at.getTime();
          await deps.lessons.expireCandidates(new Date(at.getTime() - CANDIDATE_DAYS * DAY));
        }
        const { rows } = await db.$client.query<{
          id: string;
          owner_user_id: string;
          name: string;
          auto_learn: string;
        }>(
          `select b.id, b.owner_user_id, b.name, b.auto_learn
             from bot b
             left join learning_policy p on p.owner_user_id = b.owner_user_id
            where b.archived = false and b.auto_learn <> 'off' and b.harness not in ('fixture', 'decision')
              and coalesce(p.batch, 'daily') = 'daily'
              and exists (select 1 from membership m where m.user_id = b.owner_user_id and m.status = 'active')
              and not exists (select 1 from user_preference up where up.owner_user_id = b.owner_user_id and up.agents_state = 'paused')
              and not exists (select 1 from learning_run r where r.bot_id = b.id and r.day = $1::date and r.trigger = 'daily')
              and (select count(*) from learning_run r where r.owner_user_id = b.owner_user_id and r.day = $1::date and r.trigger = 'daily') < $2
              and exists (select 1 from conversation c join message m on m.conversation_id = c.id
                           where c.bot_id = b.id and c.kind = 'chat' and m.role = 'user' and m.created_at > $3)
            order by b.created_at
            limit 40`,
          [dayOf(at), BATCH_BOTS_PER_OWNER_PER_DAY, new Date(at.getTime() - 2 * DAY)],
        );
        let ran = 0;
        for (const r of rows) {
          if (ran >= BOTS_PER_TICK) break;
          if ((notReadyUntil.get(r.id) ?? 0) > at.getTime()) continue;
          const res = await pass(
            { id: r.id, ownerUserId: r.owner_user_id, name: r.name, autoLearn: r.auto_learn },
            "daily",
          ).catch((): PassResult => ({ reason: "failed" }));
          if (res.run) {
            ran++;
            await res.done;
          } else notReadyUntil.set(r.id, at.getTime() + RECHECK_MS);
        }
        return ran;
      } finally {
        busy = false;
      }
    },

    /**
     * "Run now": the person asks for a reading of their chats with one bot. Held back by a cooldown (an hour after the last reading),
     * and it needs something new to read. Returns the claimed run at once; `done` settles with the finished run when the engine has
     * answered (the page follows it through the bot's learning topic).
     */
    async runNow(owner: string, botId: string) {
      const [b] = await db
        .select()
        .from(bot)
        .where(and(eq(bot.id, botId), eq(bot.ownerUserId, owner), eq(bot.archived, false)));
      if (!b) throw new RunError("NOT_FOUND", "That bot was not found.");
      if (b.autoLearn === "off")
        throw new RunError(
          "OFF",
          "This bot is set not to learn. Turn learning on in its settings first.",
        );
      const [last] = await db
        .select({ at: learningRun.startedAt })
        .from(learningRun)
        .where(eq(learningRun.botId, botId))
        .orderBy(desc(learningRun.startedAt))
        .limit(1);
      if (last && now().getTime() - last.at.getTime() < BATCH_RUN_NOW_COOLDOWN_MS)
        throw new RunError("COOLDOWN", "This bot was read less than an hour ago. Try again later.");
      const bot_ = { id: b.id, ownerUserId: owner, name: b.name, autoLearn: b.autoLearn };
      const res = await pass(bot_, "manual");
      if (!res.run)
        throw new RunError(
          res.reason === "nothing new" ? "NOTHING_NEW" : "BUSY",
          res.reason === "nothing new"
            ? "There is nothing new to read since the last time."
            : "That bot is being read right now.",
        );
      if (res.reason === "no engine")
        throw new RunError("NO_ENGINE", "Your chief needs a real engine to read the chats.");
      return { run: res.run, done: res.done! };
    },

    /** What a bot's learning page says about the reading of its chats: the last readings, and when "Run now" is open again. */
    async overview(owner: string, botId: string) {
      const [b] = await db
        .select({ id: bot.id, name: bot.name, autoLearn: bot.autoLearn })
        .from(bot)
        .where(and(eq(bot.id, botId), eq(bot.ownerUserId, owner)));
      if (!b) throw new RunError("NOT_FOUND", "That bot was not found.");
      const runs = await db
        .select()
        .from(learningRun)
        .where(eq(learningRun.botId, botId))
        .orderBy(desc(learningRun.startedAt))
        .limit(10);
      const last = runs[0];
      const until = last
        ? new Date(last.startedAt.getTime() + BATCH_RUN_NOW_COOLDOWN_MS)
        : undefined;
      return {
        bot: b,
        runs: runs.map((r) => ({
          id: r.id,
          trigger: r.trigger,
          status: r.status,
          detail: r.detail,
          candidates: r.candidates,
          promoted: r.promoted,
          startedAt: r.startedAt.toISOString(),
          finishedAt: r.finishedAt?.toISOString() ?? null,
        })),
        runNowAfter: until && until.getTime() > now().getTime() ? until.toISOString() : null,
      };
    },
  };
}
export type Batch = ReturnType<typeof createBatch>;
