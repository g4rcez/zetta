import { Link, useNavigate } from "@tanstack/react-router";
import { useId } from "react";
import {
  RobotIcon as BotIcon,
  ChatCircleIcon,
  DotsThreeIcon,
  GearSixIcon,
  TrashIcon,
  HashIcon,
  PlusIcon,
  PushPinSlashIcon,
} from "@phosphor-icons/react";

import { cn } from "@zetta/ui/lib/utils";
import { BotAvatar } from "@/components/bot-avatar";
import { BotStatusDot } from "@/components/bot-status";
import { MENU_DANGER, Menu, MenuItem, MenuSeparator } from "@/components/ui";
import { useBotAttention, type BotAttention } from "../attention/summary";
import { usePreferences } from "../preferences/preferences";

import type { Bot } from "./chat-client";
import { canDeleteBot, confirmDeleteBot } from "./delete-bot";
import { pickSidebarBots } from "./sidebar-bot-list";
import { SidebarBotChooser } from "./sidebar-bot-chooser";
import { useSidebarData } from "./sidebar-data";
import { useSidebarPins } from "./sidebar-pin-actions";
import { AttentionCount, Hint } from "./sidebar-parts";

/** The actions a bot's menu offers, shared by the row and the tile. */
function BotMenuItems({
  bot,
  onRemove,
  onDelete,
  onNewChat,
}: {
  bot: Bot;
  onRemove: (id: string) => void;
  onDelete: (bot: Bot) => void;
  /** Only where the surface has no "New chat" button of its own (the tile). */
  onNewChat?: (id: string) => void;
}) {
  const navigate = useNavigate();
  return (
    <>
      {onNewChat && (
        <MenuItem title="New chat" onClick={() => onNewChat(bot.id)}>
          <ChatCircleIcon />
          New chat
        </MenuItem>
      )}
      {bot.canEdit && (
        <MenuItem
          title="Settings"
          onClick={() => void navigate({ to: "/bots/$botId/settings", params: { botId: bot.id } })}
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
      {canDeleteBot(bot) && (
        <>
          <MenuSeparator />
          <MenuItem title="Delete bot" className={MENU_DANGER} onClick={() => onDelete(bot)}>
            <TrashIcon />
            Delete bot
          </MenuItem>
        </>
      )}
    </>
  );
}

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
  onDelete,
}: {
  bot: Bot;
  /** Only the tile uses it; a row's avatar is always 20px. */
  avatarSize?: number | undefined;
  current: boolean;
  attention: BotAttention | undefined;
  onOpen: (id: string) => void;
  onNewChat: (id: string) => void;
  /** Takes the bot out of the sidebar (it stays in "All bots"). */
  onRemove: (id: string) => void;
  /** Deletes the bot for good, after asking. */
  onDelete: (bot: Bot) => void;
}) {
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
        {(bot.canEdit || bot.kind !== "chief" || canDeleteBot(bot)) && (
          <Menu
            asChild
            hover={false}
            title=""
            floatingClassName="w-56"
            label={
              <Hint
                title="Bot actions"
                description="Open this bot's settings, take it out of the sidebar or delete it."
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
            <BotMenuItems bot={bot} onRemove={onRemove} onDelete={onDelete} />
          </Menu>
        )}
      </span>
    </li>
  );
}

/** Sidebar padding (16px) and two 4px gaps leave the width of three tiles; the avatar takes a bit over half of one, between 32 and 64px. */
export function tileAvatarSize(railWidth: number) {
  const tile = (railWidth - 16 - 8) / 3;
  return Math.min(64, Math.max(32, Math.round(tile * 0.55)));
}

/**
 * Personal layout: a bot is a tile, a big avatar with its name below, three to a line, square. Same rules as the row: owners see their own unready bots with a
 * setup dot, nobody else can open an unready team bot. The actions menu shows on hover and on keyboard focus.
 */
function BotTile({
  bot,
  avatarSize = 40,
  current,
  attention,
  onOpen,
  onNewChat,
  onRemove,
  onDelete,
}: {
  bot: Bot;
  /** Grows with the sidebar, so the avatar keeps its share of the square tile. */
  avatarSize?: number | undefined;
  current: boolean;
  attention: BotAttention | undefined;
  onOpen: (id: string) => void;
  onNewChat: (id: string) => void;
  onRemove: (id: string) => void;
  onDelete: (bot: Bot) => void;
}) {
  const blocked = !bot.canEdit && !bot.onboarded;
  const setup = bot.canEdit && !bot.onboarded;
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
              : bot.name
        }
        onClick={() => {
          if (!blocked) onOpen(bot.id);
        }}
        className={cn(
          "flex aspect-square w-full min-w-0 flex-col items-center justify-center gap-1 rounded-xl px-1 text-center transition-colors duration-150 focus-visible:outline-2 focus-visible:outline-ring motion-reduce:transition-none",
          current ? "bg-sidebar-accent" : "hover:bg-sidebar-accent/60",
          blocked && "cursor-not-allowed opacity-50",
        )}
      >
        <BotAvatar bot={bot} size={avatarSize} badge={<BotStatusDot botId={bot.id} />} />
        <span
          className={cn(
            "w-full truncate text-xs leading-4",
            current || attention?.unread ? "font-semibold" : "font-medium",
          )}
        >
          {bot.name}
          {bot.kind === "chief" && <span className="sr-only"> (your chief)</span>}
          {bot.kind !== "chief" && bot.visibility === "private" && (
            <span className="sr-only"> (private)</span>
          )}
        </span>
      </button>
      {(attention || setup) && (
        <span className="pointer-events-none absolute top-1 right-1 flex transition-opacity duration-150 group-focus-within/bot:opacity-0 group-hover/bot:opacity-0 pointer-coarse:group-hover/bot:opacity-100 pointer-coarse:group-focus-within/bot:opacity-100 motion-reduce:transition-none">
          {attention ? (
            <AttentionCount attention={attention} />
          ) : (
            <span
              role="img"
              aria-label="Finish setup"
              className="size-2 rounded-full bg-attention"
            />
          )}
        </span>
      )}
      {/* One button in the corner, so it fits the narrowest tile; "New chat" moves into its menu. On a touch screen the count wins and the actions live in the bot's page. */}
      <span className="absolute top-0.5 right-0.5 flex opacity-0 transition-opacity duration-150 group-focus-within/bot:opacity-100 group-hover/bot:opacity-100 motion-reduce:transition-none pointer-coarse:hidden">
        <Menu
          asChild
          hover={false}
          title=""
          floatingClassName="w-56"
          label={
            <Hint
              title="Bot actions"
              description="Start a chat, open this bot's settings, take it out of the sidebar or delete it."
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
          <BotMenuItems
            bot={bot}
            onRemove={onRemove}
            onDelete={onDelete}
            {...(blocked ? {} : { onNewChat })}
          />
        </Menu>
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
  tiles = false,
  botId,
  onBot,
  onNewChat,
  onNewBot,
  onNewRoom,
  newChatBot,
}: {
  query: string;
  limit?: number | undefined;
  /** Personal layout: bots as a grid of avatar tiles instead of rows. */
  tiles?: boolean;
  botId: string | undefined;
  onBot: (id: string) => void;
  onNewChat: (id: string) => void;
  onNewBot: () => void;
  onNewRoom: () => void;
  newChatBot: string | undefined;
}) {
  const { bots, setBots, chats, chatsLoaded } = useSidebarData();
  const navigate = useNavigate();
  const { preferences } = usePreferences();
  const { setPinned } = useSidebarPins(botId);
  const attention = useBotAttention();
  const { shown, total } = pickSidebarBots(bots, chats, {
    order: preferences.botOrder,
    pinned: preferences.sidebarBots,
    currentId: botId,
    query,
    ...(limit ? { limit } : {}),
  });
  const loading = !chatsLoaded && bots.length === 0;
  const Item = tiles ? BotTile : BotRow;
  const headId = useId();
  const avatarSize = tileAvatarSize(preferences.railWidth);
  // The workspace layout hides the section when the filter finds no bot, as it does the destination sections.
  if (query && shown.length === 0 && !tiles) return null;
  return (
    <section aria-label="Bots">
      <div className="flex items-center gap-1 pt-3 pb-1 pl-2">
        <h3 id={headId} className="label-mono">
          Bots
        </h3>
        <SidebarBotChooser botId={botId} />
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
                className="flex size-6 shrink-0 items-center justify-center rounded text-muted-foreground hover:bg-sidebar-accent hover:text-foreground focus-visible:outline-2 focus-visible:outline-ring"
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
            <li
              key={i}
              className="h-7 animate-pulse rounded-md motion-reduce:animate-none bg-sidebar-accent"
            />
          ))}
        </ul>
      )}
      <ul aria-labelledby={headId} className={tiles ? "grid grid-cols-3 gap-1" : "space-y-px"}>
        {shown.map((b) => (
          <Item
            key={b.id}
            {...(tiles ? { avatarSize } : {})}
            bot={b}
            current={b.id === botId}
            attention={attention.get(b.id)}
            onOpen={onBot}
            onNewChat={onNewChat}
            onRemove={(id) => setPinned(id, false)}
            onDelete={(bot) =>
              void confirmDeleteBot(bot).then((gone) => {
                if (!gone) return;
                setBots((list) => list.filter((x) => x.id !== bot.id));
                // The open chat belonged to this bot: leave it instead of showing a bot that no longer exists.
                if (bot.id === botId)
                  void navigate({
                    to: "/chat/{-$chatId}",
                    params: { chatId: undefined },
                    search: {},
                  });
              })
            }
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
          // The workspace list is walked with the arrow keys; "All bots" is a stop on it but not a match for the filter count.
          {...(tiles ? {} : { "data-chat-row": "", "data-extra": "" })}
          className="mt-0.5 flex h-7 items-center rounded-md px-2 text-xs text-muted-foreground hover:bg-sidebar-accent hover:text-foreground focus-visible:outline-2 focus-visible:outline-ring"
        >
          All bots ({total})
        </Link>
      )}
    </section>
  );
}
