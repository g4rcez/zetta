import type { WorkCandidate } from "@zetta/core/work-suggestions";
import type { Database } from "@zetta/db";
import { and, desc, eq, isNull } from "@zetta/db/query";
import { message } from "@zetta/db/schema/chat";
import { project } from "@zetta/db/schema/projects";
import { task } from "@zetta/db/schema/tasks";
import { dataBlock } from "../chat/one-shot";
import { looksSecret } from "../features/safety";
import { briefLines } from "../projects/context";
import type { TaskFacts } from "./facts";

/** How much of the task's chat a check reads, newest last. */
const MESSAGES = 6;
const MESSAGE_CHARS = 600;

/** What is known about a task, gathered for one question to the chief engine. */
export type Situation = {
  facts: TaskFacts;
  /** The person's own words that started the task, or its description when no message is linked. */
  request: string;
  steps: { title: string; status: string }[];
  messages: { role: string; content: string }[];
  /** The brief of the task's project, one labelled line per answer. */
  brief: string[];
  candidates: WorkCandidate[];
};

export async function loadSituation(
  db: Pick<Database, "select">,
  f: TaskFacts,
  deps: {
    requestOf: (t: { messageId: string | null }) => Promise<string>;
    candidates: (f: TaskFacts) => Promise<WorkCandidate[]>;
  },
): Promise<Situation> {
  const [request, steps, messages, briefRow, candidates] = await Promise.all([
    deps.requestOf(f.task),
    db
      .select({ title: task.title, status: task.status })
      .from(task)
      .where(eq(task.parentTaskId, f.task.id))
      .orderBy(task.createdAt, task.id),
    f.task.conversationId
      ? db
          .select({ role: message.role, content: message.content })
          .from(message)
          .where(
            and(
              eq(message.conversationId, f.task.conversationId),
              isNull(message.parentMessageId),
              eq(message.status, "complete"),
            ),
          )
          .orderBy(desc(message.seq))
          .limit(MESSAGES)
      : [],
    f.project
      ? db
          .select({
            outcome: project.outcome,
            audience: project.audience,
            doneWhen: project.doneWhen,
            notIncluded: project.notIncluded,
          })
          .from(project)
          .where(eq(project.id, f.project.id))
      : [],
    deps.candidates(f),
  ]);
  return {
    facts: f,
    request: request.trim() || f.task.description.trim(),
    steps,
    messages: messages
      .filter((m) => m.role !== "system")
      .reverse()
      .map((m) => ({ role: m.role, content: m.content.slice(0, MESSAGE_CHARS) })),
    brief: briefRow[0] ? briefLines(briefRow[0]) : [],
    candidates,
  };
}

/** The task as data blocks for a prompt. Every block is framed so its text cannot close the block or pass as an instruction. */
export function situationBlocks(s: Situation): string[] {
  const { facts: f } = s;
  const worker = f.worker
    ? `${f.worker.name} (${f.worker.kind === "bot" ? "a bot" : "a person"})`
    : "nobody yet";
  return [
    dataBlock(
      "task",
      [
        `Title: ${f.task.title}`,
        `Status: ${f.task.status}`,
        `Who does it: ${worker}`,
        s.steps.length
          ? `Steps:\n${s.steps.map((x) => `- [${x.status === "done" ? "done" : "open"}] ${x.title}`).join("\n")}`
          : "Steps: none planned",
        f.task.progress.trim()
          ? `Their own note on where it stands: ${f.task.progress.trim()}`
          : "",
      ]
        .filter(Boolean)
        .join("\n"),
    ),
    dataBlock("what-was-asked", s.request || "(not recorded)"),
    s.brief.length
      ? dataBlock("project", [`Project: ${f.project?.name ?? ""}`, ...s.brief].join("\n"))
      : "",
    s.messages.length
      ? dataBlock(
          "recent-conversation",
          s.messages
            .map((m) => `${m.role === "user" ? "Manager" : "Worker"}: ${m.content}`)
            .join("\n"),
        )
      : "",
  ].filter(Boolean);
}

/** The situation goes to an engine run by a third party: one that looks like it holds a secret is not sent. */
export const holdsSecret = (s: Situation) =>
  looksSecret(
    [
      s.facts.task.title,
      s.facts.task.progress,
      s.request,
      ...s.brief,
      ...s.messages.map((m) => m.content),
    ].join("\n"),
  );
