import { PlusIcon, XIcon } from "@phosphor-icons/react";

import { ActionHint } from "@/components/action-hint";
import { Button, Input } from "@/components/ui";
import { cn } from "@zetta/ui/lib/utils";

export type PollMode = "single" | "multiple";
/** A poll being written in the composer: the box's own text is the question; these are its options. */
export type PollDraft = { options: string[]; mode: PollMode };

export const MIN_POLL_OPTIONS = 2;
export const MAX_POLL_OPTIONS = 10;
export const NEW_POLL: PollDraft = { options: ["", ""], mode: "single" };

/** The options as they will be sent: trimmed, and the empty ones dropped. */
export const pollOptionsOf = (draft: PollDraft) =>
  draft.options.map((o) => o.trim()).filter(Boolean);

/** A poll can be sent with 2 to 10 options that differ (the same text in another case is the same option). Without a poll: always. */
export function pollDraftReady(draft: PollDraft | undefined): boolean {
  if (!draft) return true;
  const options = pollOptionsOf(draft);
  return (
    options.length >= MIN_POLL_OPTIONS &&
    options.length <= MAX_POLL_OPTIONS &&
    new Set(options.map((o) => o.toLowerCase())).size === options.length
  );
}

const MODES: { mode: PollMode; label: string }[] = [
  { mode: "single", label: "One choice" },
  { mode: "multiple", label: "Several choices" },
];

/**
 * The options of the poll the composer is writing. The text box below it is the question, so `@` and `#` work there as always;
 * the options are short labels, so they are plain fields.
 */
export function PollDraftEditor({
  draft,
  onChange,
  onClose,
}: {
  draft: PollDraft;
  onChange: (next: PollDraft) => void;
  onClose: () => void;
}) {
  const set = (i: number, value: string) =>
    onChange({ ...draft, options: draft.options.map((o, n) => (n === i ? value : o)) });
  return (
    <section aria-label="Poll" className="flex w-full flex-col gap-2 text-xs">
      <div className="flex items-center gap-2">
        <span className="font-semibold text-foreground">Poll</span>
        <span className="min-w-0 flex-1 truncate text-muted-foreground">
          Write the question below, and the options here.
        </span>
        <ActionHint label="Remove the poll">
          <Button size="icon-xs" variant="ghost" aria-label="Remove the poll" onClick={onClose}>
            <XIcon />
          </Button>
        </ActionHint>
      </div>
      <ol className="flex flex-col gap-1.5">
        {draft.options.map((option, i) => (
          // Options have no id of their own while they are being typed: their place is their identity.
          <li key={i} className="flex items-center gap-1.5">
            <Input
              value={option}
              maxLength={80}
              placeholder={`Option ${i + 1}`}
              aria-label={`Option ${i + 1}`}
              onChange={(e) => set(i, e.target.value)}
              className="h-8 min-w-0 flex-1"
            />
            {draft.options.length > MIN_POLL_OPTIONS && (
              <ActionHint label={`Remove option ${i + 1}`}>
                <Button
                  size="icon-xs"
                  variant="ghost"
                  aria-label={`Remove option ${i + 1}`}
                  onClick={() =>
                    onChange({ ...draft, options: draft.options.filter((_, n) => n !== i) })
                  }
                >
                  <XIcon />
                </Button>
              </ActionHint>
            )}
          </li>
        ))}
      </ol>
      <div className="flex flex-wrap items-center gap-2">
        {draft.options.length < MAX_POLL_OPTIONS && (
          <Button
            size="sm"
            variant="ghost"
            onClick={() => onChange({ ...draft, options: [...draft.options, ""] })}
          >
            <PlusIcon aria-hidden="true" />
            Add an option
          </Button>
        )}
        <div
          role="group"
          aria-label="How many choices"
          className="ml-auto flex rounded-md border p-0.5"
        >
          {MODES.map(({ mode, label }) => (
            <button
              key={mode}
              type="button"
              aria-pressed={draft.mode === mode}
              onClick={() => onChange({ ...draft, mode })}
              className={cn(
                "rounded px-2 py-0.5 focus-visible:outline-2 focus-visible:outline-ring",
                draft.mode === mode
                  ? "bg-muted font-medium text-foreground"
                  : "text-muted-foreground",
              )}
            >
              {label}
            </button>
          ))}
        </div>
      </div>
    </section>
  );
}
