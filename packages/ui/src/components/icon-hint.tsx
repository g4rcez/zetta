"use client";

import * as React from "react";
import { Popover, PopoverContent, PopoverTrigger } from "@zetta/ui/components/popover";

type IconHintProps = {
  /** The name of the icon. It is also the accessible name, so the icon itself is hidden from screen readers. */
  label: string;
  /** The icon. Only for an icon that carries meaning and has no visible title next to it. */
  children: React.ReactElement<{ "aria-hidden"?: boolean }>;
  side?: React.ComponentProps<typeof PopoverContent>["side"];
};

/**
 * Shows the name of an icon that has no visible title. It opens on hover, on keyboard focus and on tap; Escape closes it.
 * The trigger is a focusable `<span role="img">`, not a button, because it does no action: never put it inside a link or a button.
 */
export function IconHint({ label, children, side = "top" }: IconHintProps) {
  const [open, setOpen] = React.useState(false);
  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger
        openOnHover
        nativeButton={false}
        render={
          <span
            role="img"
            tabIndex={0}
            aria-label={label}
            // Focus opens it only for the keyboard: a click also focuses the span and would open it and then close it.
            onFocus={(e) => {
              if (e.currentTarget.matches(":focus-visible")) setOpen(true);
            }}
            onBlur={() => setOpen(false)}
            // The ::after widens the hit area to 24x24px (WCAG 2.5.8) without changing the layout.
            className="relative inline-flex shrink-0 rounded-sm after:absolute after:-inset-1.5 focus-visible:outline-2 focus-visible:outline-ring"
          />
        }
      >
        {React.cloneElement(children, { "aria-hidden": true })}
      </PopoverTrigger>
      <PopoverContent
        side={side}
        initialFocus={false}
        finalFocus={false}
        className="w-auto px-2 py-1 motion-reduce:animate-none!"
      >
        {label}
      </PopoverContent>
    </Popover>
  );
}
