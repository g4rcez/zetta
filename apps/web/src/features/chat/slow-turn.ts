import { uuidv7 } from "@zetta/core/uuid";

import { call, cancelTurn, chatClient } from "./chat-client";

/** What the server knows about the turn of a chat (apps/server: GET /conversations/:id/turn). */
export type TurnProcess = { pid: number; command: string; runningFor?: number };
/** One running answer of the turn: the bot, its current step, and the processes of its CLI (listed only once the turn is slow). */
export type TurnAnswer = {
  messageId: string;
  botId: string;
  botName: string;
  step?: string;
  stepSince?: number;
  plan?: { done: number; total: number; active?: string };
  computer?: string;
  timeline: { at: number; label: string }[];
  processes: TurnProcess[];
};
export type TurnState = {
  running: boolean;
  idleMs: number;
  slowAfterMs: number;
  startedAt?: number;
  answers?: TurnAnswer[];
};

export const turnStateOf = (id: string) => call<TurnState>(`/api/conversations/${id}/turn`);
/** "Keep waiting": the server starts the silence timer again and closes the notification. */
export const keepWaiting = (id: string) => call(`/api/conversations/${id}/turn/wait`, "POST");
/** Stops the bot's turn now. */
export const stopTurn = cancelTurn;
/** Stops the turn, then queues a message that asks the bot to report what it has. The queue sends it when the turn has ended. */
export async function wrapUp(id: string) {
  await cancelTurn(id);
  await chatClient.enqueue(id, {
    clientRequestId: uuidv7(),
    content:
      "Wrap up now. Stop what is running. Tell me what is done, what is left, and what I can do next.",
  });
}

export type SlowTurnCommand = "stop" | "wrap-up" | "wait";
export const SLOW_TURN_COMMANDS: { command: SlowTurnCommand; help: string }[] = [
  { command: "stop", help: "stop the bot now" },
  { command: "wrap-up", help: "stop it and ask for what it has so far" },
  { command: "wait", help: "keep waiting, and warn me again later" },
];
/** `/stop`, `/wrap-up` or `/wait` alone in the text box; any other text is a normal message. */
export function slowTurnCommand(text: string): SlowTurnCommand | undefined {
  const word = /^\/(stop|wrap-up|wait)\s*$/i.exec(text.trim())?.[1]?.toLowerCase();
  return word as SlowTurnCommand | undefined;
}
export const runSlowTurnCommand = (id: string, command: SlowTurnCommand) =>
  command === "stop" ? stopTurn(id) : command === "wait" ? keepWaiting(id) : wrapUp(id);
