import { CheckIcon, ChartBarHorizontalIcon, LockSimpleIcon } from "@phosphor-icons/react";
import { useContext } from "react";

import { BotAvatar } from "@/components/bot-avatar";
import { BotsContext } from "@/components/bot-identity";
import { Button } from "@/components/ui";
import { cn } from "@zetta/ui/lib/utils";

import type { PollView, PollVotes } from "./chat-client";
import { nextSelection, totalVotes } from "./poll-votes";

const MAX_FACES = 4;

/** One option: its label, a bar for its share, the count, and the faces of the bots that picked it. */
function PollOption({
  label,
  votes,
  share,
  closed,
  onPick,
}: {
  label: string;
  votes: PollVotes[string] | undefined;
  share: number;
  /** No more votes here: the poll is closed, or this page cannot vote. The results still show. */
  closed: boolean;
  onPick: () => void;
}) {
  const bots = useContext(BotsContext);
  const mine = votes?.mine ?? false;
  const botIds = votes?.botIds ?? [];
  const names = botIds.map((id) => bots.get(id)?.name ?? "A bot");
  return (
    <li>
      <button
        type="button"
        aria-pressed={mine}
        disabled={closed}
        onClick={onPick}
        className={cn(
          "relative flex w-full items-center gap-2 overflow-hidden rounded-md border px-2.5 py-1.5 text-left text-sm transition-colors focus-visible:outline-2 focus-visible:outline-ring",
          mine ? "border-primary" : "hover:border-foreground/30",
          closed && "cursor-default hover:border-border",
        )}
      >
        <span
          aria-hidden="true"
          className={cn("absolute inset-y-0 left-0", mine ? "bg-primary/20" : "bg-muted")}
          style={{ width: `${share}%` }}
        />
        <span className="relative flex size-4 shrink-0 items-center justify-center">
          {mine && <CheckIcon aria-hidden="true" weight="bold" className="size-3.5 text-primary" />}
        </span>
        <span className="relative min-w-0 flex-1 truncate">{label}</span>
        {botIds.length > 0 && (
          <span className="relative flex shrink-0 -space-x-1" title={`Voted: ${names.join(", ")}`}>
            {botIds.slice(0, MAX_FACES).map((id) => (
              <BotAvatar
                key={id}
                bot={bots.get(id) ?? { id }}
                size={16}
                className="ring-1 ring-background"
              />
            ))}
            <span className="sr-only">Voted: {names.join(", ")}</span>
          </span>
        )}
        <span className="relative shrink-0 text-xs tabular-nums text-muted-foreground">
          {votes?.count ?? 0} · {share}%
        </span>
      </button>
    </li>
  );
}

/**
 * A poll under a message: the question, the options with their results, and one click to vote. Voting again changes the choice, and a
 * click on the option you picked takes the vote back. A closed poll keeps its results and takes no more votes. Bots that voted show
 * their faces. `onClose` is only given to someone who may close it.
 */
export function PollCard({
  poll,
  votes,
  onVote,
  onClose,
}: {
  poll: PollView;
  votes: PollVotes;
  /** Without it the poll shows its results only. */
  onVote?: ((options: string[]) => void) | undefined;
  onClose?: (() => void) | undefined;
}) {
  const closed = poll.status === "closed";
  const total = totalVotes(votes);
  return (
    <section
      aria-label="Poll"
      className="flex w-full max-w-md flex-col gap-2 rounded-lg border bg-card p-3"
    >
      <header className="flex items-start gap-2">
        <ChartBarHorizontalIcon
          aria-hidden="true"
          className="mt-0.5 size-4 shrink-0 text-primary"
        />
        <div className="min-w-0 flex-1">
          <p className="break-words text-sm font-semibold">{poll.question}</p>
          <p className="text-xs text-muted-foreground">
            {poll.mode === "single" ? "One choice" : "Several choices"} · {total}{" "}
            {total === 1 ? "vote" : "votes"}
            {closed && (
              <span className="ml-1 inline-flex items-center gap-0.5">
                · <LockSimpleIcon aria-hidden="true" className="size-3" /> Closed
              </span>
            )}
          </p>
        </div>
      </header>
      <ul className="flex flex-col gap-1.5">
        {poll.options.map((o) => (
          <PollOption
            key={o.id}
            label={o.label}
            votes={votes[o.id]}
            share={total ? Math.round(((votes[o.id]?.count ?? 0) / total) * 100) : 0}
            closed={closed || !onVote}
            onPick={() => onVote?.(nextSelection(poll, votes, o.id))}
          />
        ))}
      </ul>
      {onClose && !closed && (
        <div className="flex justify-end">
          <Button size="sm" variant="ghost" onClick={onClose}>
            Close the poll
          </Button>
        </div>
      )}
    </section>
  );
}
