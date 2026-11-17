import { useState, type FormEvent } from "react";

import { BotIdentity } from "@/components/bot-identity";
import { PersonIdentity } from "@/components/person-identity";
import { Button, Input, Select } from "@/components/ui";
import { ORG_RANK_LABELS, ORG_TITLE_MAX, type OrgRank } from "@zetta/core/org";
import {
  ORG_PRESETS,
  ORG_ROLE_TEMPLATES,
  ORG_TEMPLATE_CATEGORIES,
  type OrgRoleTemplate,
} from "@zetta/core/org-templates";
import { HolderPicker, type HolderChoice } from "./holder-picker";
import type { OrgCreate, OrgPalette, OrgPosition } from "./org-api";
import { RoleGlyph } from "./org-bits";
import { presetSummary } from "./org-start";

const RANKS: OrgRank[] = ["executive", "lead", "member"];
const SUGGESTIONS = 6;

/** The templates that fit a search, grouped the way the lists show them. The CEO template is offered only to start the chart. */
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

function RoleChip({
  template,
  onPick,
}: {
  template: OrgRoleTemplate;
  onPick: (t: OrgRoleTemplate) => void;
}) {
  return (
    <li>
      <button
        type="button"
        onClick={() => onPick(template)}
        className="flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-xs hover:bg-muted focus-visible:outline-2 focus-visible:outline-ring"
      >
        <RoleGlyph icon={template.icon} className="size-3.5 text-muted-foreground" />
        {template.title}
      </button>
    </li>
  );
}

/** The person or bot chosen for the new seat, drawn by face, with the way to change the choice. */
function ChosenHolder({
  choice,
  palette,
  onChange,
}: {
  choice: HolderChoice;
  palette: OrgPalette;
  onChange: () => void;
}) {
  const h = choice.holder;
  const person =
    h.kind === "person" ? palette.people.find((p) => p.userId === h.userId) : undefined;
  const bot = h.kind === "bot" ? palette.bots.find((b) => b.id === h.botId) : undefined;
  return (
    <div className="space-y-1.5">
      <div className="flex min-w-0 items-center gap-2 rounded-lg border bg-card px-2 py-1.5">
        <div className="min-w-0 flex-1">
          {person && <PersonIdentity person={person} size={28} />}
          {bot && <BotIdentity bot={bot} size={28} sub={bot.description} />}
          {!person && !bot && <span className="text-sm">Nobody yet. The seat stays open.</span>}
        </div>
        <Button size="sm" variant="ghost" onClick={onChange}>
          Change
        </Button>
      </div>
      {choice.shareBot && bot && (
        <p className="text-xs text-muted-foreground">
          {bot.name} will be shared with the team when you add the seat.
        </p>
      )}
    </div>
  );
}

/**
 * Adds a seat under another one in two steps, who first: pick the person or the bot (or leave the seat open), then say what the seat is.
 * One button creates the seat and fills it, so nobody has to add an empty seat and come back to it.
 */
export function AddUnderForm({
  parent,
  palette,
  busy,
  onAdd,
  onPreset,
  onCancel,
}: {
  /** The seat the new one reports to. */
  parent: OrgPosition;
  palette: OrgPalette;
  busy: boolean;
  onAdd: (v: OrgCreate) => void;
  /** Adds a whole team under the seat. */
  onPreset: (key: string, parentId: string) => void;
  onCancel: () => void;
}) {
  const [choice, setChoice] = useState<HolderChoice>();
  const [title, setTitle] = useState("");
  const [rank, setRank] = useState<OrgRank>("member");
  const [templateKey, setTemplateKey] = useState<string>();
  const suggestions = templatesFor(title, false)
    .flatMap((g) => g.templates)
    .filter((t) => t.title.toLowerCase() !== title.trim().toLowerCase())
    .slice(0, SUGGESTIONS);

  const pickHolder = (c: HolderChoice) => {
    setChoice(c);
    // A person who wrote their job title already told what the seat is.
    const h = c.holder;
    const told =
      h.kind === "person" ? palette.people.find((p) => p.userId === h.userId)?.title : "";
    if (told && !title.trim()) setTitle(told);
  };
  const pickRole = (t: OrgRoleTemplate) => {
    setTitle(t.title);
    setTemplateKey(t.key);
    setRank(t.rank === "ceo" ? "member" : t.rank);
  };
  const submit = (e: FormEvent) => {
    e.preventDefault();
    if (!choice || !title.trim() || busy) return;
    onAdd({
      parentId: parent.id,
      title: title.trim(),
      rank,
      ...(templateKey && { templateKey }),
      ...(choice.holder.kind !== "open" && { holder: choice.holder }),
      ...(choice.shareBot && { shareBot: choice.shareBot }),
    });
  };
  return (
    <section aria-label={`Add a seat under ${parent.title}`} className="space-y-5">
      <header className="flex items-center gap-2">
        <h3 className="mr-auto text-sm font-semibold">
          Add a seat under <span className="text-primary">{parent.title}</span>
        </h3>
        <Button size="sm" variant="ghost" onClick={onCancel}>
          Cancel
        </Button>
      </header>
      <section aria-label="Who will hold it" className="space-y-2">
        <h4 className="text-xs font-semibold uppercase text-muted-foreground">1. Who holds it?</h4>
        {choice ? (
          <ChosenHolder choice={choice} palette={palette} onChange={() => setChoice(undefined)} />
        ) : (
          <HolderPicker
            palette={palette}
            busy={busy}
            confirmLabel="Share and choose"
            allowOpen
            onPick={pickHolder}
          />
        )}
      </section>
      <form onSubmit={submit} aria-label="What the seat is" className="space-y-3">
        <h4 className="text-xs font-semibold uppercase text-muted-foreground">2. What is it?</h4>
        <Input
          title="Title"
          placeholder="Such as Community manager"
          required={false}
          maxLength={ORG_TITLE_MAX}
          value={title}
          onChange={(e) => {
            setTitle(e.target.value);
            setTemplateKey(undefined);
          }}
        />
        {suggestions.length > 0 && (
          <ul aria-label="Roles most teams have" className="flex flex-wrap gap-1.5">
            {suggestions.map((t) => (
              <RoleChip key={t.key} template={t} onPick={pickRole} />
            ))}
          </ul>
        )}
        <Select
          title="Level"
          required={false}
          value={rank}
          onChange={(e) => setRank(RANKS.find((r) => r === e.target.value) ?? "member")}
          options={RANKS.map((r) => ({ value: r, label: ORG_RANK_LABELS[r] }))}
        />
        <Button type="submit" disabled={busy || !choice || !title.trim()}>
          Add seat
        </Button>
        {!choice && (
          <p className="text-xs text-muted-foreground">
            Choose who holds it first, or leave it open.
          </p>
        )}
      </form>
      <details className="rounded-lg border px-3 py-2">
        <summary className="cursor-pointer text-sm font-medium">Or add a whole team</summary>
        <ul className="mt-2 flex flex-wrap gap-2">
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
      </details>
    </section>
  );
}
