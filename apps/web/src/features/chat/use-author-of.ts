import { useMemo } from "react";

import { useProfile } from "@/features/preferences/profile-api";
import { authClient } from "@/lib/auth-client";
import type { Bot } from "./chat-client";
import type { Row } from "./chat-rows";
import type { Author } from "./message-row";

/**
 * Who wrote a row of a chat: the signed-in person, an outside person writing through a channel, or a bot. Author objects are cached so
 * memoized rows see the same one on every render; the cache resets when its inputs change.
 */
export function useAuthorOf(bots: Bot[], botId: string | undefined) {
  const { data: session } = authClient.useSession();
  const meName = session?.user?.name ?? "You",
    meImage = session?.user?.image,
    meAvatar = useProfile(Boolean(session)).data?.avatar;
  return useMemo(() => {
    const cache = new Map<string, Author>();
    const once = (key: string, make: () => Author) => {
      let a = cache.get(key);
      if (!a) cache.set(key, (a = make()));
      return a;
    };
    return (row: Row): Author => {
      // Outside people writing through a channel plugin are not the signed-in user.
      if (row.role === "user" && row.meta?.inbound) {
        const { label, chatName } = row.meta.inbound;
        return once(`in:${label}:${chatName}`, () => ({ name: `${label} · ${chatName}` }));
      }
      if (row.role === "user")
        return once("me", () => ({ name: meName, image: meImage, avatar: meAvatar }));
      const id = row.botId ?? botId;
      return once(`bot:${id}:${row.botName ?? ""}`, () => {
        const bot = bots.find((b) => b.id === id);
        return { name: bot?.name ?? row.botName ?? "Bot", bot };
      });
    };
  }, [bots, botId, meName, meImage, meAvatar]);
}
