import { PlusIcon, XIcon } from "@phosphor-icons/react";
import { cn } from "@zetta/ui/lib/utils";
import { useState, type ComponentProps, type FormEvent } from "react";

import { relativeTime } from "../shared/relative-time";
import { field } from "../shared/ui";
import { showValue, type FieldValue } from "./inputs";
import {
  type InputSpec,
  type InputType,
  type PlaygroundFile,
  type RunSummary,
} from "./playground-api";
import { StatusBadge } from "./run-output";

/**
 * Every control of the toolbar and the strips is one height (h-8 for the toolbar, h-7 for a tab), so a row never has a taller box next to
 * a shorter one. The component library sets `input, select { font-size: 16px }` outside any layer: only an important utility keeps 14px.
 */
export const control = cn(field, "h-8 w-auto py-0 text-sm!");
const tool =
  "inline-flex h-8 shrink-0 items-center justify-center gap-1.5 rounded-md border px-3 text-sm font-medium transition-colors focus-visible:outline-2 focus-visible:outline-ring disabled:pointer-events-none disabled:opacity-50";
const TOOL_LOOK = {
  plain: "border-border bg-card hover:bg-accent",
  primary: "border-primary bg-primary text-primary-foreground hover:bg-primary/90",
  danger: "border-destructive/50 bg-card text-destructive hover:bg-destructive/10",
  ghost: "border-transparent text-muted-foreground hover:bg-accent hover:text-foreground",
} as const;
export function Tool({
  look = "plain",
  className,
  ...props
}: ComponentProps<"button"> & { look?: keyof typeof TOOL_LOOK }) {
  return <button type="button" {...props} className={cn(tool, TOOL_LOOK[look], className)} />;
}
/** A tab of a strip: the file tabs and the tabs of the right panel. */
export const tab =
  "inline-flex h-7 shrink-0 items-center gap-1.5 rounded-md px-2.5 text-xs text-muted-foreground transition-colors hover:bg-accent hover:text-foreground focus-visible:outline-2 focus-visible:outline-ring aria-pressed:bg-primary/10 aria-pressed:text-primary";

const TYPES: { value: InputType; label: string }[] = [
  { value: "string", label: "Text" },
  { value: "number", label: "Number" },
  { value: "boolean", label: "Yes / no" },
  { value: "json", label: "JSON" },
];

/** The files of a playground as tabs, over the editor. The owner adds, renames and removes files and chooses the one that runs first. */
export function FileTabs({
  files,
  entry,
  open,
  canEdit,
  onOpen,
  onAdd,
  onRemove,
  onEntry,
  onRename,
}: {
  files: PlaygroundFile[];
  entry: string;
  open: string;
  canEdit: boolean;
  onOpen: (path: string) => void;
  /** Return a sentence when the path is not allowed. */
  onAdd: (path: string) => string | undefined;
  onRemove: (path: string) => void;
  onEntry: (path: string) => void;
  /** Returns a sentence when the new path is not allowed. Imports in other files are not updated. */
  onRename: (from: string, to: string) => string | undefined;
}) {
  const [adding, setAdding] = useState<string>();
  const [renaming, setRenaming] = useState<string>();
  const [problem, setProblem] = useState<string>();
  const done = (why: string | undefined, close: () => void) => {
    setProblem(why);
    if (!why) close();
  };
  const add = (e: FormEvent) => {
    e.preventDefault();
    const path = (adding ?? "").trim();
    if (!path) return setAdding(undefined);
    done(onAdd(path), () => setAdding(undefined));
  };
  const rename = (e: FormEvent) => {
    e.preventDefault();
    const to = (renaming ?? "").trim();
    if (!to || to === open) return setRenaming(undefined);
    done(onRename(open, to), () => setRenaming(undefined));
  };
  return (
    <div className="flex min-h-11 flex-wrap items-center gap-x-1 gap-y-1 border-b px-2 py-1.5">
      <div role="group" aria-label="Files" className="flex flex-wrap items-center gap-1">
        {files.map((f) => (
          <span key={f.path} className="inline-flex items-center">
            <button
              type="button"
              aria-pressed={open === f.path}
              onClick={() => onOpen(f.path)}
              className={cn(tab, "font-mono")}
            >
              {f.path}
              {f.path === entry && <span className="text-[10px] uppercase opacity-60">entry</span>}
            </button>
            {canEdit && f.path !== entry && files.length > 1 && (
              <button
                type="button"
                aria-label={`Remove ${f.path}`}
                onClick={() => onRemove(f.path)}
                className="grid size-5 place-items-center rounded text-muted-foreground hover:bg-accent hover:text-foreground"
              >
                <XIcon className="size-3" />
              </button>
            )}
          </span>
        ))}
      </div>
      {canEdit && (
        <div className="ml-auto flex flex-wrap items-center gap-1">
          {adding !== undefined ? (
            <form onSubmit={add} className="flex items-center gap-1">
              <input
                aria-label="Path of the new file"
                autoFocus
                placeholder="lib/helpers.ts"
                value={adding}
                onChange={(e) => setAdding(e.target.value)}
                className={cn(control, "h-7 w-44 font-mono")}
              />
              <button type="submit" className={cn(tab, "border border-border")}>
                Add
              </button>
              <button type="button" onClick={() => setAdding(undefined)} className={tab}>
                Cancel
              </button>
            </form>
          ) : renaming !== undefined ? (
            <form onSubmit={rename} className="flex items-center gap-1">
              <input
                aria-label={`New name of ${open}`}
                autoFocus
                value={renaming}
                onChange={(e) => setRenaming(e.target.value)}
                className={cn(control, "h-7 w-44 font-mono")}
              />
              <button type="submit" className={cn(tab, "border border-border")}>
                Rename
              </button>
              <button type="button" onClick={() => setRenaming(undefined)} className={tab}>
                Cancel
              </button>
            </form>
          ) : (
            <>
              <button type="button" onClick={() => setAdding("")} className={tab}>
                <PlusIcon className="size-3" /> Add file
              </button>
              <button type="button" onClick={() => setRenaming(open)} className={tab}>
                Rename {open}
              </button>
              {open !== entry && (
                <button type="button" onClick={() => onEntry(open)} className={tab}>
                  Run {open} first
                </button>
              )}
            </>
          )}
        </div>
      )}
      {problem && (
        <p role="alert" className="basis-full px-1 text-xs text-destructive">
          {problem}
        </p>
      )}
    </div>
  );
}

/**
 * The inputs of a playground. Every run gets the values on screen; Save keeps them as the defaults. The owner also declares inputs
 * (a name and a type); a person who only runs a shared playground fills in the values.
 */
export function InputsPanel({
  specs,
  fields,
  canEdit,
  onField,
  onSpecs,
}: {
  specs: InputSpec[];
  fields: Record<string, FieldValue>;
  canEdit: boolean;
  onField: (name: string, value: FieldValue) => void;
  onSpecs: (specs: InputSpec[]) => void;
}) {
  const [name, setName] = useState("");
  const [type, setType] = useState<InputType>("string");
  const add = (e: FormEvent) => {
    e.preventDefault();
    const n = name.trim();
    if (!/^[A-Za-z_][A-Za-z0-9_]{0,39}$/.test(n) || specs.some((s) => s.name === n)) return;
    onSpecs([...specs, { name: n, type }]);
    setName("");
  };
  return (
    <div className="space-y-4">
      <p className="text-sm text-muted-foreground">
        A script reads these from <code className="font-mono text-xs">inputs.json</code> or the{" "}
        <code className="font-mono text-xs">ZETTA_INPUTS</code> variable. Save keeps the values as
        the defaults.
      </p>
      {specs.length === 0 && !canEdit && (
        <p className="text-sm text-muted-foreground">This playground takes no inputs.</p>
      )}
      <ul className="space-y-2">
        {specs.map((spec) => {
          const value = fields[spec.name] ?? showValue(spec, spec.default);
          return (
            <li key={spec.name} className="flex items-center gap-2">
              <label className="flex min-w-0 flex-1 items-center gap-3">
                <span className="w-28 shrink-0 truncate font-mono text-xs">{spec.name}</span>
                {spec.type === "boolean" ? (
                  <input
                    type="checkbox"
                    checked={value === true}
                    onChange={(e) => onField(spec.name, e.target.checked)}
                    className="size-4 accent-primary"
                  />
                ) : (
                  <input
                    type={spec.type === "number" ? "number" : "text"}
                    aria-label={spec.name}
                    value={String(value)}
                    onChange={(e) => onField(spec.name, e.target.value)}
                    className={cn(control, "min-w-0 flex-1")}
                  />
                )}
              </label>
              {canEdit && (
                <button
                  type="button"
                  aria-label={`Remove input ${spec.name}`}
                  onClick={() => onSpecs(specs.filter((s) => s.name !== spec.name))}
                  className="grid size-8 place-items-center rounded-md text-muted-foreground hover:bg-accent hover:text-foreground"
                >
                  <XIcon className="size-3.5" />
                </button>
              )}
            </li>
          );
        })}
      </ul>
      {canEdit && (
        <form onSubmit={add} className="flex flex-wrap items-center gap-2 border-t pt-4">
          <input
            aria-label="Name of the new input"
            placeholder="name"
            value={name}
            onChange={(e) => setName(e.target.value)}
            className={cn(control, "w-40 font-mono")}
          />
          <select
            aria-label="Type of the new input"
            value={type}
            onChange={(e) => setType(e.target.value as InputType)}
            className={control}
          >
            {TYPES.map((t) => (
              <option key={t.value} value={t.value}>
                {t.label}
              </option>
            ))}
          </select>
          <Tool type="submit">Add input</Tool>
        </form>
      )}
    </div>
  );
}

/** The last runs of a playground. The selected one is in the address. */
export function History({
  runs,
  selected,
  onSelect,
}: {
  runs: RunSummary[];
  selected: string | undefined;
  onSelect: (id: string) => void;
}) {
  if (runs.length === 0) return <p className="text-sm text-muted-foreground">No runs yet.</p>;
  return (
    <ul className="divide-y overflow-hidden rounded-lg border">
      {runs.map((r) => (
        <li key={r.id}>
          <button
            type="button"
            aria-pressed={selected === r.id}
            onClick={() => onSelect(r.id)}
            className="flex w-full items-center gap-2 px-3 py-2 text-left text-sm hover:bg-accent aria-pressed:bg-muted"
          >
            <StatusBadge status={r.status} />
            <span className="min-w-0 flex-1 truncate text-xs text-muted-foreground">
              {r.botId ? "bot · " : ""}
              {r.durationMs !== null ? `${(r.durationMs / 1000).toFixed(1)} s` : "running"}
            </span>
            <span className="shrink-0 text-xs text-muted-foreground">
              {relativeTime(r.startedAt)}
            </span>
          </button>
        </li>
      ))}
    </ul>
  );
}
