import type { Database } from "@zetta/db";
import { and, desc, eq } from "@zetta/db/query";
import { conversation } from "@zetta/db/schema/chat";
import { project, projectMember } from "@zetta/db/schema/projects";
import { z } from "zod";
import type { ChatService } from "../chat/service";
import { TurnBusyError } from "../chat/turns";
import { AccessError, type ActiveActor } from "../identity/access";
import { QUIET_MS } from "../tasks/follow-up";
import type { TaskStore } from "../tasks/store";
import { ProjectRuleError } from "./store";

export const workInput = z.strictObject({
  to: z.strictObject({ kind: z.enum(["bot", "person"]), id: z.string().min(1).max(200) }),
  /** What the manager wants, in their own words. The first line becomes the task's name. */
  text: z.string().trim().min(1).max(4000),
});
export type WorkInput = z.infer<typeof workInput>;

/** The first line names the task; the whole text is kept as its description when there is more than that line. */
export function taskFromText(text: string) {
  const first = text.split("\n")[0]!.trim();
  const title = first.length > 200 ? `${first.slice(0, 199)}…` : first;
  return { title, description: title === text ? "" : text };
}

export type BotChat = Pick<ChatService, "isBusy" | "startTurn" | "enqueue" | "createConversation">;

/** The manager's newest chat with a bot, or a new one when they never talked. */
export async function chatWith(db: Database, chat: BotChat, actor: ActiveActor, botId: string) {
  const [latest] = await db
    .select({ id: conversation.id })
    .from(conversation)
    .where(
      and(
        eq(conversation.ownerUserId, actor.userId),
        eq(conversation.botId, botId),
        eq(conversation.kind, "chat"),
        eq(conversation.archived, false),
      ),
    )
    .orderBy(desc(conversation.updatedAt))
    .limit(1);
  return latest?.id ?? (await chat.createConversation(actor, botId))!.id;
}

/** The manager's message in a chat: the bot answers at once, or after what it is doing when the chat is busy. Never waits for the reply. */
export async function sayInChat(
  chat: BotChat,
  actor: ActiveActor,
  conversationId: string,
  content: string,
) {
  const started = (await chat.isBusy(actor, conversationId))
    ? undefined
    : await chat.startTurn(actor, conversationId, { content }).catch((e) => {
        if (e instanceof TurnBusyError) return undefined;
        throw e;
      });
  if (!started) await chat.enqueue(actor, conversationId, { content });
}

/**
 * The manager asks for something from the project page. The task exists at once, filed under the project, so the page shows it without
 * waiting for anyone. A bot is then told in its chat with the manager and is called back until the task is done; a person gets a card.
 */
export function createProjectWork(deps: {
  db: Database;
  tasks: Pick<TaskStore, "create" | "ask" | "remove">;
  chat: BotChat;
}) {
  const { db, tasks, chat } = deps;
  return async function assign(actor: ActiveActor, projectId: string, v: WorkInput) {
    const [own] = await db
      .select({ id: project.id, name: project.name })
      .from(project)
      .where(and(eq(project.id, projectId), eq(project.ownerUserId, actor.userId)));
    if (!own) throw new AccessError("NOT_FOUND");
    const [member] = await db
      .select({ teamId: projectMember.teamId })
      .from(projectMember)
      .where(
        and(
          eq(projectMember.projectId, projectId),
          eq(projectMember.kind, v.to.kind),
          v.to.kind === "bot"
            ? eq(projectMember.botId, v.to.id)
            : eq(projectMember.userId, v.to.id),
        ),
      );
    if (!member)
      throw new ProjectRuleError(
        "BAD_MEMBER",
        "They are not on this project yet. Add them to it first.",
      );
    const { title, description } = taskFromText(v.text);
    if (v.to.kind === "person") {
      const made = await tasks.ask(actor, {
        title,
        description,
        assigneeUserId: v.to.id,
        teamId: member.teamId,
        projectId,
      });
      return { task: made, conversationId: null };
    }
    const conversationId = await chatWith(db, chat, actor, v.to.id);
    const made = await tasks.create(
      actor,
      {
        title,
        description,
        projectId,
        followUp: "auto",
        nextCheckAt: new Date(Date.now() + QUIET_MS),
      },
      { botId: v.to.id, conversationId },
    );
    // The bot is told which task this is, so it adds its steps there instead of opening a second task for the same request.
    const content = `${v.text}\n\nThis is the task “${title}” in the project “${own.name}”. It is already on your board: add your steps to that task and keep it up to date, do not add another one.`;
    try {
      await sayInChat(chat, actor, conversationId, content);
    } catch (e) {
      // The bot was never told (agents paused, the bot is not set up): a task nobody knows about must not stay on the board.
      await tasks.remove(actor, made.id).catch(() => {});
      throw e;
    }
    return { task: made, conversationId };
  };
}
export type ProjectWork = ReturnType<typeof createProjectWork>;
