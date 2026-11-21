import { Tooltip } from "@g4rcez/components/tooltip";
import { cloneElement, useState, type ReactElement } from "react";

type StatusHintProps = {
  /** The name of the status. It is also the accessible name of the icon. */
  label: string;
  /** The icon. It is hidden from screen readers; the wrapper carries the name. */
  children: ReactElement<{ "aria-hidden"?: boolean }>;
  side?: "top" | "bottom" | "left" | "right";
};

/**
 * The name of a status icon that sits inside a link or a button (a sidebar row). Hover only: the trigger is not focusable, because
 * focus and tap belong to the row. Its name is part of the row's accessible name through `role="img"` and `aria-label`.
 * For a status icon in plain text, use `IconHint`.
 */
export function StatusHint({ label, children, side = "top" }: StatusHintProps) {
  const [open, setOpen] = useState(false);
  return (
    <Tooltip
      as="span"
      open={open}
      onChange={setOpen}
      placement={side}
      role="img"
      aria-label={label}
      className="inline-flex shrink-0"
      title={cloneElement(children, { "aria-hidden": true })}
    >
      {label}
    </Tooltip>
  );
}
