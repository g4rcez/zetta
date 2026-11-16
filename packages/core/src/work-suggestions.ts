/**
 * Work cards: cards in the Inbox about a task that needs somebody. A manager gets "stopped", "blocked" and "going a different way"; the
 * person a task is assigned to gets "still working on this?" and the manager's messages. Each card offers a few next steps as buttons.
 * They are suggestions: every one says what it will do, and the person can always write their own answer.
 *
 * Erasable syntax only: the database schema, the server and the web app all import this file.
 */

export const WORK_CARD_KINDS = [
  /** For the manager: the work stopped moving (a bot stopped, nothing changed for a while, or a person did not answer). */
  "work_stuck",
  /** For the manager: whoever does the task said it cannot go on. */
  "work_blocked",
  /** For the manager: the work is going a different way than what was asked. */
  "work_drift",
  /** For the person a task is assigned to: "Still working on this?". */
  "work_checkin",
  /** For the person a task is assigned to: a message from the manager about it. */
  "work_nudge",
] as const;
export type WorkCardKind = (typeof WORK_CARD_KINDS)[number];
export const isWorkCard = (kind: string): kind is WorkCardKind =>
  (WORK_CARD_KINDS as readonly string[]).includes(kind);
/** The work cards a manager gets about somebody else's task. */
export const MANAGER_WORK_KINDS: readonly WorkCardKind[] = [
  "work_stuck",
  "work_blocked",
  "work_drift",
];

export const WORK_ACTIONS = [
  // What a manager does about a task.
  "tell",
  "resume",
  "reassign",
  "mark_done",
  "drop",
  "more_time",
  "accept",
  // What the person a task is assigned to answers.
  "on_it",
  "im_blocked",
  "its_done",
  "reply",
] as const;
export type WorkAction = (typeof WORK_ACTIONS)[number];
export const isWorkAction = (v: unknown): v is WorkAction =>
  typeof v === "string" && (WORK_ACTIONS as readonly string[]).includes(v);

/** `text`: the person writes a message (a ready one may be offered). `target`: they pick who gets the task. */
export type WorkOptionInput = "none" | "text" | "target";
/** `undoable`: the step cannot be taken back afterwards, so the web app waits a few seconds and offers Undo first. */
export type WorkOptionRisk = "none" | "undoable";

export type WorkOption = {
  /** Unique on its card. A default option uses its action; a suggested one adds a number. */
  id: string;
  action: WorkAction;
  /** On the button. */
  label: string;
  /** One plain sentence: what pressing the button does. */
  effect: string;
  input: WorkOptionInput;
  risk: WorkOptionRisk;
  /** A ready message, when Zetta wrote one. The person may change it before sending. */
  text?: string;
  /** For `reassign`: who Zetta suggests, as `bot:<id>` or `person:<id>`. */
  target?: string;
};

/** Somebody a task can be given to. `key` is `bot:<id>` or `person:<id>`. */
export type WorkCandidate = { key: string; kind: "bot" | "person"; name: string };
/** What the manager (or the person asked) chose on a card, kept so the next card about the same task can show it. */
export type WorkDecision = { action: WorkAction; label: string; text: string; at: string };

/** What a card keeps in `attention_item.work`. Default options are not stored: they are built when the card is read. */
export type WorkData = {
  /** Two plain sentences on what is going on, when Zetta wrote them. */
  summary?: string;
  /** Next steps Zetta suggested. Without them the card shows the defaults of its kind. */
  options?: WorkOption[];
  chosen?: WorkDecision;
};

/** Who does the task a card is about. */
export type WorkWorker = { kind: "bot" | "person"; id: string; name: string };

/** What a work card shows, read when the Inbox is built. */
export type WorkView = {
  summary: string;
  options: WorkOption[];
  /** Who the task could be given to, for the `reassign` option. */
  candidates: WorkCandidate[];
  /** Earlier decisions on the same task, newest first. */
  history: WorkDecision[];
  task: { id: string; title: string; status: string; stepsDone: number; stepsTotal: number };
  worker: WorkWorker | null;
  /** When the task last changed. */
  since: string;
  /** The worker's own note on where the task is, or what is in the way. */
  note: string;
  project: { id: string; name: string } | null;
};

/** What a button needs to know to label itself. */
export type WorkSubject = {
  worker: WorkWorker | null;
  /** The manager's name, for the cards a person gets. */
  managerName?: string;
};

/** The first name is enough on a button. */
const short = (name: string) => name.trim().split(/\s+/)[0] || "them";

const OPTION: Record<WorkAction, (s: WorkSubject) => Omit<WorkOption, "id" | "action">> = {
  tell: ({ worker }) =>
    worker?.kind === "person"
      ? {
          label: `Tell ${short(worker.name)}`,
          effect: `Your message goes to ${short(worker.name)}'s Inbox. The answer comes back to you.`,
          input: "text",
          risk: "none",
        }
      : {
          label: "Tell it what to do",
          effect: `Your message goes to ${worker?.name ?? "the bot"} in its chat, and it goes on from there.`,
          input: "text",
          risk: "none",
        },
  resume: ({ worker }) => ({
    label: "Ask it to continue",
    effect: `${worker?.name ?? "The bot"} picks the task up again where it stopped.`,
    input: "none",
    risk: "none",
  }),
  reassign: () => ({
    label: "Give it to someone else",
    effect: "The task moves to who you pick, and they are told.",
    input: "target",
    risk: "none",
  }),
  mark_done: () => ({
    label: "It is done",
    effect: "The task closes as done.",
    input: "none",
    risk: "none",
  }),
  drop: () => ({
    label: "Drop the task",
    effect: "The task is deleted. You have a few seconds to undo.",
    input: "none",
    risk: "undoable",
  }),
  more_time: () => ({
    label: "Give it more time",
    effect: "This card goes away until tomorrow, or until the task changes.",
    input: "none",
    risk: "none",
  }),
  accept: () => ({
    label: "It's fine as it is",
    effect: "Zetta stops asking about the direction of this task.",
    input: "none",
    risk: "none",
  }),
  on_it: ({ managerName }) => ({
    label: "Yes, on it",
    effect: managerName
      ? `${short(managerName)} sees that you are on it.`
      : "Nobody is told. You are asked again only if it stays quiet.",
    input: "none",
    risk: "none",
  }),
  im_blocked: ({ managerName }) => ({
    label: "I'm blocked",
    effect: `Say what is in the way. ${managerName ? short(managerName) : "Your manager"} is told, so they can help.`,
    input: "text",
    risk: "none",
  }),
  its_done: () => ({
    label: "It's done",
    effect: "The task closes as done.",
    input: "none",
    risk: "none",
  }),
  reply: ({ managerName }) => ({
    label: "Reply",
    effect: `Your answer goes to ${managerName ? short(managerName) : "your manager"}.`,
    input: "text",
    risk: "none",
  }),
};

/** One option of an action, worded for who does the task. */
export const workOption = (
  action: WorkAction,
  s: WorkSubject,
  id: string = action,
): WorkOption => ({
  id,
  action,
  ...OPTION[action](s),
});

/** At most this many buttons on a card. */
export const WORK_OPTIONS_MAX = 4;

const DEFAULTS: Record<WorkCardKind, (s: WorkSubject) => WorkAction[]> = {
  // "Ask it to continue" only makes sense for a bot: a person is told, not restarted.
  work_stuck: (s) =>
    s.worker?.kind === "person"
      ? ["tell", "reassign", "more_time"]
      : ["tell", "resume", "reassign", "more_time"],
  work_blocked: () => ["tell", "reassign", "more_time"],
  work_drift: () => ["tell", "accept", "more_time"],
  work_checkin: () => ["on_it", "im_blocked", "its_done"],
  work_nudge: () => ["reply", "on_it", "im_blocked", "its_done"],
};

/** The buttons a card shows when Zetta suggested nothing: the usual next steps for its kind. */
export const defaultWorkOptions = (kind: WorkCardKind, s: WorkSubject): WorkOption[] =>
  DEFAULTS[kind](s).map((action) => workOption(action, s));

/** Which actions each kind of card accepts, whoever suggested them. */
export const ALLOWED_WORK_ACTIONS: Record<WorkCardKind, readonly WorkAction[]> = {
  work_stuck: ["tell", "resume", "reassign", "mark_done", "drop", "more_time"],
  work_blocked: ["tell", "resume", "reassign", "mark_done", "drop", "more_time"],
  work_drift: ["tell", "reassign", "mark_done", "drop", "more_time", "accept"],
  work_checkin: ["on_it", "im_blocked", "its_done"],
  work_nudge: ["reply", "on_it", "im_blocked", "its_done"],
};

/** Words of the code that must never reach a manager's screen. A test reads every label and effect against this. */
export const INTERNAL_WORDS =
  /follow-up|follow up|followup|stall|heartbeat|drift|fingerprint|paused|backlog|snooze/i;
