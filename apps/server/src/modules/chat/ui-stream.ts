import { createUIMessageStream, type UIMessage } from "ai";
import type { ChatEvent } from "./service";

type SavedMessage = Extract<ChatEvent, { type: "message" }>["message"];

/** Data parts of the assistant UIMessage for one HTTP turn; the web client (`useChat`) renders against these names. */
export type ChatDataParts = {
  "user-saved": { message: SavedMessage };
  speaker: { messageId: string; botId: string; botName: string };
  saved: { message: SavedMessage; botName: string };
  proposal: { proposal: { id: string } };
  summary: { text: string };
  computer: { messageId: string; botId: string; vm: { id: string; name: string } };
};
export type ChatUIMessage = UIMessage<unknown, ChatDataParts>;

const errorText = (error: unknown) => (error instanceof Error && error.message === "TURN_BUSY" ? "This chat is still answering." : "Something went wrong. Please retry.");

/**
 * Re-encodes a chat turn as an AI SDK UI message stream: one turn is one assistant UIMessage, and each answering bot is a
 * `data-speaker` segment followed by its text part (id = the persisted message id), closed by `data-saved` with the DB row.
 */
export function toUIMessageStream(events: AsyncIterable<ChatEvent>) {
  return createUIMessageStream<ChatUIMessage>({
    onError: errorText,
    async execute({ writer }) {
      writer.write({ type: "start" });
      let open: string | undefined;
      const speak = (messageId: string, botId: string, botName: string) => {
        writer.write({ type: "data-speaker", id: messageId, data: { messageId, botId, botName } });
        writer.write({ type: "text-start", id: messageId });
        open = messageId;
      };
      for await (const ev of events) {
        if (ev.type === "user") writer.write({ type: "data-user-saved", id: ev.message.id, data: { message: ev.message } });
        else if (ev.type === "start") speak(ev.messageId, ev.botId, ev.botName);
        else if (ev.type === "delta") { if (open) writer.write({ type: "text-delta", id: open, delta: ev.text }); }
        else if (ev.type === "message") {
          // An idempotent retry replays saved replies without start/delta: emit the whole text so the part still exists.
          if (open !== ev.message.id) {
            speak(ev.message.id, ev.message.botId ?? "", ev.botName);
            if (ev.message.content) writer.write({ type: "text-delta", id: ev.message.id, delta: ev.message.content });
          }
          writer.write({ type: "text-end", id: ev.message.id });
          open = undefined;
          writer.write({ type: "data-saved", id: ev.message.id, data: { message: ev.message, botName: ev.botName } });
        } else if (ev.type === "proposal") writer.write({ type: "data-proposal", id: ev.proposalId, data: { proposal: { id: ev.proposalId } } });
        else if (ev.type === "summary") writer.write({ type: "data-summary", data: { text: ev.text } });
        else if (ev.type === "computer") writer.write({ type: "data-computer", id: `${ev.messageId}:${ev.vm.id}`, data: { messageId: ev.messageId, botId: ev.botId, vm: ev.vm } });
        else if (ev.type === "done") { writer.write({ type: "finish" }); return; }
      }
      if (open) writer.write({ type: "text-end", id: open });
    },
  });
}
