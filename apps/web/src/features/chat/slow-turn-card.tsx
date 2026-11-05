import { useQuery } from "@tanstack/react-query";
import { pollEvery } from "@/lib/query-policy";
import { useCallback, useState } from "react";
import { HourglassMediumIcon, NotePencilIcon, SquareIcon } from "@phosphor-icons/react";

import { Button } from "@/components/ui";

import { BotIdentity } from "@/components/bot-identity";
import { useTimeFormat } from "@/features/preferences/preferences";
import { formatTime } from "@/features/preferences/time-format";
import { errorMessage } from "./chat-client";
import { useSidebarData } from "./sidebar-data";
import {
  SLOW_TURN_COMMANDS,
  runSlowTurnCommand,
  turnStateOf,
  type SlowTurnCommand,
  type TurnAnswer,
  type TurnState,
} from "./slow-turn";

const POLL_MS = 15_000;

/** The server's view of this chat's turn, read every 15 s while the tab is visible and a turn is `active` (otherwise once, and on focus).
 * It is the server's view, not the stream's: a turn can run on after the stream closed. */
export function useTurnState(conversationId: string | undefined, active: boolean) {
  const query = useQuery({
    queryKey: ["conversations", conversationId, "turn"],
    queryFn: () => turnStateOf(conversationId!),
    enabled: !!conversationId,
    refetchInterval: pollEvery(POLL_MS, false, active),
  });
  const { refetch } = query;
  const refresh = useCallback(async () => void (await refetch()), [refetch]);
  return { state: conversationId ? query.data : undefined, refresh };
}

const minutes = (ms: number) => Math.max(1, Math.round(ms / 60_000));
const duration = (seconds: number) =>
  seconds < 90
    ? `${seconds} s`
    : seconds < 5400
      ? `${Math.round(seconds / 60)} min`
      : `${(seconds / 3600).toFixed(1)} h`;

/** What one running answer is doing: its step, plan, computer step, the processes of its CLI and the steps before. */
function AnswerDetails({ answer }: { answer: TurnAnswer }) {
  const tf = useTimeFormat();
  const { bots } = useSidebarData();
  const bot = bots.find((b) => b.id === answer.botId) ?? { id: answer.botId, name: answer.botName };
  const [cli, ...below] = answer.processes;
  return (
    <div className="space-y-1.5 rounded-md border bg-background/40 p-2">
      <BotIdentity
        bot={bot}
        size={20}
        sub={
          answer.step ? (
            <>
              Now: {answer.step}
              {answer.stepSince !== undefined && <> · since {formatTime(answer.stepSince, tf)}</>}
            </>
          ) : undefined
        }
      />
      {answer.plan && (
        <p className="text-xs text-muted-foreground">
          Plan: {answer.plan.done} of {answer.plan.total} steps done
          {answer.plan.active ? ` · working on “${answer.plan.active}”` : ""}
        </p>
      )}
      {answer.computer && (
        <p className="text-xs text-muted-foreground">On its computer: {answer.computer}</p>
      )}
      {cli && (
        <div className="space-y-0.5 text-xs">
          <p className="text-muted-foreground">
            Process {cli.command} (PID {cli.pid}
            {cli.runningFor !== undefined ? `, running for ${duration(cli.runningFor)}` : ""})
          </p>
          {below.length === 0 ? (
            <p className="text-muted-foreground">
              No child process: the CLI is waiting on its model.
            </p>
          ) : (
            <ul className="space-y-0.5 font-mono">
              {below.map((p) => (
                <li key={p.pid} className="truncate" title={p.command}>
                  {p.command}
                  <span className="font-sans text-muted-foreground">
                    {" "}
                    · PID {p.pid}
                    {p.runningFor !== undefined ? ` · ${duration(p.runningFor)}` : ""}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
      {answer.timeline.length > 0 && (
        <details className="text-xs text-muted-foreground">
          <summary className="cursor-pointer">Earlier steps</summary>
          <ol className="mt-1 space-y-0.5">
            {answer.timeline.map((t) => (
              <li key={`${t.at}-${t.label}`}>
                {formatTime(t.at, tf)} · {t.label}
              </li>
            ))}
          </ol>
        </details>
      )}
    </div>
  );
}

/** Shown above the composer when the bot has said nothing for a long time: says why, and offers the ways out as buttons and typed commands. */
export function SlowTurnCard({
  conversationId,
  botName,
  state,
  onDone,
  onError,
}: {
  conversationId: string;
  botName?: string | undefined;
  state: TurnState | undefined;
  onDone: () => void;
  onError: (message: string) => void;
}) {
  const [busy, setBusy] = useState<SlowTurnCommand>();
  const tf = useTimeFormat();
  if (!state?.running || state.idleMs < state.slowAfterMs) return null;
  const answers = state.answers ?? [];
  const who = answers.length === 1 ? answers[0]!.botName : botName;
  const run = async (command: SlowTurnCommand) => {
    setBusy(command);
    try {
      await runSlowTurnCommand(conversationId, command);
      onDone();
    } catch (e) {
      onError(errorMessage(e));
    } finally {
      setBusy(undefined);
    }
  };
  return (
    <div
      role="status"
      aria-label="The bot is taking a long time"
      className="flex flex-col gap-2 rounded-lg border border-warn/40 bg-warn/5 px-3 py-2 text-sm"
    >
      <div className="flex items-start gap-3">
        <HourglassMediumIcon className="mt-0.5 size-4 shrink-0 text-muted-foreground" />
        <div className="min-w-0 flex-1">
          <p className="font-medium">
            {who ?? "The bot"} is taking a long time
            <span className="font-normal text-muted-foreground">
              {" "}
              · no new output for {minutes(state.idleMs)} min
              {state.startedAt !== undefined && (
                <> · turn started {formatTime(state.startedAt, tf)}</>
              )}
            </span>
          </p>
          <p className="text-xs text-muted-foreground">
            It may wait on a slow command or job. You can stop it, ask it to wrap up, or keep
            waiting. Typed in the message box:{" "}
            {SLOW_TURN_COMMANDS.map((c, i) => (
              <span key={c.command}>
                {i > 0 && ", "}
                <code>/{c.command}</code> ({c.help})
              </span>
            ))}
            .
          </p>
        </div>
      </div>
      {answers.map((a) => (
        <AnswerDetails key={a.messageId} answer={a} />
      ))}
      <div className="flex flex-wrap justify-end gap-2">
        <Button size="sm" variant="outline" disabled={!!busy} onClick={() => void run("wait")}>
          <HourglassMediumIcon /> Keep waiting
        </Button>
        <Button size="sm" variant="outline" disabled={!!busy} onClick={() => void run("wrap-up")}>
          <NotePencilIcon /> Wrap up
        </Button>
        <Button size="sm" variant="outline" disabled={!!busy} onClick={() => void run("stop")}>
          <SquareIcon /> Stop now
        </Button>
      </div>
    </div>
  );
}
