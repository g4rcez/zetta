/**
 * The phone calls live on this process, by bot, so the two tools of an outside caller's turn (`end_call`, `take_message`) reach the call
 * they belong to. A turn can only touch the call of its own bot, and a bot is on one call at a time.
 */
import type { VoiceCallOutcome } from "@zetta/db/schema/voice";
import { registerPlugin, PluginError, type PluginDef } from "../integrations/plugins/registry";

/** Why the bot ended a call. A closed list, never free text. */
export const CALL_OUTCOMES = ["done", "message_taken", "wrong_number", "spam", "refused"] as const;
export type CallOutcome = (typeof CALL_OUTCOMES)[number];

/** What a live outside call lets the bot do, and nothing else. */
export type CallTools = {
  /** The call hangs up once what the bot is saying has been heard. */
  endCall(outcome: CallOutcome): void;
  /** Saves a note for the owner and raises a card. */
  takeMessage(text: string): Promise<void>;
};

const liveByBot = new Map<string, CallTools>();
export const liveCalls = {
  set: (botId: string, tools: CallTools) => void liveByBot.set(botId, tools),
  clear: (botId: string, tools: CallTools) => {
    if (liveByBot.get(botId) === tools) liveByBot.delete(botId);
  },
  get: (botId: string) => liveByBot.get(botId),
};

/** What the bot of an outgoing call can do on it: end it with a closed outcome and a short summary. Nothing else. */
export type OutgoingTools = { endCall(outcome: VoiceCallOutcome, summary: string): void };
const outgoingByBot = new Map<string, OutgoingTools>();
export const outgoingCalls = {
  set: (botId: string, tools: OutgoingTools) => void outgoingByBot.set(botId, tools),
  clear: (botId: string, tools: OutgoingTools) => {
    if (outgoingByBot.get(botId) === tools) outgoingByBot.delete(botId);
  },
  get: (botId: string) => outgoingByBot.get(botId),
  has: (botId: string) => outgoingByBot.has(botId),
};

const def: PluginDef = {
  id: "phone",
  name: "Phone call",
  description:
    "Only while an outside person is on a phone call with you: take a message for your owner, or end the call. Nothing else is possible on a call.",
  icon: "phone-incoming",
  category: "messaging",
  auth: "none",
  fields: [],
  kind: "native",
  builtin: true,
  gate: {
    // Only a turn for outside people, and only while this bot has an outside call on this process.
    available: async (botId, _userId, turn) => turn === "inbound" && liveByBot.has(botId),
    refusal: {
      safe: "There is no phone call to act on.",
      fix: "These tools exist only during a call with an outside person.",
    },
  },
  tools: [
    {
      name: "take_message",
      description:
        "Write down a message for your owner from the caller. Say it back to the caller briefly. args: {text: what the caller wants your owner to know, with their name and a number if they gave one}",
      inputSchema: {
        type: "object",
        properties: { text: { type: "string", description: "The message for the owner." } },
        required: ["text"],
      },
      async handler(ctx, args) {
        const tools = ctx.botId ? liveByBot.get(ctx.botId) : undefined;
        if (!tools) throw new PluginError("NOT_BOUND", "There is no phone call to act on.");
        const text = String(args.text ?? "").trim();
        if (!text) throw new PluginError("INVALID_ARGS", "The message is empty.");
        await tools.takeMessage(text);
        return { saved: true };
      },
    },
    {
      name: "end_call",
      description:
        "Hang up once you have finished speaking. args: {outcome: one of done, message_taken, wrong_number, spam, refused}",
      inputSchema: {
        type: "object",
        properties: {
          outcome: { type: "string", enum: [...CALL_OUTCOMES], description: "How the call went." },
        },
        required: ["outcome"],
      },
      async handler(ctx, args) {
        const tools = ctx.botId ? liveByBot.get(ctx.botId) : undefined;
        if (!tools) throw new PluginError("NOT_BOUND", "There is no phone call to act on.");
        const outcome = (CALL_OUTCOMES as readonly string[]).includes(String(args.outcome))
          ? (String(args.outcome) as CallOutcome)
          : "done";
        tools.endCall(outcome);
        return { ending: true };
      },
    },
  ],
};

export const PHONE_PLUGIN = registerPlugin(def);
