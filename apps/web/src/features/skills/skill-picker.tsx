import { CaretDownIcon, MagnifyingGlassIcon } from "@phosphor-icons/react";
import { useState } from "react";

import { Badge } from "../shared/ui";
import { Button, Checkbox } from "@/components/ui";

/** One row of the list: `key` is what `selected` holds, `blocked` is the reason a skill cannot be chosen. */
export type PickerItem = {
  key: string;
  name: string;
  description: string;
  /** Where it comes from, shown under the name when skills of several repositories are listed together. */
  repo?: string | undefined;
  /** A short fact shown after the name, such as how many files the skill has. */
  meta?: string | undefined;
  href?: string | undefined;
  blocked?: string | undefined;
  /** Already in the library: it can still be chosen, to bring it to more bots. */
  installed?: boolean | undefined;
};

/**
 * A searchable checklist, so a person installs the skills they want instead of every skill in a repository. Used on the Skills page and in
 * the chat card where a bot asks to install skills. Skills that cannot be chosen stay visible, with the reason.
 */
export function SkillPicker({
  items,
  selected,
  onChange,
  filter: controlled,
  onFilter,
}: {
  items: PickerItem[];
  selected: string[];
  onChange: (keys: string[]) => void;
  /** The filter text, when the page keeps it in its address. A picker inside a transient card (the chat's install card) keeps its own. */
  filter?: string;
  onFilter?: (text: string) => void;
}) {
  const [own, setOwn] = useState("");
  const filter = controlled ?? own;
  const setFilter = onFilter ?? setOwn;
  const [open, setOpen] = useState<string>();
  const needle = filter.trim().toLowerCase();
  const shown = items.filter((i) =>
    `${i.name} ${i.description} ${i.repo ?? ""}`.toLowerCase().includes(needle),
  );
  const choosable = shown.filter((i) => !i.blocked).map((i) => i.key);
  const all = choosable.length > 0 && choosable.every((k) => selected.includes(k));
  const toggle = (key: string, on: boolean) =>
    onChange(on ? [...selected, key] : selected.filter((k) => k !== key));
  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between gap-2">
        <p className="text-sm font-medium tabular-nums">
          {items.length} {items.length === 1 ? "skill" : "skills"}
        </p>
        <Button
          size="sm"
          variant="ghost"
          type="button"
          disabled={choosable.length === 0}
          onClick={() =>
            onChange(
              all
                ? selected.filter((k) => !choosable.includes(k))
                : [...new Set([...selected, ...choosable])],
            )
          }
        >
          {all ? "Clear" : "Select all"}
        </Button>
      </div>
      <div className="flex items-center gap-2 rounded-lg border bg-card px-3">
        <MagnifyingGlassIcon aria-hidden className="size-4 shrink-0 text-muted-foreground" />
        <input
          type="search"
          aria-label="Search these skills"
          value={filter}
          onChange={(e) => setFilter(e.target.value)}
          placeholder="Search"
          className="h-10 w-full bg-transparent text-sm outline-none"
        />
      </div>
      <ul className="max-h-96 divide-y overflow-y-auto rounded-lg border bg-card">
        {shown.length === 0 && (
          <li className="px-4 py-3 text-sm text-muted-foreground">No skill matches.</li>
        )}
        {shown.map((i) => (
          <li key={i.key} className="px-3 py-2 text-sm">
            <div className="flex items-start gap-2">
              <Checkbox
                aria-label={i.name}
                checked={selected.includes(i.key)}
                disabled={Boolean(i.blocked)}
                onChange={(e) => toggle(i.key, e.target.checked)}
              />
              <div className="min-w-0 flex-1">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="font-medium">{i.name}</span>
                  {i.repo && <span className="text-xs text-muted-foreground">{i.repo}</span>}
                  {i.meta && (
                    <span className="text-xs tabular-nums text-muted-foreground">{i.meta}</span>
                  )}
                  {i.installed && <Badge tone="success">Installed</Badge>}
                </div>
                <p
                  className={`text-muted-foreground ${open === i.key ? "whitespace-pre-wrap break-words" : "line-clamp-2"}`}
                >
                  {i.description}
                </p>
                {i.blocked && <p className="text-xs text-destructive">{i.blocked}</p>}
                {open === i.key && i.href && (
                  <a
                    href={i.href}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="text-xs underline"
                  >
                    View SKILL.md on GitHub
                  </a>
                )}
              </div>
              <Button
                variant="ghost"
                size="icon-xs"
                aria-label={
                  open === i.key ? `Hide details of ${i.name}` : `Show details of ${i.name}`
                }
                aria-expanded={open === i.key}
                onClick={() => setOpen(open === i.key ? undefined : i.key)}
              >
                <CaretDownIcon
                  aria-hidden
                  className={`size-4 transition-transform ${open === i.key ? "rotate-180" : ""}`}
                />
              </Button>
            </div>
          </li>
        ))}
      </ul>
    </div>
  );
}
