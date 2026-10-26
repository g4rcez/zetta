import type { ReactNode } from "react";

type ToggleCardProps = {
  /** Icon or avatar shown at the start of the card. */
  leading: ReactNode;
  title: string;
  description?: string;
  /** Small muted line under the description (kind, visibility, model...). */
  detail?: string;
  checked: boolean;
  disabled?: boolean;
  /** Accessible name of the checkbox, since the card's text is not a plain label. */
  label: string;
  onChange: (checked: boolean) => void;
};

/** One selectable row (plugin, MCP server or bot): leading visual, name, Enabled/Off badge, description and a checkbox. Highlights when on. */
export function ToggleCard({ leading, title, description, detail, checked, disabled = false, label, onChange }: ToggleCardProps) {
  return (
    <label className={`flex items-center gap-3 rounded-lg border p-3 transition-colors ${disabled ? "cursor-not-allowed opacity-60" : "cursor-pointer hover:bg-muted/50"} ${checked ? "border-primary/40 bg-primary/5" : "bg-card"}`}>
      <span className="flex size-10 shrink-0 items-center justify-center text-muted-foreground">{leading}</span>
      <span className="min-w-0 flex-1">
        <span className="flex items-center gap-2">
          <span className="truncate font-medium">{title}</span>
          <span className={`rounded px-1.5 py-0.5 text-xs ${checked ? "bg-primary/15 text-primary" : "bg-muted text-muted-foreground"}`}>{checked ? "Enabled" : "Off"}</span>
        </span>
        {description && <span className="line-clamp-2 block text-xs text-muted-foreground">{description}</span>}
        {detail && <span className="mt-0.5 block truncate text-xs text-muted-foreground">{detail}</span>}
      </span>
      <input type="checkbox" className="size-4 shrink-0 accent-[var(--primary)]" aria-label={label} checked={checked} disabled={disabled} onChange={(e) => onChange(e.target.checked)} />
    </label>
  );
}
