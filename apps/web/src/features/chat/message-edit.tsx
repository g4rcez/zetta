import { useQuery } from "@tanstack/react-query";
import { useState } from "react";

import { Button, Dropdown } from "@/components/ui";
import { useTimeFormat } from "@/features/preferences/preferences";
import { formatDateTime } from "@/features/preferences/time-format";

import { errorMessage, type Bot, type Revision } from "./chat-client";
import type { Row } from "./chat-rows";
import { MentionTextarea } from "./mention";

/**
 * A message the person may edit: one they wrote in Zetta and the server has saved. Never a bot's reply, a line from a channel plugin
 * (`inbound`), a poll (its text is the question) or a message still on its way (the live copy has no saved row yet).
 */
export const canEditRow = (row: Row) =>
  row.role === "user" &&
  !row.meta?.inbound &&
  !row.meta?.poll &&
  !row.streaming &&
  row.status !== "running" &&
  row.seq < Number.MAX_SAFE_INTEGER;

/** The newest of the rows that the person may edit, in the list they give (oldest first): what the Up arrow of an empty composer picks. */
export const lastEditable = (rows: readonly Row[]) => [...rows].reverse().find(canEditRow);

/**
 * The text of a message in a box, in place: Save and Cancel, Esc cancels, Ctrl or Command with Enter saves. A mention picks a bot like in
 * the message box. `onSave` resolves when the server took the text (the page then closes the editor) and throws to keep it open.
 */
export function MessageEditor({
  row,
  bots,
  max,
  onSave,
  onCancel,
}: {
  row: Row;
  bots: Bot[];
  max?: number | undefined;
  onSave: (row: Row, text: string) => Promise<unknown>;
  onCancel: () => void;
}) {
  const [text, setText] = useState(row.content);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string>();
  async function save() {
    const next = text.trim();
    if (!next || saving) return;
    if (next === row.content.trim()) return onCancel();
    setSaving(true);
    setError(undefined);
    try {
      await onSave(row, next);
    } catch (e) {
      setError(errorMessage(e));
      setSaving(false);
    }
  }
  return (
    <form
      aria-label="Edit message"
      className="w-full min-w-0 space-y-2"
      onSubmit={(e) => {
        e.preventDefault();
        void save();
      }}
    >
      <MentionTextarea
        title="Edit message"
        hiddenLabel
        bots={bots}
        value={text}
        onChange={setText}
        maxLength={max}
        autoFocus
        disabled={saving}
        onKeyDown={(e) => {
          if (e.key === "Escape") {
            e.preventDefault();
            onCancel();
          } else if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) {
            e.preventDefault();
            void save();
          }
        }}
      />
      {error && (
        <p role="alert" className="text-xs text-destructive">
          {error}
        </p>
      )}
      <div className="flex flex-wrap items-center gap-2">
        <Button type="submit" size="sm" disabled={saving || !text.trim()}>
          Save
        </Button>
        <Button type="button" size="sm" variant="ghost" disabled={saving} onClick={onCancel}>
          Cancel
        </Button>
        <span className="text-xs text-muted-foreground">Esc cancels, Ctrl+Enter saves</span>
      </div>
    </form>
  );
}

/** The earlier texts of a message, newest first. Loaded when the list opens. */
function EarlierVersions({ row, load }: { row: Row; load: (row: Row) => Promise<Revision[]> }) {
  const tf = useTimeFormat();
  const { data, error } = useQuery({
    queryKey: ["message-revisions", row.id, row.editedAt],
    queryFn: () => load(row),
  });
  return (
    <div className="w-80 max-w-[calc(100vw-4rem)] space-y-2 p-3 text-sm">
      <p className="font-medium">Earlier versions</p>
      {!data && !error && <p className="text-xs text-muted-foreground">Loading…</p>}
      {error && (
        <p role="alert" className="text-xs text-destructive">
          {errorMessage(error)}
        </p>
      )}
      {data?.length === 0 && <p className="text-xs text-muted-foreground">No earlier versions.</p>}
      <ol aria-label="Earlier versions" className="max-h-72 space-y-3 overflow-y-auto">
        {data?.map((r) => (
          <li key={r.id} className="space-y-0.5">
            <time dateTime={r.createdAt} className="text-xs text-muted-foreground">
              Replaced{" "}
              {formatDateTime(r.createdAt, tf, { dateStyle: "medium", timeStyle: "short" })}
            </time>
            <p className="break-words whitespace-pre-wrap">{r.content}</p>
          </li>
        ))}
      </ol>
    </div>
  );
}

/**
 * "edited" after the time of a message the author changed. The author opens the earlier versions from it; anyone else who reads the
 * conversation sees the mark only (the earlier texts are the author's).
 */
export function EditedMark({
  row,
  load,
}: {
  row: Row;
  load?: ((row: Row) => Promise<Revision[]>) | undefined;
}) {
  const tf = useTimeFormat();
  const [open, setOpen] = useState(false);
  if (!row.editedAt) return null;
  const when = `Edited ${formatDateTime(row.editedAt, tf, { dateStyle: "full", timeStyle: "short" })}`;
  if (!load)
    return (
      <span title={when} className="text-xs font-normal text-muted-foreground">
        edited
      </span>
    );
  return (
    <Dropdown
      asChild
      open={open}
      onChange={setOpen}
      aria-label="Earlier versions"
      trigger={
        // No hint: the button has visible text.
        <button
          type="button"
          title={when}
          aria-label="edited, show earlier versions"
          className="text-xs font-normal text-muted-foreground hover:text-foreground hover:underline focus-visible:outline-2 focus-visible:outline-ring"
        >
          edited
        </button>
      }
    >
      <EarlierVersions row={row} load={load} />
    </Dropdown>
  );
}
