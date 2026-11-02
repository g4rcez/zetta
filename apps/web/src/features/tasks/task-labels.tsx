import { useId, useState } from "react";
import { LabelChip } from "./task-badges";

/** The server accepts at most 10 labels of 32 characters. */
export const MAX_LABELS = 10;
export const MAX_LABEL_LENGTH = 32;

/** The labels of one task: chips you can remove, and a field to add one. `known` are the labels already in use on other tasks. */
export function LabelsEditor({
  labels,
  known,
  onChange,
}: {
  labels: string[];
  known: string[];
  onChange: (labels: string[]) => void;
}) {
  const [draft, setDraft] = useState("");
  const listId = useId();
  const add = () => {
    const label = draft.trim().toLowerCase();
    setDraft("");
    if (label && !labels.includes(label) && labels.length < MAX_LABELS)
      onChange([...labels, label]);
  };
  return (
    <div className="flex flex-col gap-1.5">
      {labels.length > 0 && (
        <ul aria-label="Labels" className="flex flex-wrap gap-1">
          {labels.map((l) => (
            <li key={l}>
              <LabelChip label={l} onRemove={() => onChange(labels.filter((x) => x !== l))} />
            </li>
          ))}
        </ul>
      )}
      {labels.length < MAX_LABELS && (
        <>
          <input
            list={listId}
            aria-label="Add label"
            placeholder="Add label…"
            maxLength={MAX_LABEL_LENGTH}
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            onKeyDown={(e) => {
              if (e.key !== "Enter") return;
              e.preventDefault();
              add();
            }}
            className="h-7 w-full rounded-md border border-dashed border-input bg-transparent px-2 text-xs focus-visible:outline-2 focus-visible:outline-ring"
          />
          <datalist id={listId}>
            {known
              .filter((k) => !labels.includes(k))
              .map((k) => (
                <option key={k} value={k} />
              ))}
          </datalist>
        </>
      )}
    </div>
  );
}
