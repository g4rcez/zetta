import type { ComponentProps, ReactElement } from "react";

import { cn } from "@zetta/ui/lib/utils";
import { ActionHint } from "@/components/action-hint";
import type { BotAttention } from "../attention/summary";

/**
 * Hover and focus hint with a title and a description. `children` is the element that shows it. It passes the extra props and the
 * `ref` on, so it can be the trigger of a `Menu` with `asChild`.
 */
export function Hint({
  title,
  description,
  children,
  ...rest
}: {
  title: string;
  description: string;
  children: ReactElement;
} & Omit<ComponentProps<typeof ActionHint>, "label" | "children">) {
  return (
    <ActionHint
      {...rest}
      label={
        <span className="flex flex-col items-start gap-0.5">
          <span className="font-medium">{title}</span>
          <span className="opacity-70">{description}</span>
        </span>
      }
    >
      {children}
    </ActionHint>
  );
}

/** The attention count of a bot. Unread (not seen yet) is filled amber; seen but still open is a quiet count. */
export function AttentionCount({
  attention,
  className,
}: {
  attention: BotAttention;
  className?: string;
}) {
  const unread = attention.unread > 0;
  return (
    <span
      className={cn(
        "min-w-5 shrink-0 rounded-sm px-1.5 text-center text-xs leading-5 font-medium tabular-nums",
        unread ? "bg-attention text-attention-foreground" : "bg-muted text-foreground",
        className,
      )}
    >
      <span className="sr-only">
        {unread
          ? `${attention.unread} unread, ${attention.open} open needing you`
          : `${attention.open} open needing you`}
      </span>
      <span aria-hidden="true">{unread ? attention.unread : attention.open}</span>
    </span>
  );
}
