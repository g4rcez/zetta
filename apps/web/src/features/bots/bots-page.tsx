import {
  DotsThreeIcon,
  GearSixIcon,
  PlusIcon,
  PushPinIcon,
  RobotIcon,
  TrashIcon,
} from "@phosphor-icons/react";
import { useNavigate } from "@tanstack/react-router";
import { botRole } from "@zetta/core/bot-role";
import { useMemo } from "react";

import { ActionHint } from "@/components/action-hint";
import { BotAvatar } from "@/components/bot-avatar";
import { BotStatusDot } from "@/components/bot-status";
import { Button, Input, MENU_DANGER, Menu, MenuItem, MenuSeparator, Modal } from "@/components/ui";
import { toast } from "@/lib/notify";
import { errorMessage, chatClient, type Bot } from "../chat/chat-client";
import { useSidebarPins } from "../chat/sidebar-pin-actions";
import { useSidebarData } from "../chat/sidebar-data";
import { useSidebarNavigation } from "../chat/sidebar";
import { Empty, Loading } from "../shared/ui";
import { filterBots, type BotsSearch } from "./bots-search";

/** Asks first, then deletes the bot and takes it out of the shared list. Its chats stay. */
async function deleteBot(bot: Bot, setBots: (f: (l: Bot[]) => Bot[]) => void) {
  const confirmed = await Modal.confirm<boolean>({
    title: `Delete ${bot.name}?`,
    description:
      "It loses its plugins, accounts, computer access, inbound channels, routines and team places, and all its running work stops. Its chats stay.",
    confirm: { text: "Delete bot", theme: "danger" },
  });
  if (!confirmed) return;
  try {
    await chatClient.deleteBot(bot.id);
    setBots((list) => list.filter((b) => b.id !== bot.id));
    toast.success(`${bot.name} was deleted.`);
  } catch (e) {
    toast.error(errorMessage(e));
  }
}

function BotMenu({ bot, onDelete }: { bot: Bot; onDelete: (bot: Bot) => void }) {
  const navigate = useNavigate();
  return (
    <Menu
      asChild
      hover={false}
      title=""
      floatingClassName="w-44"
      label={
        <ActionHint label={`Actions for ${bot.name}`}>
          <button
            type="button"
            aria-label={`Actions for ${bot.name}`}
            className="flex size-8 items-center justify-center rounded-md text-muted-foreground hover:bg-muted hover:text-foreground focus-visible:outline-2 focus-visible:outline-ring data-open:text-foreground"
          >
            <DotsThreeIcon aria-hidden="true" className="size-5" />
          </button>
        </ActionHint>
      }
    >
      <MenuItem
        title="Edit"
        onClick={() => void navigate({ to: "/bots/$botId/settings", params: { botId: bot.id } })}
      >
        <GearSixIcon />
        Edit
      </MenuItem>
      <MenuSeparator />
      <MenuItem title="Delete" className={MENU_DANGER} onClick={() => onDelete(bot)}>
        <TrashIcon />
        Delete
      </MenuItem>
    </Menu>
  );
}

/** Puts the bot in the chat sidebar or takes it out. Everyone can: it only changes what this person sees. The chief is always there. */
function PinButton({
  bot,
  pinned,
  onPin,
}: {
  bot: Bot;
  pinned: boolean;
  onPin: (bot: Bot, on: boolean) => void;
}) {
  const label = pinned
    ? `Remove ${bot.name} from the chat sidebar`
    : `Show ${bot.name} in the chat sidebar`;
  return (
    <ActionHint label={label}>
      <button
        type="button"
        aria-label={label}
        aria-pressed={pinned}
        onClick={() => onPin(bot, !pinned)}
        className="flex size-8 items-center justify-center rounded-md text-muted-foreground hover:bg-muted hover:text-foreground focus-visible:outline-2 focus-visible:outline-ring aria-pressed:text-primary"
      >
        <PushPinIcon aria-hidden="true" weight={pinned ? "fill" : "regular"} className="size-4" />
      </button>
    </ActionHint>
  );
}

function BotCard({
  bot,
  hasChat,
  pinned,
  onOpen,
  onNewChat,
  onPin,
  onDelete,
}: {
  bot: Bot;
  hasChat: boolean;
  pinned: boolean;
  onOpen: (id: string) => void;
  onNewChat: (id: string) => void;
  onPin: (bot: Bot, on: boolean) => void;
  onDelete: (bot: Bot) => void;
}) {
  // A bot someone else owns and has not finished setting up cannot take chats yet.
  const blocked = !bot.canEdit && !bot.onboarded;
  return (
    <li className="flex min-w-0 flex-col gap-3 rounded-lg border bg-card p-4 text-sm">
      <div className="flex items-start gap-3">
        <BotAvatar
          bot={bot}
          size={44}
          badge={<BotStatusDot botId={bot.id} className="border-card" />}
        />
        <div className="min-w-0 flex-1">
          <h2 className="truncate text-base font-medium">{bot.name}</h2>
          <p className="truncate text-xs text-muted-foreground">{botRole(bot)}</p>
        </div>
        {bot.kind !== "chief" && <PinButton bot={bot} pinned={pinned} onPin={onPin} />}
        {bot.canEdit && <BotMenu bot={bot} onDelete={onDelete} />}
      </div>
      <p className="line-clamp-2 min-h-10 text-pretty text-muted-foreground">
        {bot.description || "No description yet."}
      </p>
      <div className="mt-auto flex flex-wrap gap-2">
        <Button size="sm" disabled={blocked} onClick={() => onOpen(bot.id)}>
          {hasChat ? "Go to chat" : "Start chatting"}
        </Button>
        <Button size="sm" variant="outline" disabled={blocked} onClick={() => onNewChat(bot.id)}>
          <PlusIcon aria-hidden="true" className="size-4" />
          New chat
        </Button>
      </div>
    </li>
  );
}

/** Every bot the person can use, as a grid. Each card goes to the bot's latest chat or starts a new one, and its menu edits or deletes the bot. */
export function BotsPage({
  search,
  onSearch,
}: {
  search: BotsSearch;
  onSearch: (next: BotsSearch, opts?: { replace?: boolean }) => void;
}) {
  const navigate = useNavigate();
  const { bots, chats, chatsLoaded, setBots } = useSidebarData();
  const { toBot, toDraft } = useSidebarNavigation();
  const { inSidebar, setPinned } = useSidebarPins();
  const withChat = useMemo(() => new Set(chats.map((c) => c.botId)), [chats]);
  const shown = filterBots(bots, search.q);
  return (
    <div className="h-full overflow-y-auto">
      <div className="mx-auto w-full max-w-6xl min-w-0 space-y-6 p-4 md:p-8">
        <header className="flex items-start gap-3 border-b pb-5">
          <span
            aria-hidden="true"
            className="grid size-10 shrink-0 place-items-center rounded-lg bg-primary/10 text-primary"
          >
            <RobotIcon className="size-5" />
          </span>
          <div className="min-w-0 flex-1">
            <h1 className="text-2xl text-balance">Bots</h1>
            <p className="text-sm text-pretty text-muted-foreground">
              Everyone on your team of bots. Open a chat, start a new one, or change a bot. Pin a
              bot to keep it in the chat sidebar.
            </p>
          </div>
          <Button size="sm" className="shrink-0" onClick={() => void navigate({ to: "/bots/new" })}>
            <PlusIcon aria-hidden="true" className="size-4" />
            New bot
          </Button>
        </header>
        {bots.length > 0 && (
          <div className="flex flex-wrap items-center gap-3 pb-2">
            <Input
              type="search"
              title="Find a bot"
              hiddenLabel
              placeholder="Find a bot by name, role or description"
              required={false}
              container="min-w-48 flex-1 sm:max-w-sm"
              value={search.q ?? ""}
              onChange={(e) =>
                onSearch(e.target.value.trim() ? { q: e.target.value } : {}, { replace: true })
              }
            />
            <p aria-live="polite" className="text-sm text-muted-foreground tabular-nums">
              {search.q ? `${shown.length} of ${bots.length} bots` : `${bots.length} bots`}
            </p>
            {search.q && (
              <Button size="sm" variant="ghost" onClick={() => onSearch({}, { replace: true })}>
                Clear
              </Button>
            )}
          </div>
        )}
        {!bots.length ? (
          chatsLoaded ? (
            <Empty>You have no bots yet. Create the first one with New bot.</Empty>
          ) : (
            <Loading />
          )
        ) : shown.length ? (
          <ul className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {shown.map((b) => (
              <BotCard
                key={b.id}
                bot={b}
                hasChat={withChat.has(b.id)}
                pinned={inSidebar.has(b.id)}
                onPin={(bot, on) => setPinned(bot.id, on)}
                onOpen={toBot}
                onNewChat={toDraft}
                onDelete={(bot) => void deleteBot(bot, setBots)}
              />
            ))}
          </ul>
        ) : (
          <Empty>No bot matches “{search.q}”. Change the search.</Empty>
        )}
      </div>
    </div>
  );
}
