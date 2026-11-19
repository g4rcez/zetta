/**
 * What a bot learned and whether it helped: the words the database, the server and the web app share (docs/decisions/lessons.md).
 *
 * Only erasable syntax here (no enums, no namespaces): the database schema, the server and the web app all import this file.
 */

/** What a use points at. A lesson is a memory item, so it is counted as one. */
export const ITEM_USE_KINDS = ["memory", "skill"] as const;
export type ItemUseKind = (typeof ITEM_USE_KINDS)[number];

/**
 * How an item was in front of the bot when it answered.
 * - `relevant`: its text was in the prompt because it fit the message (a procedure found by the search, an item the person picked).
 * - `loaded`: the bot asked for it (read an item, loaded a skill).
 * - `always`: it was in the prompt whatever the message said (the skills a Hermes bot carries).
 * - `shown`: it was in the prompt, but nothing says it fit the message.
 * Only `relevant` and `loaded` count toward a verdict on a lesson: an item that is always there would take the blame for every
 * correction, whatever the correction was about.
 */
export const ITEM_USE_EXPOSURES = ["shown", "relevant", "loaded", "always"] as const;
export type ItemUseExposure = (typeof ITEM_USE_EXPOSURES)[number];
export const COUNTED_EXPOSURES: readonly ItemUseExposure[] = ["relevant", "loaded"];

/** Who started the reply's turn. A server-started turn (a routine, a loop) has no person to judge it. */
export const ITEM_USE_ORIGINS = ["person", "server"] as const;
export type ItemUseOrigin = (typeof ITEM_USE_ORIGINS)[number];

/** How a reply went, judged once from what happened to it. `pending` until something settles it. */
export const REPLY_OUTCOMES = ["pending", "good", "neutral", "bad"] as const;
export type ReplyOutcome = (typeof REPLY_OUTCOMES)[number];

/**
 * What happened to a reply. Bad: the person gave a thumb down, stopped it, corrected it while it was written (`steered`; a message that
 * only adds to the request is not one), or corrected it in their next message.
 * Good: a thumb up, a task it made was finished, the person picked it in a paired test, or they simply carried on.
 * Neither: Zetta restarted while it ran (`interrupted`), or the person pressed "Send now" (`send_now`), which is not a complaint.
 */
export const REPLY_SIGNALS = [
  "thumbs_up",
  "thumbs_down",
  "stopped",
  "steered",
  "corrected",
  "task_done",
  "carried_on",
  "send_now",
  "interrupted",
  "chose_better",
  "chose_worse",
] as const;
export type ReplySignal = (typeof REPLY_SIGNALS)[number];

/** How much each signal counts for or against a reply. Positive helps, negative hurts. A reply's weight is the sum of its signals. */
export const SIGNAL_WEIGHTS: Record<ReplySignal, number> = {
  thumbs_up: 2,
  thumbs_down: -3,
  stopped: -3,
  steered: -2,
  corrected: -3,
  task_done: 2,
  carried_on: 1,
  send_now: 0,
  interrupted: 0,
  chose_better: 3,
  chose_worse: -3,
};

/** A reply waits this long for the person's next message before it is judged without one. */
export const OUTCOME_SETTLE_MS = 24 * 3_600_000;
/** Uses older than this are deleted: the verdicts are computed from recent work. */
export const ITEM_USE_KEEP_DAYS = 180;

/**
 * What a memory item, a skill or a lesson is worth, in words a manager can use. Always read against the bot's own record: an item is
 * "hurts" when the person steps in more often after replies that used it than after the bot's replies in general.
 * - `helps`: used enough, and the person stepped in no more often than usual.
 * - `hurts`: used enough, and the person stepped in clearly more often than usual.
 * - `unclear`: not used enough to say, or always in the prompt, so its effect cannot be told apart from the rest.
 * - `unused`: nothing used it for a month.
 */
export const USEFULNESS_LABELS = ["helps", "unclear", "hurts", "unused"] as const;
export type UsefulnessLabel = (typeof USEFULNESS_LABELS)[number];

/** The numbers behind a verdict. A use counts only when it was `relevant` or `loaded`; `ambient` uses were always in the prompt. */
export type UsefulnessStats = {
  /** Uses that count (relevant or loaded) in the window. */
  uses: number;
  /** Of those, replies after which the person was happy (good) or stepped in (bad). The rest were neutral or not judged yet. */
  good: number;
  bad: number;
  /** Replies where the text was in the prompt whatever the message said. */
  ambient: number;
  /** Whole days since the last use that counts, or null when there is none in the window. */
  lastUsedDaysAgo: number | null;
  /** How often the person stepped in after this bot's replies in general (bad / (good + bad)), or null when unknown. */
  baselineBadRate: number | null;
  /** How long ago the item was added. Absent when unknown: an item with no uses is then called unused, as before. */
  ageDays?: number | null;
};

/** At least this many judged uses before an item is called helpful or harmful. */
export const LABEL_MIN_JUDGED = 5;
/** Harmful: the person steps in at least this often after the item, and this much more than their usual rate. */
export const LABEL_HURTS_MIN_RATE = 0.4;
export const LABEL_HURTS_MARGIN = 0.15;
/** Helpful: the person steps in at least this much less often than usual, or, with no usual to compare to, at most this often. */
export const LABEL_HELPS_MARGIN = 0.05;
export const LABEL_HELPS_MAX_RATE = 0.2;
/** An item nothing used for this many days is unused. */
export const UNUSED_AFTER_DAYS = 30;
/** How far back the verdicts look. */
export const USEFULNESS_WINDOW_DAYS = 90;

const pct = (n: number) => `${Math.round(n * 100)}%`;
const times = (n: number) => (n === 1 ? "once" : `${n} times`);

/** The label and a plain sentence that says why. Pure: the web page shows the same sentence the server computed. */
export function usefulnessVerdict(s: UsefulnessStats): { label: UsefulnessLabel; reason: string } {
  if (s.uses === 0) {
    // Something added a few days ago that nothing used yet is new, not unused: "unused" means a month of nobody needing it.
    if (s.ambient === 0 && s.ageDays != null && s.ageDays < UNUSED_AFTER_DAYS)
      return {
        label: "unclear",
        reason: `New: added ${s.ageDays < 1 ? "today" : s.ageDays < 2 ? "yesterday" : `${Math.floor(s.ageDays)} days ago`}, nothing has used it yet.`,
      };
    return s.ambient > 0
      ? {
          label: "unclear",
          reason: "Always in the prompt, so its effect cannot be told apart from the rest.",
        }
      : { label: "unused", reason: `Nothing used it in the last ${USEFULNESS_WINDOW_DAYS} days.` };
  }
  if (s.lastUsedDaysAgo !== null && s.lastUsedDaysAgo > UNUSED_AFTER_DAYS)
    return {
      label: "unused",
      reason: `Used ${times(s.uses)}, but not for ${s.lastUsedDaysAgo} days.`,
    };
  const judged = s.good + s.bad;
  const usedText = `Used ${times(s.uses)}`;
  if (judged < LABEL_MIN_JUDGED)
    return {
      label: "unclear",
      reason: `${usedText}; only ${judged} of those replies were judged so far (it takes ${LABEL_MIN_JUDGED}).`,
    };
  const rate = s.bad / judged;
  const usual = s.baselineBadRate;
  const against =
    usual === null
      ? ""
      : ` The person stepped in ${pct(usual)} of the time for this bot in general.`;
  const stepped = `${usedText}. The person stepped in after ${pct(rate)} of the replies that used it.${against}`;
  if (rate >= LABEL_HURTS_MIN_RATE && rate >= (usual ?? 0) + LABEL_HURTS_MARGIN)
    return { label: "hurts", reason: stepped };
  // Helps only when the person steps in clearly less often than usual: doing no better than the rest is no evidence of help.
  if (s.good >= 1 && rate <= (usual === null ? LABEL_HELPS_MAX_RATE : usual - LABEL_HELPS_MARGIN))
    return { label: "helps", reason: stepped };
  return { label: "unclear", reason: stepped };
}

// ---- Lessons: what a bot learned from its owner, kept on trial and judged by what happens next ---------------------------------------

/**
 * Where a lesson stands.
 * - `candidate`: proposed by the daily pass. With no `basis` it waits for a second sighting; with one it passed the checks and waits for
 *   the person (the bot is set to suggest) or for the next step.
 * - `trial`: in use, judged by what happens after replies that used it.
 * - `kept`: it passed its trial.
 * - `dropped`: archived, with a reason. It can be brought back.
 * - `rejected`: failed a check, or the person said no. Kept so the page can say why.
 * - `expired`: a candidate nobody saw a second time within `CANDIDATE_DAYS`.
 */
export const LESSON_STATUSES = [
  "candidate",
  "trial",
  "kept",
  "dropped",
  "rejected",
  "expired",
] as const;
export type LessonStatus = (typeof LESSON_STATUSES)[number];

/** `rule`: a statement (how the person wants the work done, a fact about the work). `procedure`: steps; too long for a lesson, so it stays a candidate. */
export const LESSON_KINDS = ["rule", "procedure"] as const;
export type LessonKind = (typeof LESSON_KINDS)[number];

/** `topic`: it matters for some work (the daily pass says what about). `always`: it applies to every reply (a style, a language). */
export const LESSON_SCOPES = ["topic", "always"] as const;
export type LessonScope = (typeof LESSON_SCOPES)[number];

/** Why a candidate may be used: the person said it outright, it showed up twice, the person accepted it themselves, or it was already a skill the bot had learned. */
export const LESSON_BASES = ["said", "repeated", "person", "old"] as const;
export type LessonBasis = (typeof LESSON_BASES)[number];

export const LESSON_ORIGINS = ["batch", "backfill", "person"] as const;
export type LessonOrigin = (typeof LESSON_ORIGINS)[number];

export const LESSON_DROP_REASONS = [
  "bad_results",
  "unused",
  "person",
  "superseded",
  "duplicate",
] as const;
export type LessonDropReason = (typeof LESSON_DROP_REASONS)[number];

export const LESSON_EVENT_KINDS = [
  "proposed",
  "seen_again",
  "validated",
  "refused",
  "promoted",
  "kept",
  "dropped",
  "restored",
  "edited",
  "rejected",
  "expired",
] as const;
export type LessonEventKind = (typeof LESSON_EVENT_KINDS)[number];
export const LESSON_ACTORS = ["system", "person"] as const;
export type LessonActor = (typeof LESSON_ACTORS)[number];

/** A lesson is one short sentence; anything longer is a procedure, which a person turns into an item. */
export const LESSON_MAX_CHARS = 300;
/** A candidate nobody saw a second time within this many days expires. */
export const CANDIDATE_DAYS = 30;
/** What goes in the prompt: the lessons block of a bot. Trial lessons first, then the kept ones. */
export const LESSONS_BLOCK = { chars: 1000, entries: 12 } as const;

/** The daily pass: one per bot per day, and only for a bot with enough new words from its owner to learn from. */
export const BATCH_MIN_OWNER_MESSAGES = 6;
export const BATCH_MAX_CANDIDATES = 8;
/** At most this many bots of one owner are read in a day: the pass is the one recurring model call. */
export const BATCH_BOTS_PER_OWNER_PER_DAY = 10;
/** A chat must be quiet this long before the pass reads it. */
export const BATCH_QUIET_MS = 10 * 60_000;
/** "Run now" waits this long after the last pass of the bot. */
export const BATCH_RUN_NOW_COOLDOWN_MS = 60 * 60_000;

export const LEARNING_RUN_KINDS = ["batch"] as const;
export const LEARNING_RUN_STATUSES = ["running", "done", "skipped", "failed"] as const;
export const LEARNING_RUN_TRIGGERS = ["daily", "manual"] as const;

/** How strict the trial is. An owner setting; `normal` unless they change it. */
export const LEARNING_STRICTNESS = ["strict", "normal", "loose"] as const;
export type LearningStrictness = (typeof LEARNING_STRICTNESS)[number];
export const LEARNING_BATCH_MODES = ["daily", "off"] as const;
export const LEARNING_FORGET_MODES = ["on", "off"] as const;
export const LEARNING_TIDY_MODES = ["weekly", "off"] as const;

/** The rules of a trial, per strictness. `keepAfter` resolved uses with no bad one among the last `cleanLast`; `dropBad` bad results. */
export const TRIAL_RULES: Record<
  LearningStrictness,
  { keepAfter: number; cleanLast: number; dropBad: number; dropMinRate: number }
> = {
  strict: { keepAfter: 8, cleanLast: 8, dropBad: 1, dropMinRate: 0 },
  normal: { keepAfter: 5, cleanLast: 3, dropBad: 2, dropMinRate: 0.4 },
  loose: { keepAfter: 3, cleanLast: 1, dropBad: 3, dropMinRate: 0.4 },
};
/** A lesson is dropped only when the person steps in after it clearly more often than after the bot's replies in general. */
export const TRIAL_DROP_MARGIN = 0.15;
/** A kept lesson whose last uses go this badly is put in front of the person: it is never dropped by itself. */
export const KEPT_REVIEW = { lastUses: 10, minRate: 0.5 } as const;
/** Lessons nothing used for this many days are archived (trial) or reviewed (kept). */
export const LESSON_UNUSED_DAYS = { trial: 30, kept: 60 } as const;

export type TrialDecision = "keep" | "drop" | "wait";

/**
 * What a trial says now. `outcomes` are the resolved uses that count (relevant or loaded), oldest first; `neutral` ones count as uses.
 * Dropped only when there were enough bad results AND the bad rate is clearly above the bot's usual (so an item that is always in the
 * prompt does not take the blame for every correction). Kept after `keepAfter` resolved uses with no bad one among the last few, and a
 * bad rate that is not clearly above the usual either.
 */
export function trialDecision(
  outcomes: readonly ("good" | "bad" | "neutral")[],
  baselineBadRate: number | null,
  strictness: LearningStrictness = "normal",
): TrialDecision {
  const rule = TRIAL_RULES[strictness];
  const bad = outcomes.filter((o) => o === "bad").length;
  const rate = outcomes.length ? bad / outcomes.length : 0;
  if (
    bad >= rule.dropBad &&
    rate >= Math.max(rule.dropMinRate, (baselineBadRate ?? 0) + TRIAL_DROP_MARGIN)
  )
    return "drop";
  // Kept only when enough uses are in, the last few were clean, and the person did not step in clearly more often than usual.
  const ceiling = (baselineBadRate ?? rule.dropMinRate) + TRIAL_DROP_MARGIN;
  if (
    outcomes.length >= rule.keepAfter &&
    !outcomes.slice(-rule.cleanLast).includes("bad") &&
    rate <= ceiling
  )
    return "keep";
  return "wait";
}

// ---- Check and forget: what the weekly tidy-up and the daily forgetting find, as suggestions a person accepts ------------------------

/**
 * Something the tidy-up noticed. None is applied by itself: each waits for the person (accept does the change, dismiss leaves things as
 * they are and is remembered).
 * - `duplicate`: two lessons, or two memory items, that say the same thing.
 * - `check_pair`: two lessons of one bot that may pull in opposite directions ("always…" and "never…" about the same thing).
 * - `superseded_current`: an item that a newer item replaces (a `supersedes` link) but that is still current.
 * - `unused`: a memory item the person wrote that nothing has used for a long time.
 * - `drop_kept`: a kept lesson after which the person now steps in clearly more often than usual.
 */
export const FINDING_KINDS = [
  "duplicate",
  "check_pair",
  "superseded_current",
  "unused",
  "drop_kept",
] as const;
export type FindingKind = (typeof FINDING_KINDS)[number];
export const FINDING_STATUSES = ["open", "accepted", "dismissed", "outdated"] as const;
export type FindingStatus = (typeof FINDING_STATUSES)[number];
export type FindingRef = { kind: "lesson" | "memory"; id: string };

/** The numbers the deterministic tidy-up uses. No model is asked for any of them. */
export const TIDY = {
  /** Two lessons share at least this part of their words: the same lesson. */
  lessonDuplicate: 0.6,
  /** Two lessons share this much and one forbids what the other asks: worth a look. */
  lessonConflict: 0.5,
  /**
   * Two memory items whose nearest passages are this close (cosine distance) say the same thing. Calibrated on 2026-11-18 against the
   * dev memory (56 items, the local 384-dimension model): the pairs that were real duplicates sit at 0.026 to 0.030, pairs that are only
   * about the same subject start at 0.048. Every suggestion costs the person attention, so this favours being right over finding more.
   */
  itemDuplicateDistance: 0.035,
  /** A memory item nobody used for this many days, and not changed either, is offered for archiving. */
  unusedItemDays: 90,
  /** At most this many open suggestions for one person at once: a long list is not read. */
  openPerOwner: 30,
} as const;
