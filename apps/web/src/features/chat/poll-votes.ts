import type { PollView, PollVotes } from "./chat-client";

/** The text a poll message carries when its author wrote nothing else; the page draws the card instead of repeating it. */
export const pollBody = (poll: Pick<PollView, "question">) => `📊 ${poll.question}`;

/** How many votes were cast in all: a voter of a several-choice poll counts once per pick. */
export const totalVotes = (votes: PollVotes) =>
  Object.values(votes).reduce((n, t) => n + t.count, 0);

/** The option ids the viewer has picked. */
export const mineOf = (poll: PollView, votes: PollVotes) =>
  poll.options.filter((o) => votes[o.id]?.mine).map((o) => o.id);

/**
 * What the viewer's whole choice becomes when they click an option. One choice: the option, or nothing when it was already theirs.
 * Several choices: the option is added to what they picked, or taken out of it.
 */
export function nextSelection(poll: PollView, votes: PollVotes, optionId: string): string[] {
  const mine = mineOf(poll, votes);
  if (poll.mode === "single") return mine.includes(optionId) ? [] : [optionId];
  return mine.includes(optionId) ? mine.filter((id) => id !== optionId) : [...mine, optionId];
}

/** The votes as they will be once the viewer's choice is `picks`, so the page can show it before the server answers. */
export function applyVote(votes: PollVotes, picks: readonly string[]): PollVotes {
  const next: PollVotes = {};
  for (const [id, t] of Object.entries(votes)) {
    const count = t.count - (t.mine ? 1 : 0);
    if (count > 0 || t.botIds.length) next[id] = { ...t, count, mine: false };
  }
  for (const id of picks) {
    const t = next[id] ?? { count: 0, mine: false, botIds: [] };
    next[id] = { ...t, count: t.count + 1, mine: true };
  }
  return next;
}
