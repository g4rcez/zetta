import { Tooltip } from "@g4rcez/components/tooltip";
import * as React from "react";

type Placement = NonNullable<React.ComponentProps<typeof Tooltip>["placement"]>;

type ActionHintProps = Omit<
  React.HTMLAttributes<HTMLElement>,
  "children" | "title" | "popover" | "onChange"
> & {
  /** The text of the hint. Use the same text as the `aria-label` of the button, so a screen reader does not read it two times. */
  label: React.ReactNode;
  /** The icon-only button, link or menu trigger. It keeps its own `aria-label`; remove its native `title`. */
  children: React.ReactElement;
  placement?: Placement;
  /** Milliseconds of hover before the hint opens. */
  delay?: number;
};

/**
 * Shows the name of an icon-only control that does an action. It opens on mouse hover (after 300ms) and on keyboard focus;
 * Escape closes it, and a click closes it and only runs the action. A touch tap shows no hint: it runs the action.
 * It forwards its ref and props to the control, so a `Dropdown` with `asChild` can use `ActionHint` as its trigger.
 * For an icon with no action, use `IconHint`.
 */
export const ActionHint = React.forwardRef<HTMLElement, ActionHintProps>(function ActionHint(
  { label, children, placement = "top", delay = 300, ...props },
  ref,
) {
  return (
    <Tooltip
      {...props}
      ref={ref as React.ForwardedRef<HTMLSpanElement>}
      asChild
      arrow={false}
      closeOnClick
      touch={false}
      delay={delay}
      placement={placement}
      title={children}
    >
      {label}
    </Tooltip>
  );
});
