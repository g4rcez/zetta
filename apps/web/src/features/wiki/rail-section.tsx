import type { ReactNode } from "react";

/** A titled block of the wiki's side column. Flat: the column's edge separates it from the list, so a block draws no card. */
export function RailSection({
  title,
  label,
  count,
  description,
  action,
  children,
}: {
  title: string;
  label?: string;
  count?: number | undefined;
  description?: ReactNode;
  action?: ReactNode;
  children: ReactNode;
}) {
  return (
    <section aria-label={label ?? title} className="min-w-0 space-y-3">
      <header className="space-y-1">
        <div className="flex items-center justify-between gap-2">
          <h2 className="text-sm font-medium">
            {title}
            {count !== undefined && (
              <span className="ml-2 font-normal tabular-nums text-muted-foreground">{count}</span>
            )}
          </h2>
          {action}
        </div>
        {description && <p className="text-xs text-pretty text-muted-foreground">{description}</p>}
      </header>
      {children}
    </section>
  );
}
