import { TreeStructureIcon } from "@phosphor-icons/react";

import { Button } from "@/components/ui";
import { ORG_PRESETS, presetRows, type OrgPreset } from "@zetta/core/org-templates";

/** How a preset reads at a glance: how many seats it makes and the first level under its top seat. */
export function presetSummary(preset: OrgPreset) {
  const rows = presetRows(preset);
  const top = rows.filter((r) => r.parentRef === 0).map((r) => r.title);
  const unique = [...new Set(top)];
  return {
    seats: rows.length,
    top:
      unique.slice(0, 4).join(", ") + (unique.length > 4 ? ` and ${unique.length - 4} more` : ""),
    root: rows[0]?.title ?? "",
  };
}

function PresetCard({
  preset,
  busy,
  onUse,
}: {
  preset: OrgPreset;
  busy: boolean;
  onUse: (key: string) => void;
}) {
  const s = presetSummary(preset);
  return (
    <li className="flex min-w-0 flex-col gap-2 rounded-xl border bg-card p-4">
      <h3 className="text-base font-semibold">{preset.title}</h3>
      <p className="text-sm text-pretty text-muted-foreground">{preset.description}</p>
      <p className="text-xs text-muted-foreground">
        {s.seats} seats. {s.root}
        {s.top ? ` over ${s.top}` : ""}.
        {preset.scope === "department" ? " Placed under an open CEO seat." : ""}
      </p>
      <Button
        size="sm"
        variant="outline"
        className="mt-auto self-start"
        disabled={busy}
        onClick={() => onUse(preset.key)}
      >
        Use this structure
      </Button>
    </li>
  );
}

/** What an empty chart shows: the admin starts from a structure or from the CEO alone; everyone else is told the chart is not drawn yet. */
export function OrgStart({
  canEdit,
  busy,
  onPreset,
  onCeo,
}: {
  canEdit: boolean;
  busy: boolean;
  onPreset: (key: string) => void;
  onCeo: () => void;
}) {
  if (!canEdit)
    return (
      <div className="mx-auto max-w-prose px-4 py-12 text-center">
        <TreeStructureIcon
          aria-hidden="true"
          className="mx-auto mb-3 size-8 text-muted-foreground"
        />
        <p className="text-sm text-pretty text-muted-foreground">
          The admin has not drawn the company chart yet. When they do, you will see who leads what
          here, and who each person and bot reports to.
        </p>
      </div>
    );
  return (
    <div className="mx-auto w-full max-w-5xl space-y-5 p-4 md:p-8">
      <div className="space-y-1">
        <h2 className="text-lg font-semibold text-balance">Draw your organization</h2>
        <p className="max-w-prose text-sm text-pretty text-muted-foreground">
          Start from a structure that is close to yours, then change it: put people and bots in the
          seats, move seats around and rename them.
        </p>
      </div>
      <ul className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
        {ORG_PRESETS.map((p) => (
          <PresetCard key={p.key} preset={p} busy={busy} onUse={onPreset} />
        ))}
      </ul>
      <div className="flex flex-wrap items-center gap-3 border-t pt-4">
        <Button disabled={busy} onClick={onCeo}>
          Start with just a CEO
        </Button>
        <p className="text-sm text-muted-foreground">
          Then add seats one by one from a list of common roles.
        </p>
      </div>
    </div>
  );
}
