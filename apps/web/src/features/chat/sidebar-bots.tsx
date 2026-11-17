import { Link, useNavigate } from "@tanstack/react-router";
import {
  RobotIcon as BotIcon,
  ChatCircleIcon,
  DotsThreeIcon,
  GearSixIcon,
  HashIcon,
  PlusIcon,
  PushPinSlashIcon,
} from "@phosphor-icons/react";

import { cn } from "@zetta/ui/lib/utils";
import { BotAvatar } from "@/components/bot-avatar";
import { BotStatusDot } from "@/components/bot-status";
import { Menu, MenuItem } from "@/components/ui";
import { useBotAttention, type BotAttention } from "../attention/summary";
import { usePreferences } from "../preferences/preferences";

import type { Bot } from "./chat-client";
import { pickSidebarBots } from "./sidebar-bot-list";
import { useSidebarData } from "./sidebar-data";
import { useSidebarPins } from "./sidebar-pin-actions";
import { AttentionCount, Hint } from "./sidebar-parts";

/**
 * One quiet row per bot: avatar, name and what needs the person. Clicking opens its latest chat; "New chat" and the actions
 * show on hover and on keyboard focus (always on touch screens, which have no hover). Rule: owners see their own unready bots with a
 * setup hint and can still open them to finish setup; nobody else can chat with an unready team bot.
 */
function BotRow({
  bot,
  current,
  attention,
  onOpen,
  onNewChat,
  onRemove,
}: {
  bot: Bot;
  current: boolean;
  attention: BotAttention | undefined;
  onOpen: (id: string) => void;
  onNewChat: (id: string) => void;
  /** Takes the bot out of the sidebar (it stays in "All bots"). */
  onRemove: (id: string) => void;
}) {
  const navigate = useNavigate();
  const blocked = !bot.canEdit && !bot.onboarded;
  const setup = bot.canEdit && !bot.onboarded;
  const tag =
    bot.kind === "chief" ? (
      <span className="sr-only"> (your chief)</span>
    ) : bot.visibility === "private" ? (
      <span className="sr-only"> (private)</span>
    ) : null;
  return (
    <li className="group/bot relative">
      <button
        type="button"
        data-chat-row
        aria-current={current ? "page" : undefined}
        aria-disabled={blocked || undefined}
        title={
          blocked
            ? "Its owner has to finish setting this bot up before you can chat with it."
            : setup
              ? "Not ready yet: finish setup"
              : undefined
        }
        onClick={() => {
          if (!blocked) onOpen(bot.id);
        }}
        className={cn(
          "flex h-7 w-full min-w-0 items-center gap-2 rounded-md pr-2 pl-1.5 text-left text-sm transition-colors duration-150 focus-visible:outline-2 focus-visible:outline-ring motion-reduce:transition-none",
          current ? "bg-sidebar-accent" : "hover:bg-sidebar-accent",
          blocked && "cursor-not-allowed opacity-50",
        )}
      >
        <BotAvatar bot={bot} size={20} badge={<BotStatusDot botId={bot.id} />} />
        <span
          className={cn(
            "min-w-0 flex-1 truncate",
            current || attention?.unread ? "font-semibold" : "font-medium",
          )}
        >
          {bot.name}
          {tag}
        </span>
        {setup && (
          <span
            role="img"
            aria-label="Finish setup"
            className="size-2 shrink-0 rounded-full bg-attention"
          />
        )}
        {attention && (
          <AttentionCount
            attention={attention}
            className="transition-opacity duration-150 group-focus-within/bot:opacity-0 group-hover/bot:opacity-0 pointer-coarse:group-hover/bot:opacity-100 pointer-coarse:group-focus-within/bot:opacity-100 motion-reduce:transition-none"
          />
        )}
      </button>
      <span
        className={cn(
          "absolute inset-y-0 right-1 flex items-center gap-0.5 opacity-0 transition-opacity duration-150 group-focus-within/bot:opacity-100 group-hover/bot:opacity-100 motion-reduce:transition-none",
          // On a touch screen the count and the actions would overlap: the count wins, the actions live in the bot's page.
          "pointer-coarse:hidden",
        )}
      >
        <Hint title="New chat" description={`Start a new conversation with ${bot.name}.`}>
          <button
            type="button"
            disabled={blocked}
            aria-label={`New chat with ${bot.name}`}
            onClick={() => onNewChat(bot.id)}
            className="flex size-6 items-center justify-center rounded text-muted-foreground hover:bg-sidebar hover:text-foreground focus-visible:outline-2 focus-visible:outline-ring disabled:opacity-50"
          >
            <PlusIcon aria-hidden="true" className="size-3.5" />
          </button>
        </Hint>
        {(bot.canEdit || bot.kind !== "chief") && (
          <Menu
            asChild
            hover={false}
            title=""
            floatingClassName="w-56"
            label={
              <Hint
                title="Bot actions"
                description="Open this bot's settings or take it out of the sidebar."
              >
                <button
                  type="button"
                  aria-label={`Actions for ${bot.name}`}
                  className="flex size-6 items-center justify-center rounded text-muted-foreground hover:bg-sidebar hover:text-foreground focus-visible:outline-2 focus-visible:outline-ring data-open:text-foreground"
                >
                  <DotsThreeIcon aria-hidden="true" className="size-4" />
                </button>
              </Hint>
            }
          >
            {bot.canEdit && (
              <MenuItem
                title="Settings"
                onClick={() =>
                  void navigate({ to: "/bots/$botId/settings", params: { botId: bot.id } })
                }
              >
                <GearSixIcon />
                Settings
              </MenuItem>
            )}
            {bot.kind !== "chief" && (
              <MenuItem title="Remove from sidebar" onClick={() => onRemove(bot.id)}>
                <PushPinSlashIcon />
                Remove from sidebar
              </MenuItem>
            )}
          </Menu>
        )}
      </span>
    </li>
  );
}

/**
 * The sidebar's bots: a short list (the chief, the bots placed by hand, then the latest active), and "All bots" for the rest.
 * Chats are not listed here: the chat header switches between a bot's chats. `query` lists every bot whose name matches.
 */
export function SidebarBots({
  query,
  limit,
  botId,
  onBot,
  onNewChat,
  onNewBot,
  onNewRoom,
  newChatBot,
}: {
  query: string;
  limit?: number | undefined;
  botId: string | undefined;
  onBot: (id: string) => void;
  onNewChat: (id: string) => void;
  onNewBot: () => void;
  onNewRoom: () => void;
  newChatBot: string | undefined;
}) {
  const { bots, chats, chatsLoaded } = useSidebarData();
  const { preferences } = usePreferences();
  const { setPinned } = useSidebarPins();
  const attention = useBotAttention();
  const { shown, total } = pickSidebarBots(bots, chats, {
    order: preferences.botOrder,
    pinned: preferences.sidebarBots,
    currentId: botId,
    query,
    ...(limit ? { limit } : {}),
  });
  const loading = !chatsLoaded && bots.length === 0;
  return (
    <section aria-label="Bots">
      <div className="flex items-center gap-1 pt-3 pb-1 pl-2">
        <h3 className="label-mono">Bots</h3>
        <Menu
          asChild
          hover={false}
          title=""
          floatingClassName="w-48"
          label={
            <Hint title="Add" description="Create a chat, bot or room.">
              <button
                type="button"
                aria-label="Add a chat, bot or room"
                className="ml-auto flex size-6 shrink-0 items-center justify-center rounded text-muted-foreground hover:bg-sidebar-accent hover:text-foreground focus-visible:outline-2 focus-visible:outline-ring"
              >
                <PlusIcon aria-hidden="true" className="size-4" />
              </button>
            </Hint>
          }
        >
          {newChatBot && (
            <MenuItem title="New chat" onClick={() => onNewChat(newChatBot)}>
              <ChatCircleIcon />
              New chat
            </MenuItem>
          )}
          <MenuItem title="New bot" onClick={onNewBot}>
            <BotIcon />
            New bot
          </MenuItem>
          <MenuItem title="New room" onClick={onNewRoom}>
            <HashIcon />
            New room
          </MenuItem>
        </Menu>
      </div>
      {loading && (
        <ul role="status" aria-label="Loading bots" className="space-y-1">
          {[0, 1, 2].map((i) => (
            <li key={i} className="h-7 animate-pulse rounded-md bg-sidebar-accent" />
          ))}
        </ul>
      )}
      <ul className="space-y-px">
        {shown.map((b) => (
          <BotRow
            key={b.id}
            bot={b}
            current={b.id === botId}
            attention={attention.get(b.id)}
            onOpen={onBot}
            onNewChat={onNewChat}
            onRemove={(id) => setPinned(id, false)}
          />
        ))}
      </ul>
      {query && shown.length === 0 && (
        <p className="px-2 pt-2 text-xs text-muted-foreground">No bots match.</p>
      )}
      {!query && total > shown.length && (
        <Link
          to="/bots"
          search={{}}
          className="mt-0.5 flex h-7 items-center rounded-md px-2 text-xs text-muted-foreground hover:bg-sidebar-accent hover:text-foreground focus-visible:outline-2 focus-visible:outline-ring"
        >
          All bots ({total})
        </Link>
      )}
    </section>
  );
}
