import { Slot } from "@g4rcez/components";
import { Tooltip } from "@g4rcez/components/tooltip";
import {
  useState,
  type ComponentProps,
  type MouseEvent,
  type ReactElement,
  type ReactNode,
  type Ref,
} from "react";

/** `Tooltip` is generic over its trigger element; `Slot` as the trigger takes the DOM props of its child, so the props are loose here. */
const HintTooltip = Tooltip as unknown as (props: Record<string, unknown>) => ReactElement;

type ActionHintProps = Omit<ComponentProps<"span">, "children" | "title" | "ref"> & {
  /** The text of the hint. Use the same text as the `aria-label` of the button, so a screen reader does not read it two times. */
  label: ReactNode;
  /** The icon-only button, link or menu trigger. It keeps its own `aria-label`; remove its native `title`. It must forward `ref` and DOM props. */
  children: ReactElement<{ "aria-expanded"?: boolean | "true" | "false" }>;
  side?: "top" | "bottom" | "left" | "right";
  /** A click closes the hint (default). Turn it off when the click changes the hint itself, like "Copied!". */
  closeOnClick?: boolean;
  ref?: Ref<HTMLElement>;
};

/**
 * Shows the name of an icon-only control that does an action. It opens on mouse hover (after 200ms, the library's delay) and on
 * keyboard focus; Escape closes it, and a click closes it and only runs the action. It stays closed while the child has
 * `aria-expanded="true"` (an open menu). A touch tap shows no hint: it runs the action.
 * The library tooltip is merged onto the child with `Slot` (no wrapper element, so the layout does not change). The child gets
 * `aria-describedby`, never `aria-haspopup` or `aria-expanded`. For an icon with no action, use `IconHint`.
 *
 * It passes the extra props and the `ref` on to the child, so it can be the trigger of a `Menu` or `Dropdown` with `asChild`.
 */
export function ActionHint({
  label,
  children,
  side = "top",
  closeOnClick = true,
  ref,
  onClick,
  ...rest
}: ActionHintProps) {
  const [open, setOpen] = useState(false);
  // A menu or dropdown trigger sets `aria-expanded` (on this element or on the child): while its panel is open, the hint stays closed.
  const expanded = String(rest["aria-expanded"] ?? children.props["aria-expanded"]) === "true";
  return (
    <HintTooltip
      {...rest}
      as={Slot}
      ref={ref}
      open={open && !expanded}
      onChange={(next: boolean) => setOpen(next && !expanded)}
      placement={side}
      onClick={(e: MouseEvent<HTMLSpanElement>) => {
        onClick?.(e);
        if (closeOnClick) setOpen(false);
      }}
      title={children}
    >
      {label}
    </HintTooltip>
  );
}
