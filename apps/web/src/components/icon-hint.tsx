import { Tooltip } from "@g4rcez/components/tooltip";
import * as React from "react";

type Placement = NonNullable<React.ComponentProps<typeof Tooltip>["placement"]>;

type IconHintProps = {
  /** The name of the icon. It is also the accessible name, so the icon itself is hidden from screen readers. */
  label: string;
  /** The icon. Only for an icon that carries meaning and has no visible title next to it. */
  children: React.ReactElement<{ "aria-hidden"?: boolean }>;
  placement?: Placement;
};

/**
 * Shows the name of an icon that has no visible title. It opens on hover, on keyboard focus and on tap; Escape closes it.
 * The trigger is a focusable `<span>`. It opens a hint and does no action, so never put it inside a link or a button.
 */
export function IconHint({ label, children, placement = "top" }: IconHintProps) {
  return (
    <Tooltip
      asChild
      arrow={false}
      popover
      placement={placement}
      title={
        <span
          role="button"
          tabIndex={0}
          aria-label={label}
          // The ::after widens the hit area to 24x24px (WCAG 2.5.8) without changing the layout.
          className="relative inline-flex shrink-0 rounded-sm after:absolute after:-inset-1.5 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring"
        >
          {React.cloneElement(children, { "aria-hidden": true })}
        </span>
      }
    >
      {label}
    </Tooltip>
  );
}
