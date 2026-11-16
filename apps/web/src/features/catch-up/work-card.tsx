import { Link } from "@tanstack/react-router";
import { useEffect, useState } from "react";

import type { WorkDecision, WorkOption, WorkView } from "@zetta/core/work-suggestions";
import { BotIdentity } from "@/components/bot-identity";
import { Button, Select } from "@/components/ui";
import { UserAvatar } from "@/components/user-avatar";
import type { Bot } from "../chat/chat-client";
import { MentionField } from "../chat/mention";
import { relativeTime } from "../shared/relative-time";
import { Badge } from "../shared/ui";
import type { CatchUpCard } from "./catch-up-api";
import { SkipButton } from "./catch-up-card";

export type WorkCardItem = CatchUpCard & { work: WorkView };
export const isWorkCardItem = (card: CatchUpCard): card is WorkCardItem => card.work !== undefined;

/** A step that cannot be taken back waits this long, with an Undo, before it is sent. */
const UNDO_MS = 5000;

const PLACEHOLDER: Partial<Record<WorkOption["action"], string>> = {
  tell: "What should they do? Say it in your own words.",
  im_blocked: "What is in the way?",
  reply: "Your answer",
};

/** A key hint on a button. Phones have no keyboard, so it hides there. */
function Key({ children }: { children: string }) {
  return (
    <kbd className="hidden shrink-0 rounded border border-current/30 px-1 text-[10px] font-medium opacity-70 sm:inline">
      {children}
    </kbd>
  );
}

/** Who does the task: the bot's face, or the person's. Nothing when the task is nobody's yet. */
function Worker({ work, bot, when }: { work: WorkView; bot: Bot | undefined; when: string }) {
  if (bot) return <BotIdentity bot={bot} size={32} sub={when} />;
  if (work.worker?.kind === "person")
    return (
      <span className="flex min-w-0 items-center gap-2.5">
        <UserAvatar name={work.worker.name} size={32} />
        <span className="min-w-0">
          <span className="block truncate text-sm font-medium">{work.worker.name}</span>
          <span className="block text-xs text-muted-foreground">{when}</span>
        </span>
      </span>
    );
  return <span className="text-sm text-muted-foreground">{when}</span>;
}

/** What is known about the task, in plain lines. A card for the person asked keeps to the task itself. */
function Facts({ card }: { card: WorkCardItem }) {
  const { work } = card;
  const forManager = card.kind !== "work_checkin" && card.kind !== "work_nudge";
  const lines = [
    `Last change: ${relativeTime(work.since)}`,
    work.task.stepsTotal > 0
      ? `${work.task.stepsDone} of ${work.task.stepsTotal} steps done`
      : undefined,
    // A blocked card already says the note: it is the reason.
    forManager && card.kind !== "work_blocked" && work.note.trim()
      ? `Their last note: ${work.note.trim()}`
      : undefined,
  ].filter((l): l is string => Boolean(l));
  return (
    <ul className="space-y-1 rounded-lg bg-muted/50 px-3 py-2 text-sm text-pretty">
      {lines.map((l) => (
        <li key={l} className="line-clamp-3 break-words">
          {l}
        </li>
      ))}
    </ul>
  );
}

/** What the reader already decided about this task, so a second card does not start from zero. */
function Earlier({ history }: { history: WorkDecision[] }) {
  if (!history.length) return null;
  return (
    <section aria-label="What you chose before" className="text-sm">
      <h3 className="font-medium">What you chose before</h3>
      <ul className="mt-1 space-y-1 text-muted-foreground">
        {history.map((d) => (
          <li key={d.at} className="text-pretty">
            {d.label}
            {d.text ? `: “${d.text}”` : ""} · {relativeTime(d.at)}
          </li>
        ))}
      </ul>
    </section>
  );
}

/** One next step: what it is called and, under it, what pressing it does. */
function OptionButton({
  option,
  index,
  busy,
  onPick,
}: {
  option: WorkOption;
  index: number;
  busy: boolean;
  onPick: () => void;
}) {
  return (
    <button
      type="button"
      disabled={busy}
      // The first step is what the A key presses; every step answers to its number.
      {...(index === 0 ? { "data-catch-up": "act" } : {})}
      data-catch-up-option={index + 1}
      onClick={onPick}
      className="flex min-w-0 items-start gap-3 rounded-lg border bg-background px-3 py-2 text-left transition-colors hover:border-primary hover:bg-primary/[0.06] focus-visible:outline-2 focus-visible:outline-ring disabled:opacity-60"
    >
      <span className="min-w-0 flex-1">
        <span className="block text-sm font-medium">{option.label}</span>
        <span className="block text-xs text-pretty text-muted-foreground">{option.effect}</span>
      </span>
      <Key>{String(index + 1)}</Key>
    </button>
  );
}

/**
 * A card about a task that needs somebody: what happened, what is known, and a few next steps. Each step says what it does before it is
 * pressed. A step that sends words shows them first, ready to change; one that gives the task away asks who gets it; one that cannot be
 * taken back waits a few seconds with an Undo.
 */
export function WorkCard({
  card,
  bot,
  bots,
  busy,
  error,
  onChoose,
  onDeny,
  onSkip,
}: {
  card: WorkCardItem;
  bot: Bot | undefined;
  bots: Bot[];
  busy: boolean;
  error: string | undefined;
  onChoose: (choice: { option: string; text?: string; target?: string }) => void;
  onDeny: () => void;
  /** Absent when there is no other card to go to. */
  onSkip: (() => void) | undefined;
}) {
  const { work } = card;
  const [picked, setPicked] = useState<WorkOption>();
  const [text, setText] = useState("");
  const [target, setTarget] = useState("");
  const [armed, setArmed] = useState<WorkOption>();
  const [missing, setMissing] = useState<string>();

  // A step that cannot be taken back is only armed: it is sent when the undo window ends. Leaving the card drops it.
  useEffect(() => {
    if (!armed) return;
    const timer = setTimeout(() => {
      setArmed(undefined);
      onChoose({ option: armed.id });
    }, UNDO_MS);
    return () => clearTimeout(timer);
    // `onChoose` is a new function on every render of the page; the armed step is what starts the wait.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [armed]);

  function pick(option: WorkOption) {
    setMissing(undefined);
    if (option.risk === "undoable") return setArmed(option);
    if (option.input === "none") return onChoose({ option: option.id });
    // The words Zetta suggests are shown before anything is sent, and the person changes them freely.
    setText(option.text ?? "");
    setTarget(option.target ?? work.candidates[0]?.key ?? "");
    setPicked(option);
  }
  function send() {
    if (!picked) return;
    if (picked.input === "text" && !text.trim()) return setMissing("Write a message first.");
    if (picked.input === "target" && !target) return setMissing("Pick who gets the task first.");
    onChoose({
      option: picked.id,
      ...(picked.input === "text" && { text: text.trim() }),
      ...(picked.input === "target" && { target }),
    });
  }
  return (
    <article
      aria-label={card.title}
      className="space-y-4 rounded-2xl border bg-card p-5 shadow-sm sm:p-6"
    >
      <header className="flex flex-wrap items-start justify-between gap-3">
        <Worker work={work} bot={bot} when={relativeTime(card.createdAt)} />
        <span className="flex flex-wrap items-center gap-2">
          {work.project && (
            <Link
              to="/projects/$projectId"
              params={{ projectId: work.project.id }}
              className="text-sm text-muted-foreground underline underline-offset-2"
            >
              {work.project.name}
            </Link>
          )}
          {card.occurrences > 1 && <Badge tone="warning">Happened {card.occurrences} times</Badge>}
        </span>
      </header>
      <div className="space-y-1">
        <h2 className="text-lg font-semibold text-balance">{card.title}</h2>
        {(work.summary || card.detail) && (
          <p className="whitespace-pre-wrap text-sm text-pretty text-muted-foreground">
            {work.summary || card.detail}
          </p>
        )}
      </div>
      <Facts card={card} />
      <Earlier history={work.history} />
      {armed ? (
        <div
          role="status"
          className="flex items-center justify-between gap-3 rounded-lg border bg-muted/50 px-4 py-2 text-sm"
        >
          <span>{armed.label}: in a few seconds.</span>
          <Button size="sm" variant="outline" onClick={() => setArmed(undefined)}>
            Undo
          </Button>
        </div>
      ) : picked ? (
        <section aria-label={picked.label} className="space-y-3 rounded-xl border bg-muted/30 p-4">
          <p className="text-sm text-pretty">{picked.effect}</p>
          {picked.input === "text" && (
            <div data-catch-up-input>
              <MentionField
                bots={bots}
                value={text}
                onChange={setText}
                rows={3}
                autoFocus
                disabled={busy}
                placeholder={PLACEHOLDER[picked.action] ?? "Write a message"}
                aria-label={picked.label}
                wrapperClassName="rounded-lg border bg-background px-3 py-2"
                onKeyDown={(e) => {
                  // Ctrl or Cmd with Enter sends; Enter alone adds a line.
                  if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) {
                    e.preventDefault();
                    send();
                  }
                }}
              />
            </div>
          )}
          {picked.input === "target" && (
            <Select
              title="Who gets it"
              required={false}
              container="max-w-xs"
              value={target}
              options={work.candidates.map((c) => ({
                value: c.key,
                label: c.kind === "bot" ? `${c.name} (bot)` : c.name,
              }))}
              onChange={(e) => setTarget(e.target.value)}
            />
          )}
          <div className="flex flex-wrap justify-end gap-2">
            <Button variant="ghost" disabled={busy} onClick={() => setPicked(undefined)}>
              Back
            </Button>
            <Button variant="success" disabled={busy} data-catch-up="send" onClick={send}>
              {picked.label}
            </Button>
          </div>
        </section>
      ) : (
        <section aria-label="What you can do" className="grid gap-2 sm:grid-cols-2">
          {work.options.map((o, i) => (
            <OptionButton key={o.id} option={o} index={i} busy={busy} onPick={() => pick(o)} />
          ))}
        </section>
      )}
      {(missing ?? error) && (
        <p role="alert" className="text-sm text-destructive">
          {missing ?? error}
        </p>
      )}
      <footer className="flex flex-wrap items-center justify-between gap-2">
        {card.resultLink ? (
          <Link
            to={card.resultLink as never}
            className="text-sm text-muted-foreground underline underline-offset-2"
          >
            Open the task
          </Link>
        ) : (
          <span />
        )}
        <div className="flex flex-wrap items-center gap-2">
          {onSkip && <SkipButton onSkip={onSkip} />}
          <Button variant="outline" disabled={busy} data-catch-up="deny" onClick={onDeny}>
            {card.actions.denyLabel}
            <kbd className="ml-2 hidden rounded border border-current/30 px-1 text-[10px] font-medium opacity-70 sm:inline">
              D
            </kbd>
          </Button>
        </div>
      </footer>
    </article>
  );
}
