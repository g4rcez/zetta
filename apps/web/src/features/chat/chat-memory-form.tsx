import {
  approxTokens,
  CHAT_MEMORY,
  CONTEXT_PRESETS,
  draftOf,
  memoryChanged,
  parseMemoryDraft,
  type MemoryDraft,
  type MemoryPatch,
  type SummaryMode,
} from "@zetta/core/chat-memory";
import { useState, type FormEvent, type ReactNode } from "react";
import { Button, Input, Select } from "@/components/ui";
import type { Bot } from "./chat-client";

const saveRow = "flex flex-wrap items-center justify-end gap-3 border-t pt-4";

const SUMMARY_OPTIONS: { value: SummaryMode; label: string }[] = [
  { value: "chief", label: "Your Chief writes it (default)" },
  { value: "bot", label: "This bot writes it, on its own engine" },
  { value: "off", label: "No summary" },
];

const fmt = (n: number) => n.toLocaleString("en-US");

function Help({ children }: { children: ReactNode }) {
  return <p className="text-xs text-pretty text-muted-foreground">{children}</p>;
}

export const draftFromBot = (bot: Bot): MemoryDraft => ({
  contextBytes: draftOf(bot.contextBytes),
  summaryMaxChars: draftOf(bot.summaryMaxChars),
  summaryGapBytes: draftOf(bot.summaryGapBytes),
  chatSearchLimit: draftOf(bot.chatSearchLimit),
  summaryMode: bot.summaryMode ?? "chief",
});
const DEFAULTS: MemoryDraft = {
  contextBytes: "",
  summaryMaxChars: "",
  summaryGapBytes: "",
  chatSearchLimit: "",
  summaryMode: "chief",
};

function PresetButton({
  label,
  hint,
  active,
  onPick,
}: {
  label: string;
  hint: string;
  active: boolean;
  onPick: () => void;
}) {
  return (
    <Button
      type="button"
      size="sm"
      variant={active ? "secondary" : "ghost"}
      aria-pressed={active}
      title={hint}
      onClick={onPick}
    >
      {label}
    </Button>
  );
}

/**
 * What a bot remembers of a chat. Every turn starts fresh and reads the newest part of the chat, up to a size; what falls out of view is
 * kept as a short summary the bot also reads, and it can search the older chats. Every number can be typed; an empty field is the
 * default. The checks are the ones of the server (`@zetta/core/chat-memory`), shown before anything is sent.
 */
export function ChatMemoryForm({
  bot,
  saving,
  error,
  onSave,
}: {
  bot: Bot;
  saving: boolean;
  error?: string | undefined;
  onSave: (patch: MemoryPatch) => void;
}) {
  const saved = draftFromBot(bot);
  const [draft, setDraft] = useState<MemoryDraft>(saved);
  const [touched, setTouched] = useState(false);
  const parsed = parseMemoryDraft(draft);
  const errors = parsed.ok ? {} : parsed.errors;
  const changed = memoryChanged(draft, bot);
  const set = (patch: Partial<MemoryDraft>) => {
    setTouched(true);
    setDraft((d) => ({ ...d, ...patch }));
  };
  const shown = (field: keyof typeof errors) => (touched ? errors[field] : undefined);
  const bytes = parsed.ok
    ? (parsed.patch.contextBytes ?? CHAT_MEMORY.contextBytes.default)
    : undefined;
  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setTouched(true);
    if (parsed.ok) onSave(parsed.patch);
  }
  const off = draft.summaryMode === "off";
  return (
    <form key={`${bot.id}-${bot.version}`} onSubmit={submit} className="space-y-5">
      <fieldset className="space-y-2">
        <legend className="mb-1 text-sm font-medium">What the bot reads of the chat</legend>
        <div className="flex flex-wrap gap-1.5" role="group" aria-label="Sizes to start from">
          {CONTEXT_PRESETS.map((p) => (
            <PresetButton
              key={p.id}
              label={p.label}
              hint={
                p.bytes
                  ? `${fmt(p.bytes)} bytes${p.note ? `, ${p.note}` : ""}`
                  : `${fmt(CHAT_MEMORY.contextBytes.default)} bytes`
              }
              active={draft.contextBytes === (p.bytes ? String(p.bytes) : "")}
              onPick={() => set({ contextBytes: p.bytes ? String(p.bytes) : "" })}
            />
          ))}
        </div>
        <Input
          title="How much of the chat it reads back (bytes)"
          name="contextBytes"
          inputMode="numeric"
          autoComplete="off"
          value={draft.contextBytes}
          placeholder={`${fmt(CHAT_MEMORY.contextBytes.default)} (default)`}
          error={shown("contextBytes")}
          onChange={(e) => set({ contextBytes: e.target.value })}
        />
        <Help>
          {bytes === undefined
            ? `Between ${fmt(CHAT_MEMORY.contextBytes.min)} and ${fmt(CHAT_MEMORY.contextBytes.max)} bytes.`
            : `About ${fmt(approxTokens(bytes))} tokens of English text on every answer; other languages use more. Between ${fmt(CHAT_MEMORY.contextBytes.min)} and ${fmt(CHAT_MEMORY.contextBytes.max)} bytes.`}
        </Help>
      </fieldset>

      <fieldset className="space-y-3">
        <legend className="mb-1 text-sm font-medium">Summary of the older messages</legend>
        <Select
          title="Who writes it"
          name="summaryMode"
          required={false}
          value={draft.summaryMode}
          options={SUMMARY_OPTIONS}
          onChange={(e) => set({ summaryMode: e.target.value as SummaryMode })}
        />
        <div className="grid gap-3 sm:grid-cols-2">
          <Input
            title="Summary length (characters)"
            name="summaryMaxChars"
            inputMode="numeric"
            autoComplete="off"
            disabled={off}
            value={draft.summaryMaxChars}
            placeholder={`${fmt(CHAT_MEMORY.summaryMaxChars.default)} (default)`}
            error={shown("summaryMaxChars")}
            onChange={(e) => set({ summaryMaxChars: e.target.value })}
          />
          <Input
            title="Refresh it after (bytes)"
            name="summaryGapBytes"
            inputMode="numeric"
            autoComplete="off"
            disabled={off}
            value={draft.summaryGapBytes}
            placeholder={`${fmt(CHAT_MEMORY.summaryGapBytes.default)} (default)`}
            error={shown("summaryGapBytes")}
            onChange={(e) => set({ summaryGapBytes: e.target.value })}
          />
        </div>
        <Help>
          Length: {fmt(CHAT_MEMORY.summaryMaxChars.min)} to {fmt(CHAT_MEMORY.summaryMaxChars.max)}{" "}
          characters; a longer summary keeps more and is read on every answer. Refresh: how much new
          chat must fall out of view first, {fmt(CHAT_MEMORY.summaryGapBytes.min)} to{" "}
          {fmt(CHAT_MEMORY.summaryGapBytes.max)} bytes; a larger gap means fewer model calls.
        </Help>
        {off && (
          <Help>
            With no summary the bot only knows the newest part of the chat and what it finds by
            searching. A summary it already has is kept, and read again if you turn this back on.
          </Help>
        )}
      </fieldset>

      <fieldset className="space-y-2">
        <legend className="mb-1 text-sm font-medium">Searching earlier chats</legend>
        <Input
          title="Results per search"
          name="chatSearchLimit"
          inputMode="numeric"
          autoComplete="off"
          value={draft.chatSearchLimit}
          placeholder={`${CHAT_MEMORY.chatSearchLimit.default} (default)`}
          error={shown("chatSearchLimit")}
          onChange={(e) => set({ chatSearchLimit: e.target.value })}
        />
        <Help>
          How many matches the bot gets back, {CHAT_MEMORY.chatSearchLimit.min} to{" "}
          {CHAT_MEMORY.chatSearchLimit.max}. It is also the most the bot can ask for.
        </Help>
      </fieldset>

      <p className="text-xs text-pretty text-muted-foreground">
        A longer memory costs more tokens on every answer. Whatever you set, an answer never reads
        more than fits in one request: the oldest messages are dropped first.
      </p>
      <div className={saveRow}>
        {error && (
          <p role="alert" className="mr-auto text-sm text-destructive">
            {error}
          </p>
        )}
        <Button
          type="button"
          size="sm"
          variant="ghost"
          disabled={saving || JSON.stringify(draft) === JSON.stringify(DEFAULTS)}
          onClick={() => set(DEFAULTS)}
        >
          Use the defaults
        </Button>
        <Button type="submit" size="sm" disabled={saving || !changed || !parsed.ok}>
          Save chat memory
        </Button>
      </div>
    </form>
  );
}
