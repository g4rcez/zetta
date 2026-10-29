import { createContext, useContext, type ReactNode } from "react";

import { cn } from "@zetta/ui/lib/utils";
import { BotAvatar, type AvatarValue } from "@/components/bot-avatar";

type Identity = {
  id: string;
  name: string;
  avatar?: AvatarValue | null;
  kind?: "chief" | "specialist";
};

/** Bots by id, for nodes and rows that only know a bot id (canvas nodes are rendered by React Flow, not by the page). */
export const BotsContext = createContext<ReadonlyMap<string, Identity>>(new Map());
export const useBotIdentity = (id: string, name: string): Identity =>
  useContext(BotsContext).get(id) ?? { id, name };

/** Who a bot is, drawn like a bot row in the chat sidebar: its avatar, its name, and an optional muted line under it. */
export function BotIdentity({
  bot,
  size = 32,
  sub,
  trailing,
  className,
}: {
  bot: Identity;
  size?: number;
  sub?: ReactNode;
  trailing?: ReactNode;
  className?: string;
}) {
  return (
    <span className={cn("flex min-w-0 items-center gap-2.5", className)}>
      <BotAvatar bot={bot} size={size} />
      <span className="min-w-0 flex-1">
        <span className="flex items-center gap-2">
          <span className="min-w-0 flex-1 truncate text-sm font-medium">{bot.name}</span>
          {trailing}
        </span>
        {sub ? <span className="block truncate text-xs text-muted-foreground">{sub}</span> : null}
      </span>
    </span>
  );
}
