import { Tooltip } from "@g4rcez/components/tooltip";
import { cloneElement, useState, type ReactElement } from "react";

type IconHintProps = {
  /** The name of the icon. It is also the accessible name, so the icon itself is hidden from screen readers. */
  label: string;
  /** The icon. Only for an icon that carries meaning and has no visible title next to it. */
  children: ReactElement<{ "aria-hidden"?: boolean }>;
  side?: "top" | "bottom" | "left" | "right";
};

/**
 * Shows the name of an icon that has no visible title. It opens on hover, on keyboard focus and on tap; Escape closes it.
 * The trigger is a focusable `<span role="img">`: it opens a hint and does no action, so never put it inside a link or a button.
 */
export function IconHint({ label, children, side = "top" }: IconHintProps) {
  const [open, setOpen] = useState(false);
  return (
    <Tooltip
      as="span"
      open={open}
      onChange={setOpen}
      placement={side}
      tabIndex={0}
      role="img"
      aria-label={label}
      // A tap only opens it; the outside press (or Escape, or blur) closes it. Hover and keyboard focus open it through the library.
      onClick={() => setOpen(true)}
      // The ::after widens the hit area to 24x24px (WCAG 2.5.8) without changing the layout.
      className="relative inline-flex shrink-0 rounded-sm after:absolute after:-inset-1.5 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring"
      title={cloneElement(children, { "aria-hidden": true })}
    >
      {label}
    </Tooltip>
  );
}
