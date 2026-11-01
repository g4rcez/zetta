import { createUIMessageStream, type UIMessage } from "ai";
import type { ChatEvent } from "./service";

type SavedMessage = Extract<ChatEvent, { type: "message" }>["message"];

/** Data parts of the assistant UIMessage for one HTTP turn; the web client (`useChat`) renders against these names. */
export type ChatDataParts = {
  "user-saved": { message: SavedMessage };
  speaker: { messageId: string; botId: string; botName: string; parentMessageId?: string };
  saved: { message: SavedMessage; botName: string };
  proposal: { proposal: { id: string } };
  summary: { text: string };
  computer: { messageId: string; botId: string; vm: { id: string; name: string } };
  "computer-step": { messageId: string; vmId: string; step: string; at: number };
  activity: { messageId: string; label: string; at: number };
  artifact: { messageId: string; id: string; title: string; at: number };
  steer: { messageId: string; noteIds: string[] };
  plan: {
    messageId: string;
    steps: { id: string; title: string; status: "pending" | "active" | "done" }[];
  };
};
export type ChatUIMessage = UIMessage<unknown, ChatDataParts>;

const errorText = (error: unknown) =>
  error instanceof Error && error.message === "TURN_BUSY"
    ? "This chat is still answering."
    : "Something went wrong. Please retry.";

/**
 * Re-encodes a chat turn as an AI SDK UI message stream: one turn is one assistant UIMessage, and each answering bot is a
 * `data-speaker` segment followed by its text part (id = the persisted message id), closed by `data-saved` with the DB row.
 */
export function toUIMessageStream(events: AsyncIterable<ChatEvent>) {
  return createUIMessageStream<ChatUIMessage>({
    onError: errorText,
    async execute({ writer }) {
      writer.write({ type: "start" });
      // Several bots may answer at once, so more than one text part can be open: each delta names its own.
      const open = new Set<string>();
      const speak = (messageId: string, botId: string, botName: string, parent?: string | null) => {
        writer.write({
          type: "data-speaker",
          id: messageId,
          data: { messageId, botId, botName, ...(parent ? { parentMessageId: parent } : {}) },
        });
        writer.write({ type: "text-start", id: messageId });
        open.add(messageId);
      };
      for await (const ev of events) {
        if (ev.type === "user")
          writer.write({
            type: "data-user-saved",
            id: ev.message.id,
            data: { message: ev.message },
          });
        else if (ev.type === "start") speak(ev.messageId, ev.botId, ev.botName, ev.parentMessageId);
        else if (ev.type === "delta") {
          if (open.has(ev.messageId))
            writer.write({ type: "text-delta", id: ev.messageId, delta: ev.text });
        } else if (ev.type === "message") {
          // An idempotent retry replays saved replies without start/delta: emit the whole text so the part still exists.
          if (!open.has(ev.message.id)) {
            speak(ev.message.id, ev.message.botId ?? "", ev.botName, ev.message.parentMessageId);
            if (ev.message.content)
              writer.write({ type: "text-delta", id: ev.message.id, delta: ev.message.content });
          }
          writer.write({ type: "text-end", id: ev.message.id });
          open.delete(ev.message.id);
          writer.write({
            type: "data-saved",
            id: ev.message.id,
            data: { message: ev.message, botName: ev.botName },
          });
        } else if (ev.type === "proposal")
          writer.write({
            type: "data-proposal",
            id: ev.proposalId,
            data: { proposal: { id: ev.proposalId } },
          });
        else if (ev.type === "summary")
          writer.write({ type: "data-summary", data: { text: ev.text } });
        else if (ev.type === "activity")
          // No id: every label is its own part, so the client can build the work timeline.
          writer.write({
            type: "data-activity",
            data: { messageId: ev.messageId, label: ev.label, at: ev.at },
          });
        else if (ev.type === "steer")
          // A signal, not content: the client reloads the chat to see the notes leave the queue, and it need not keep the part.
          writer.write({
            type: "data-steer",
            data: { messageId: ev.messageId, noteIds: ev.noteIds },
            transient: true,
          });
        else if (ev.type === "plan")
          // One id per message: each update replaces the part, so the client always reads the latest list.
          writer.write({
            type: "data-plan",
            id: `${ev.messageId}:plan`,
            data: { messageId: ev.messageId, steps: ev.steps },
          });
        else if (ev.type === "artifact")
          writer.write({
            type: "data-artifact",
            id: `${ev.messageId}:${ev.id}`,
            data: { messageId: ev.messageId, id: ev.id, title: ev.title, at: ev.at },
          });
        else if (ev.type === "computer") {
          writer.write({
            type: "data-computer",
            id: `${ev.messageId}:${ev.vm.id}`,
            data: { messageId: ev.messageId, botId: ev.botId, vm: ev.vm },
          });
          // Each step is its own part (no id), so the live card can list what the bot did on the computer, newest last.
          if (ev.step)
            writer.write({
              type: "data-computer-step",
              data: { messageId: ev.messageId, vmId: ev.vm.id, step: ev.step, at: Date.now() },
            });
        } else if (ev.type === "done") {
          writer.write({ type: "finish" });
          return;
        }
      }
      for (const id of open) writer.write({ type: "text-end", id });
    },
  });
}
