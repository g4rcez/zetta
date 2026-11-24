import type { Database } from "@zetta/db";
import { eq, sql } from "@zetta/db/query";
import { message } from "@zetta/db/schema/chat";
import type { ActiveActor } from "../identity/access";
import type { ChatEvent, ChatService } from "../chat/service";
import type { TurnEvent, TurnFollower, TurnHandle } from "./core/types";

/** What the follower needs of the chat: the same calls a typed message uses. */
export type FollowerChat = Pick<ChatService, "startTurn" | "enqueue" | "isBusy" | "cancelTurn">;

/** An async queue the turn's events are pushed into; the voice session reads it as its `events`. */
function eventQueue() {
  const items: (TurnEvent | null)[] = [];
  let wake: (() => void) | null = null;
  const push = (e: TurnEvent | null) => {
    items.push(e);
    wake?.();
  };
  const iterable: AsyncIterable<TurnEvent> = {
    [Symbol.asyncIterator]: () => ({
      next: async () => {
        while (!items.length) await new Promise<void>((r) => (wake = r));
        const e = items.shift()!;
        return e === null
          ? { done: true as const, value: undefined }
          : { done: false as const, value: e };
      },
    }),
  };
  return { push, iterable };
}

/** The ids of the rows a spoken turn wrote, and how much of its reply the person heard. */
export type SpokenReply = { spokenChars: number; replyChars: number; interrupted: boolean };

/**
 * The voice session's turn, on the chat service: what the person said is their message in this conversation (marked `meta.voice.callId`)
 * and the bot answers it exactly as it answers a typed one (same scope, permissions, memory), so the call is also a chat anyone can read
 * later. A message said while the bot works goes through the late-message path, and "stop" is the chat's stop.
 */
export function createChatTurnFollower(deps: {
  db: Pick<Database, "update">;
  chat: FollowerChat;
  actor: ActiveActor;
  conversationId: string;
  callId: string;
  /**
   * A phone call: what `startTurn` gets for the words said. Late words are then kept and run as the next turn of the same call, never
   * queued, because a queued message would later run as if the person had typed it.
   */
  turnInput?: (words: string, language?: string) => Parameters<FollowerChat["startTurn"]>[2];
}) {
  const { db, chat, actor, conversationId, callId } = deps;
  const held: string[] = [];
  const mark = (id: string, voice: Record<string, unknown>) =>
    db
      .update(message)
      .set({
        meta: sql`coalesce(${message.meta}, '{}'::jsonb) || ${JSON.stringify({ voice: { callId, ...voice } })}::jsonb`,
      })
      .where(eq(message.id, id))
      .then(
        () => undefined,
        () => undefined,
      );
  // What the person heard of each reply, summed over the pieces of one reply, written once its turn is over.
  const heard = new Map<string, SpokenReply>();
  let replyId: string | null = null;
  let running = 0;
  const flush = async () => {
    for (const [id, h] of heard)
      await mark(id, {
        spokenChars: h.spokenChars,
        replyChars: h.replyChars,
        interrupted: h.interrupted,
      });
    heard.clear();
  };
  let turnDone: Promise<void> = Promise.resolve();

  const follower: TurnFollower & {
    /** The session says how much of the reply was heard. */
    reportReply(r: SpokenReply): Promise<void>;
    /** Waits until the turns this follower started are over and what was heard is saved. */
    settled(): Promise<void>;
  } = {
    start(text, opts) {
      const q = eventQueue();
      running++;
      const finish = () => q.push(null);
      const follow = async (turn: Awaited<ReturnType<FollowerChat["startTurn"]>>) => {
        for await (const { event } of turn.follow(0)) {
          const e = event as ChatEvent;
          if (e.type === "user") void mark(e.message.id, {});
          else if (e.type === "start") replyId = e.messageId;
          else if (e.type === "delta") {
            replyId = e.messageId;
            if (e.text) q.push({ kind: "delta", text: e.text });
          } else if (
            e.type === "activity" ||
            e.type === "computer" ||
            e.type === "artifact" ||
            e.type === "plan"
          )
            q.push({ kind: "tool" });
        }
      };
      replyId = null;
      turnDone = (async () => {
        let words = text;
        try {
          for (;;) {
            try {
              let turn: Awaited<ReturnType<FollowerChat["startTurn"]>> | undefined;
              try {
                turn = await chat.startTurn(
                  actor,
                  conversationId,
                  deps.turnInput
                    ? deps.turnInput(words, opts?.language)
                    : { content: words, voice: { callId, language: opts?.language } },
                );
              } catch {
                // A turn that cannot start (another turn is running in this chat) is not lost: the message is saved and answered in the
                // chat text, where the person can read it. A phone call has no such place: its words are dropped.
                if (!deps.turnInput)
                  await chat
                    .enqueue(actor, conversationId, { content: words })
                    .then((m) => mark(m.id, {}))
                    .catch(() => undefined);
                held.length = 0;
                return;
              }
              await follow(turn).catch(() => undefined);
            } finally {
              // Counted out first: a reply the session reports from now on saves itself.
              running--;
              await flush();
            }
            if (!held.length) return;
            running++;
            words = held.splice(0).join(" ");
          }
        } finally {
          finish();
        }
      })();
      const handle: TurnHandle = {
        events: q.iterable,
        async sendLate(late) {
          if (deps.turnInput) {
            held.push(late);
            return;
          }
          const saved = await chat.enqueue(actor, conversationId, { content: late });
          void mark(saved.id, {});
        },
        async stop() {
          await chat.cancelTurn(actor, conversationId);
        },
      };
      return handle;
    },
    async reportReply(r) {
      if (!replyId) return;
      const before = heard.get(replyId);
      heard.set(replyId, {
        spokenChars: (before?.spokenChars ?? 0) + r.spokenChars,
        replyChars: (before?.replyChars ?? 0) + r.replyChars,
        interrupted: (before?.interrupted ?? false) || r.interrupted,
      });
      // The turn is already over: nothing will flush it later.
      if (running === 0) await flush();
    },
    async settled() {
      await turnDone;
      await flush();
    },
  };
  return follower;
}
