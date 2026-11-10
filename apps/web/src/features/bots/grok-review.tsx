import { ArrowLeftIcon } from "@phosphor-icons/react";
import type { ReactNode } from "react";

import { BotAvatar } from "@/components/bot-avatar";
import { EditorField } from "@/components/editor/editor";
import { Button, Input, Select } from "@/components/ui";
import { Alert } from "@g4rcez/components/alert";
import type { Bot } from "../chat/chat-client";
import { MentionTextarea } from "../chat/mention";
import { Badge } from "../shared/ui";
import type { BotImportDraft } from "./grok-api";
import { describeSchedule } from "./grok-filter";

type Draft = BotImportDraft;
type Skill = Draft["skills"][number];
type Note = Draft["notes"][number];
type Routine = Draft["routines"][number];

/** A copy of the list with one entry changed. */
const patchAt = <T,>(list: readonly T[], i: number, patch: Partial<T>): T[] =>
  list.map((x, j) => (j === i ? { ...x, ...patch } : x));
const removeAt = <T,>(list: readonly T[], i: number): T[] => list.filter((_, j) => j !== i);

function Section({ title, hint, children }: { title: string; hint?: string; children: ReactNode }) {
  return (
    <section aria-label={title} className="space-y-3">
      <div>
        <h3 className="font-medium">{title}</h3>
        {hint && <p className="text-xs text-muted-foreground">{hint}</p>}
      </div>
      {children}
    </section>
  );
}

const WARNING_TEXT: Record<string, string> = {
  not_expanded:
    "Only the marketplace's one-line description was available. Write the steps yourself, or ask your Chief to.",
  shell_injection:
    "The written steps ran shell commands, so they were replaced by the one-line description.",
  looks_secret:
    "The written steps looked like they held a secret, so they were replaced by the one-line description.",
  too_large: "The written steps were too long, so they were replaced by the one-line description.",
};

function SkillEditor({
  skill,
  index,
  bots,
  onPatch,
  onRemove,
}: {
  skill: Skill;
  index: number;
  bots: Bot[];
  onPatch: (i: number, p: Partial<Skill>) => void;
  onRemove: (i: number) => void;
}) {
  return (
    <li className="space-y-3 rounded-lg border bg-card p-4">
      <div className="flex flex-wrap items-start gap-3">
        <Input
          title="Name (lowercase letters, numbers and dashes)"
          container="min-w-48 flex-1"
          value={skill.name}
          onChange={(e) => onPatch(index, { name: e.target.value })}
        />
        <Button
          type="button"
          size="sm"
          variant="ghost"
          className="mt-6"
          onClick={() => onRemove(index)}
        >
          Leave this skill out
        </Button>
      </div>
      <MentionTextarea
        title="When to use it"
        bots={bots}
        required
        rows={2}
        maxLength={600}
        value={skill.description}
        onChange={(description) => onPatch(index, { description })}
      />
      {/* Plain on purpose: a skill is a SKILL.md file that other tools read, so a mention of one of my bots would mean nothing there. */}
      <EditorField
        title="Steps"
        required
        rows={10}
        maxLength={64_000}
        value={skill.body}
        onChange={(body) => onPatch(index, { body })}
      />
      {skill.warnings.map((w) => (
        <p key={w} className="text-xs text-warn">
          {WARNING_TEXT[w] ?? w}
        </p>
      ))}
    </li>
  );
}

function NoteEditor({
  note,
  index,
  bots,
  onPatch,
  onRemove,
}: {
  note: Note;
  index: number;
  bots: Bot[];
  onPatch: (i: number, p: Partial<Note>) => void;
  onRemove: (i: number) => void;
}) {
  return (
    <li className="flex items-start gap-3">
      <MentionTextarea
        title={`Note ${index + 1}`}
        hiddenLabel
        bots={bots}
        required
        className="min-w-0 flex-1"
        rows={2}
        maxLength={20_000}
        value={note.content}
        onChange={(content) => onPatch(index, { content })}
      />
      <Button type="button" size="sm" variant="ghost" onClick={() => onRemove(index)}>
        Leave out
      </Button>
    </li>
  );
}

const STATE_OPTIONS = [
  { value: "active", label: "Switch it on" },
  { value: "paused", label: "Keep it paused" },
];

function RoutineEditor({
  routine,
  index,
  timezone,
  bots,
  onPatch,
  onRemove,
}: {
  routine: Routine;
  index: number;
  timezone: string;
  bots: Bot[];
  onPatch: (i: number, p: Partial<Routine>) => void;
  onRemove: (i: number) => void;
}) {
  const runnable = routine.schedule.kind !== "unsupported";
  return (
    <li className="space-y-3 rounded-lg border bg-card p-4">
      <div className="flex flex-wrap items-start gap-3">
        <Input
          title="Title"
          container="min-w-48 flex-1"
          value={routine.title}
          onChange={(e) => onPatch(index, { title: e.target.value })}
        />
        <Button
          type="button"
          size="sm"
          variant="ghost"
          className="mt-6"
          onClick={() => onRemove(index)}
        >
          Leave this routine out
        </Button>
      </div>
      <p className="text-sm">
        <span className="text-muted-foreground">Runs </span>
        {describeSchedule(routine.schedule, timezone)}
      </p>
      <MentionTextarea
        title="What it does each time"
        bots={bots}
        required
        rows={3}
        maxLength={8000}
        value={routine.prompt}
        onChange={(prompt) => onPatch(index, { prompt })}
      />
      <Select
        title="When the bot is created"
        required={false}
        value={runnable ? routine.state : "paused"}
        disabled={!runnable}
        onChange={(e) =>
          onPatch(index, { state: e.target.value === "active" ? "active" : "paused" })
        }
        options={STATE_OPTIONS}
      />
      {routine.note && <p className="text-xs text-warn">{routine.note}</p>}
    </li>
  );
}

function Setup({ draft }: { draft: Draft }) {
  if (draft.integrations.length === 0) return null;
  return (
    <Section
      title="What it needs"
      hint="Connect these after it is created; it works without them, but not everything it was built for."
    >
      <ul className="divide-y overflow-hidden rounded-lg border bg-card text-sm">
        {draft.integrations.map((i) => (
          <li key={i.name} className="flex items-start justify-between gap-3 px-4 py-3">
            <div className="min-w-0">
              <p className="font-medium">{i.name}</p>
              {i.description && <p className="text-xs text-muted-foreground">{i.description}</p>}
            </div>
            {i.pluginId ? (
              <Badge tone="success">Zetta plugin: {i.pluginId}</Badge>
            ) : (
              <Badge>No Zetta equivalent</Badge>
            )}
          </li>
        ))}
      </ul>
    </Section>
  );
}

/**
 * Everything an import will create, to read and change before anything exists. The skills' steps and the instructions were written by
 * the person's Chief from short descriptions, so they are the part to read carefully.
 */
export function GrokReview({
  draft,
  onChange,
  bots,
  busy,
  error,
  onBack,
  onCreate,
}: {
  draft: Draft;
  onChange: (draft: Draft) => void;
  bots: Bot[];
  busy: boolean;
  error: string | undefined;
  onBack: () => void;
  onCreate: () => void;
}) {
  const set = (patch: Partial<Draft>) => onChange({ ...draft, ...patch });
  return (
    <div className="space-y-8">
      <p className="text-sm text-muted-foreground">
        From the Grok Bot marketplace, by {draft.source.creator || "an unknown creator"}.{" "}
        <a
          href={draft.source.url}
          target="_blank"
          rel="noopener noreferrer"
          className="underline underline-offset-2"
        >
          See the original
        </a>
        . The bot starts private and without a code directory; you can change both in its settings.
      </p>
      {draft.warnings.map((w) => (
        <Alert key={w} theme="warn">
          {w}
        </Alert>
      ))}

      <Section title="Who it is">
        <div className="flex items-start gap-4">
          <BotAvatar
            bot={{ id: draft.source.slug, avatar: draft.avatar }}
            size={56}
            square
            className="shrink-0"
          />
          <div className="min-w-0 flex-1 space-y-3">
            <Input
              title="Name"
              value={draft.name}
              maxLength={80}
              onChange={(e) => set({ name: e.target.value })}
            />
            <MentionTextarea
              title="Description"
              bots={bots}
              required={false}
              rows={2}
              maxLength={2048}
              value={draft.description}
              onChange={(description) => set({ description })}
            />
          </div>
        </div>
        <MentionTextarea
          title="Personality"
          bots={bots}
          required={false}
          rows={3}
          maxLength={4096}
          value={draft.personality}
          onChange={(personality) => set({ personality })}
        />
        <MentionTextarea
          title="Instructions"
          bots={bots}
          required={false}
          rows={12}
          maxLength={16_384}
          value={draft.instructions}
          onChange={(instructions) => set({ instructions })}
        />
      </Section>

      {draft.skills.length > 0 && (
        <Section
          title={`Skills (${draft.skills.length})`}
          hint="Playbooks it follows when a situation comes up. They go in your skill library and are attached to this bot."
        >
          <ul className="space-y-3">
            {draft.skills.map((s, i) => (
              <SkillEditor
                key={s.sourceId}
                skill={s}
                index={i}
                bots={bots}
                onPatch={(at, p) => set({ skills: patchAt(draft.skills, at, p) })}
                onRemove={(at) => set({ skills: removeAt(draft.skills, at) })}
              />
            ))}
          </ul>
        </Section>
      )}

      {draft.notes.length > 0 && (
        <Section
          title={`Notes (${draft.notes.length})`}
          hint="Facts it already knows. Only this bot reads them."
        >
          <ul className="space-y-3">
            {draft.notes.map((n, i) => (
              <NoteEditor
                key={n.sourceId}
                note={n}
                index={i}
                bots={bots}
                onPatch={(at, p) => set({ notes: patchAt(draft.notes, at, p) })}
                onRemove={(at) => set({ notes: removeAt(draft.notes, at) })}
              />
            ))}
          </ul>
        </Section>
      )}

      {draft.routines.length > 0 && (
        <Section
          title={`Scheduled runs (${draft.routines.length})`}
          hint={`Times are read in your timezone, ${draft.timezone}. Routines you switch on start running on their schedule.`}
        >
          <ul className="space-y-3">
            {draft.routines.map((r, i) => (
              <RoutineEditor
                key={r.sourceId}
                routine={r}
                index={i}
                timezone={draft.timezone}
                bots={bots}
                onPatch={(at, p) => set({ routines: patchAt(draft.routines, at, p) })}
                onRemove={(at) => set({ routines: removeAt(draft.routines, at) })}
              />
            ))}
          </ul>
        </Section>
      )}

      <Setup draft={draft} />

      {error && <Alert theme="danger">{error}</Alert>}
      <div className="sticky bottom-0 -mx-4 flex items-center justify-between gap-2 border-t bg-background px-4 py-3 md:mx-0 md:px-0">
        <Button type="button" variant="ghost" disabled={busy} onClick={onBack}>
          <ArrowLeftIcon />
          Back to the marketplace
        </Button>
        <Button type="button" disabled={busy || !draft.name.trim()} onClick={onCreate}>
          {busy ? "Creating…" : `Create ${draft.name.trim() || "bot"}`}
        </Button>
      </div>
    </div>
  );
}
