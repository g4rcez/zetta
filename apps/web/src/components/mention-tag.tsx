import { Link } from "@tanstack/react-router";
import { cn } from "@zetta/ui/lib/utils";
import type { ReactNode } from "react";

import { BotTag, type BotTagBot } from "@/components/bot-tag";

const CHIP =
  "link rounded-md bg-primary/10 px-1 font-medium whitespace-nowrap text-primary [box-decoration-break:clone] hover:bg-primary/20 focus-visible:outline-2 focus-visible:outline-ring";

/**
 * A mention in a text, drawn from its id (see `rehypeMentionLinks`). A bot shows its current name and avatar; a team or room links to
 * its page and shows the name the token carries. A bot this screen does not know shows the name the token carries, without a link.
 */
export function MentionTag({
  bots,
  children,
  ...props
}: {
  bots: ReadonlyMap<string, BotTagBot & { name: string }>;
  children?: ReactNode;
}) {
  const p = props as Record<string, unknown>;
  const kind = String(p["data-kind"]),
    id = String(p["data-id"]);
  if (kind === "bot") {
    const bot = bots.get(id);
    return bot ? (
      <BotTag bot={bot}>@{bot.name}</BotTag>
    ) : (
      <span className={cn(CHIP, "bg-muted text-foreground")}>{children}</span>
    );
  }
  if (kind === "team")
    return (
      <Link to="/teams/$teamId/settings" params={{ teamId: id }} className={CHIP}>
        {children}
      </Link>
    );
  return (
    <Link to="/rooms" search={{ id }} className={CHIP}>
      {children}
    </Link>
  );
}
