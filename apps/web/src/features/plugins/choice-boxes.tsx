import type { Icon } from "@phosphor-icons/react";

export type Choice<T extends string> = {
  value: T;
  label: string;
  hint: string;
  icon: Icon;
  /** Small green tag next to the label ("Set up", "Recommended"). */
  badge?: string;
};

/** A row of illustrative boxes where exactly one is picked (Individual / Shared, GitHub CLI / token). */
export function ChoiceBoxes<T extends string>({
  label,
  value,
  onChange,
  options,
}: {
  label: string;
  value: T;
  onChange: (v: T) => void;
  options: Choice<T>[];
}) {
  return (
    <div role="group" aria-label={label} className="grid gap-2 sm:grid-cols-2">
      {options.map((o) => {
        const active = value === o.value;
        return (
          <button
            key={o.value}
            type="button"
            aria-pressed={active}
            onClick={() => onChange(o.value)}
            className={`flex items-start gap-3 rounded-lg border p-3 text-left transition-colors ${active ? "border-primary bg-primary/10" : "border-border hover:bg-muted/50"}`}
          >
            <o.icon
              size={24}
              weight={active ? "fill" : "regular"}
              className={active ? "text-primary" : "text-muted-foreground"}
            />
            <span className="min-w-0 flex-1 space-y-0.5">
              <span className="flex items-center gap-2 font-medium">
                {o.label}
                {o.badge && (
                  <span className="rounded bg-success/15 px-1 text-xs font-normal text-success">
                    {o.badge}
                  </span>
                )}
              </span>
              <span className="block text-xs text-muted-foreground">{o.hint}</span>
            </span>
          </button>
        );
      })}
    </div>
  );
}
