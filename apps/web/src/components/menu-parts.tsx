import type { ReactNode } from "react";

/**
 * Pieces the DS `Menu` does not have. Items, roles and keyboard navigation come from `@g4rcez/components/menu`; the
 * list navigation follows DOM order, so these wrappers do not break it.
 */
export function MenuSeparator() {
  return <hr className="my-1 w-full border-border" />;
}

/** A named group (`role="group"`) with a visible label. The label is hidden from assistive tech: the group carries the name. */
export function MenuGroup({ label, children }: { label?: string; children: ReactNode }) {
  return (
    <div role="group" aria-label={label} className="w-full">
      {label ? (
        <div aria-hidden="true" className="px-2 py-1.5 text-xs font-medium text-muted-foreground">
          {label}
        </div>
      ) : null}
      {children}
    </div>
  );
}

/** The destructive item: red text at rest; when active the text goes back to the foreground so it keeps its contrast on the accent fill. */
export const MENU_ITEM_DESTRUCTIVE = "text-destructive! data-[active=true]:text-foreground!";
