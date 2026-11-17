import { CaretRightIcon } from "@phosphor-icons/react";
import { useState, type ReactNode } from "react";

import { cn } from "@zetta/ui/lib/utils";
import { useNavMode } from "@/features/preferences/preferences";

/**
 * The one collapsible "Advanced" block of the app, on a native `<details>`. It starts folded for a person who chose the simple view and
 * open for one who chose the full view (Preferences > How much to show); `defaultOpen` overrides that for a block that must always
 * start one way. Once the person opens or folds it, their choice stays for as long as the block is on screen, even if the preference
 * arrives later. Nothing inside is removed: it is one click away.
 */
export function AdvancedSection({
  title = "Advanced",
  children,
  defaultOpen,
  className,
  onOpenChange,
}: {
  title?: string;
  children: ReactNode;
  /** Forces the starting state. Leave it out to follow the person's view (full: open, simple: folded). */
  defaultOpen?: boolean;
  className?: string;
  /** Called when the person opens or folds the block (for work that should wait until it is first opened). */
  onOpenChange?: (open: boolean) => void;
}) {
  const full = useNavMode() === "full";
  const [chosen, setChosen] = useState<boolean | null>(null);
  const open = chosen ?? defaultOpen ?? full;
  return (
    <details
      open={open}
      data-component="advanced-section"
      onToggle={(e) => {
        setChosen(e.currentTarget.open);
        onOpenChange?.(e.currentTarget.open);
      }}
      className={cn("group rounded-lg border bg-card/40", className)}
    >
      <summary className="flex cursor-pointer list-none items-center gap-2 rounded-lg px-3 py-2.5 text-sm font-medium focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring [&::-webkit-details-marker]:hidden">
        <CaretRightIcon
          aria-hidden="true"
          weight="bold"
          className="size-3.5 shrink-0 text-muted-foreground transition-transform group-open:rotate-90 motion-reduce:transition-none"
        />
        <span className="min-w-0 flex-1">{title}</span>
        {/* The state is already told by the details element; keeping these out of the name leaves it as the title. */}
        <span aria-hidden="true" className="text-xs font-normal text-muted-foreground">
          <span className="group-open:hidden">Show</span>
          <span className="hidden group-open:inline">Hide</span>
        </span>
      </summary>
      <div className="space-y-4 border-t px-3 py-4">{children}</div>
    </details>
  );
}
