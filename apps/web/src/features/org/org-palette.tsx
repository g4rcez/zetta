import { useState, type DragEvent, type ReactNode } from "react";

import { BotIdentity } from "@/components/bot-identity";
import { Input } from "@/components/ui";
import { UserAvatar } from "@/components/user-avatar";
import { cn } from "@zetta/ui/lib/utils";
import { ORG_RANK_LABELS } from "@zetta/core/org";
import type { OrgRoleTemplate } from "@zetta/core/org-templates";
import type { OrgPalette } from "./org-api";
import { templatesFor } from "./add-seat-panel";
import { RoleGlyph } from "./org-bits";

/** What a drag from the palette carries; the canvas reads it when it is dropped on a seat. */
export const ORG_ITEM_MIME = "application/x-zetta-org-item";
export type OrgDragItem =
  | { type: "person"; id: string }
  | { type: "bot"; id: string }
  | { type: "template"; id: string };

export function readDragItem(e: DragEvent): OrgDragItem | undefined {
  try {
    const v = JSON.parse(e.dataTransfer.getData(ORG_ITEM_MIME)) as OrgDragItem;
    return v &&
      (v.type === "person" || v.type === "bot" || v.type === "template") &&
      typeof v.id === "string"
      ? v
      : undefined;
  } catch {
    return undefined;
  }
}

const TABS = [
  { id: "people", label: "People" },
  { id: "bots", label: "Bots" },
  { id: "roles", label: "Roles" },
] as const;
type Tab = (typeof TABS)[number]["id"];

function Draggable({ item, children }: { item: OrgDragItem; children: ReactNode }) {
  return (
    <li
      draggable
      onDragStart={(e) => {
        e.dataTransfer.setData(ORG_ITEM_MIME, JSON.stringify(item));
        e.dataTransfer.effectAllowed = "copy";
      }}
      className="cursor-grab rounded-lg border bg-card px-2 py-1.5"
    >
      {children}
    </li>
  );
}

function RoleRow({ template }: { template: OrgRoleTemplate }) {
  return (
    <Draggable item={{ type: "template", id: template.key }}>
      <span className="flex min-w-0 items-center gap-2">
        <RoleGlyph icon={template.icon} className="text-muted-foreground" />
        <span className="min-w-0">
          <span className="block truncate text-sm font-medium">{template.title}</span>
          <span className="block truncate text-xs text-muted-foreground">
            {ORG_RANK_LABELS[template.rank]}
          </span>
        </span>
      </span>
    </Draggable>
  );
}

/**
 * What the admin can drop on a seat of the chart: a person or a bot to hold it, or a role to add under it. Dragging is one way; every
 * one of these can also be done from the seat's own page and menu.
 */
export function OrgPalettePanel({
  palette,
  className,
}: {
  palette: OrgPalette;
  className?: string;
}) {
  const [tab, setTab] = useState<Tab>("people");
  const [query, setQuery] = useState("");
  const q = query.trim().toLowerCase();
  const people = palette.people.filter((p) => !q || p.name.toLowerCase().includes(q));
  const bots = palette.bots.filter((b) => !q || b.name.toLowerCase().includes(q));
  const roles = templatesFor(query, false).flatMap((g) => g.templates);
  return (
    <aside
      aria-label="People, bots and roles"
      className={cn("flex min-h-0 flex-col gap-2 p-3", className)}
    >
      <p className="text-xs text-muted-foreground">Drag one onto a seat to use it.</p>
      <div role="group" aria-label="What to drag" className="flex gap-1">
        {TABS.map((t) => (
          <button
            key={t.id}
            type="button"
            aria-pressed={tab === t.id}
            onClick={() => setTab(t.id)}
            className={cn(
              "rounded-md border px-2 py-1 text-xs hover:bg-muted focus-visible:outline-2 focus-visible:outline-ring",
              tab === t.id && "bg-muted font-medium",
            )}
          >
            {t.label}
          </button>
        ))}
      </div>
      <Input
        type="search"
        title="Find in the list"
        hiddenLabel
        placeholder="Find"
        required={false}
        value={query}
        onChange={(e) => setQuery(e.target.value)}
      />
      <ul className="min-h-0 flex-1 space-y-1 overflow-y-auto">
        {tab === "people" &&
          people.map((p) => (
            <Draggable key={p.userId} item={{ type: "person", id: p.userId }}>
              <span className="flex min-w-0 items-center gap-2">
                <UserAvatar name={p.name} avatar={p.avatar} size={28} />
                <span className="min-w-0 truncate text-sm font-medium">{p.name}</span>
              </span>
            </Draggable>
          ))}
        {tab === "bots" &&
          bots.map((b) => (
            <Draggable key={b.id} item={{ type: "bot", id: b.id }}>
              <BotIdentity bot={b} size={28} sub={b.description} />
            </Draggable>
          ))}
        {tab === "roles" && roles.map((t) => <RoleRow key={t.key} template={t} />)}
        {tab === "people" && people.length === 0 && (
          <li className="text-xs text-muted-foreground">No one matches.</li>
        )}
        {tab === "bots" && bots.length === 0 && (
          <li className="text-xs text-muted-foreground">
            No bot is shared with the team yet. A bot must be shared to hold a seat.
          </li>
        )}
        {tab === "roles" && roles.length === 0 && (
          <li className="text-xs text-muted-foreground">No role matches.</li>
        )}
      </ul>
    </aside>
  );
}
