"use client";

import * as React from "react";
import { Tooltip, TooltipContent, TooltipTrigger } from "@zetta/ui/components/tooltip";

type ActionHintProps = {
  /** The text of the hint. Use the same text as the `aria-label` of the button, so a screen reader does not read it two times. */
  label: React.ReactNode;
  /** The icon-only button, link or menu trigger. It keeps its own `aria-label`; remove its native `title`. */
  children: React.ReactElement;
  side?: React.ComponentProps<typeof TooltipContent>["side"];
};

/**
 * Shows the name of an icon-only control that does an action. It opens on mouse hover (after 300ms) and on keyboard focus;
 * Escape closes it, and a click closes it and only runs the action. A touch tap shows no hint: it runs the action.
 * It uses the Tooltip primitive, not `PopoverTrigger`, so the control gets no `aria-haspopup` or `aria-expanded`.
 * For an icon with no action, use `IconHint`.
 */
export function ActionHint({ label, children, side = "top" }: ActionHintProps) {
  return (
    <Tooltip>
      <TooltipTrigger delay={300} render={children} />
      <TooltipContent side={side}>{label}</TooltipContent>
    </Tooltip>
  );
}
