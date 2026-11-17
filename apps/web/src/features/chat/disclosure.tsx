import { CaretRightIcon } from "@phosphor-icons/react";
import type { ComponentProps, ReactNode } from "react";

import { cn } from "@zetta/ui/lib/utils";

/**
 * The summary line of every fold in a reply (the work, the actions, what was saved, the notes used, the sources), so they all read the
 * same: the caret first, then the icon of what is folded, then the words. The caret is always the first thing in the line, so every fold
 * opens from the same spot, whatever it holds.
 */
function DisclosureSummary({ icon, children }: { icon: ReactNode; children: ReactNode }) {
  return (
    <summary className="flex w-fit max-w-full cursor-pointer list-none items-center gap-1.5 rounded-md py-0.5 select-none hover:text-foreground focus-visible:outline-2 focus-visible:outline-ring [&::-webkit-details-marker]:hidden">
      <CaretRightIcon
        aria-hidden="true"
        className="size-3 shrink-0 transition-transform group-open/disclosure:rotate-90 motion-reduce:transition-none"
      />
      <span
        aria-hidden="true"
        className="grid size-3.5 shrink-0 place-items-center [&>svg]:size-3.5"
      >
        {icon}
      </span>
      <span className="min-w-0 truncate">{children}</span>
    </summary>
  );
}

/**
 * A fold under a reply: one summary line (caret, icon, label) that opens to its content. Every collapsible line of a message uses it, so
 * they share the layout, the spacing, the focus ring and the position of the caret. The icon says what is inside.
 */
export function Disclosure({
  icon,
  label,
  className,
  children,
  ...details
}: Omit<ComponentProps<"details">, "children"> & {
  icon: ReactNode;
  label: ReactNode;
  children: ReactNode;
}) {
  return (
    <details
      {...details}
      className={cn("group/disclosure text-xs text-muted-foreground", className)}
    >
      <DisclosureSummary icon={icon}>{label}</DisclosureSummary>
      {children}
    </details>
  );
}
