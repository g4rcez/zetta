import { useState, type FormEvent } from "react";

import { Button, Input, Select } from "@/components/ui";
import { ORG_RANK_LABELS, ORG_TITLE_MAX, type OrgRank } from "@zetta/core/org";
import {
  ORG_PRESETS,
  ORG_ROLE_TEMPLATES,
  ORG_TEMPLATE_CATEGORIES,
  type OrgRoleTemplate,
} from "@zetta/core/org-templates";
import type { OrgCreate, OrgPosition } from "./org-api";
import { RoleGlyph } from "./org-bits";
import { presetSummary } from "./org-start";

const RANKS: OrgRank[] = ["executive", "lead", "member"];

/** The templates that fit a search, grouped the way the list shows them. The CEO template is offered only to start the chart. */
export function templatesFor(query: string, forCeo: boolean) {
  const q = query.trim().toLowerCase();
  const fits = (t: OrgRoleTemplate) =>
    (t.rank === "ceo") === forCeo &&
    (!q || `${t.title} ${t.unit} ${t.description}`.toLowerCase().includes(q));
  return ORG_TEMPLATE_CATEGORIES.map((c) => ({
    ...c,
    templates: ORG_ROLE_TEMPLATES.filter((t) => t.category === c.id && fits(t)),
  })).filter((c) => c.templates.length > 0);
}

function TemplateChoice({
  template,
  onPick,
}: {
  template: OrgRoleTemplate;
  onPick: (key: string) => void;
}) {
  return (
    <li>
      <button
        type="button"
        onClick={() => onPick(template.key)}
        className="flex h-full w-full min-w-0 items-start gap-2 rounded-md border px-3 py-2 text-left hover:bg-muted focus-visible:outline-2 focus-visible:outline-ring"
      >
        <RoleGlyph icon={template.icon} className="mt-0.5 text-muted-foreground" />
        <span className="min-w-0">
          <span className="block truncate text-sm font-medium">{template.title}</span>
          <span className="line-clamp-2 text-xs text-muted-foreground">{template.description}</span>
        </span>
      </button>
    </li>
  );
}

/**
 * Adds a seat under another one: pick a role most organizations have, or write a seat of your own. It sits on the page, above the chart,
 * because it is a choice with some reading to do, not a quick look.
 */
export function AddSeatPanel({
  parent,
  busy,
  onAdd,
  onPreset,
  onCancel,
}: {
  /** The seat the new one reports to. */
  parent: OrgPosition;
  busy: boolean;
  onAdd: (v: OrgCreate) => void;
  /** Adds a whole team under the seat. */
  onPreset: (key: string, parentId: string) => void;
  onCancel: () => void;
}) {
  const [query, setQuery] = useState("");
  const [title, setTitle] = useState("");
  const [rank, setRank] = useState<OrgRank>("member");
  const groups = templatesFor(query, false);
  const submit = (e: FormEvent) => {
    e.preventDefault();
    if (title.trim()) onAdd({ parentId: parent.id, title: title.trim(), rank });
  };
  return (
    <section
      aria-label={`Add a seat under ${parent.title}`}
      className="space-y-4 rounded-xl border bg-card p-4"
    >
      <header className="flex flex-wrap items-center gap-3">
        <h2 className="mr-auto text-base font-semibold">
          Add a seat under <span className="text-primary">{parent.title}</span>
        </h2>
        <Button size="sm" variant="ghost" onClick={onCancel}>
          Close
        </Button>
      </header>
      <Input
        type="search"
        title="Find a role"
        hiddenLabel
        placeholder="Find a role, such as engineer or support"
        required={false}
        value={query}
        onChange={(e) => setQuery(e.target.value)}
      />
      <div className="max-h-72 space-y-4 overflow-y-auto pr-1">
        {groups.map((g) => (
          <section key={g.id} aria-label={g.label}>
            <h3 className="mb-1.5 text-xs font-semibold uppercase text-muted-foreground">
              {g.label}
            </h3>
            <ul className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
              {g.templates.map((t) => (
                <TemplateChoice
                  key={t.key}
                  template={t}
                  onPick={(templateKey) => !busy && onAdd({ parentId: parent.id, templateKey })}
                />
              ))}
            </ul>
          </section>
        ))}
        {groups.length === 0 && (
          <p className="text-sm text-muted-foreground">No role matches. Write your own below.</p>
        )}
      </div>
      <section aria-label="A whole team" className="space-y-2 border-t pt-4">
        <h3 className="text-xs font-semibold uppercase text-muted-foreground">
          Or add a whole team
        </h3>
        <ul className="flex flex-wrap gap-2">
          {ORG_PRESETS.filter((p) => p.scope === "department").map((p) => (
            <li key={p.key}>
              <Button
                size="sm"
                variant="outline"
                disabled={busy}
                onClick={() => onPreset(p.key, parent.id)}
              >
                {p.title} ({presetSummary(p).seats} seats)
              </Button>
            </li>
          ))}
        </ul>
      </section>
      <form onSubmit={submit} className="flex flex-wrap items-end gap-3 border-t pt-4">
        <Input
          title="Or write your own seat"
          placeholder="Title, such as Community manager"
          required={false}
          maxLength={ORG_TITLE_MAX}
          container="min-w-56 flex-1"
          value={title}
          onChange={(e) => setTitle(e.target.value)}
        />
        <Select
          title="Level"
          required={false}
          container="w-44"
          value={rank}
          onChange={(e) => setRank(RANKS.find((r) => r === e.target.value) ?? "member")}
          options={RANKS.map((r) => ({ value: r, label: ORG_RANK_LABELS[r] }))}
        />
        <Button type="submit" disabled={busy || !title.trim()}>
          Add seat
        </Button>
      </form>
    </section>
  );
}
