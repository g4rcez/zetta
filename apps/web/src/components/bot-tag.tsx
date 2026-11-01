import { Link } from "@tanstack/react-router";
import { cn } from "@zetta/ui/lib/utils";
import { createContext, useContext, type PropsWithChildren } from "react";

import { BotAvatar, type AvatarValue } from "@/components/bot-avatar";

export type BotTagBot = {
  id: string;
  avatar?: AvatarValue | null;
  kind?: "chief" | "specialist";
};

/** The latest chat id of each bot, by bot id. The chat page provides it; a bot with no entry opens an empty draft. */
export const LatestChatsContext = createContext<ReadonlyMap<string, string>>(new Map());

/** The tag opens the bot's latest chat, or a new one when it has none (same rule as picking the bot in the sidebar). */
export function BotTag({
  bot,
  children,
  className,
}: PropsWithChildren<{ bot: BotTagBot; className?: string }>) {
  const latest = useContext(LatestChatsContext).get(bot.id);
  return (
    <Link
      to="/chat/{-$chatId}"
      params={{ chatId: latest ?? "new" }}
      search={latest ? {} : { bot: bot.id }}
      className={cn(
        "link rounded-md bg-primary/10 px-1 font-medium whitespace-nowrap text-primary [box-decoration-break:clone] hover:bg-primary/20 focus-visible:outline-2 focus-visible:outline-ring",
        className,
      )}
    >
      <span className="mr-1 inline-flex size-4 align-middle">
        <BotAvatar bot={bot} size={14} square />
      </span>
      {children}
    </Link>
  );
}
