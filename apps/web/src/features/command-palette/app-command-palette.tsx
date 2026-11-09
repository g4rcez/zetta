import { keepPreviousData, useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useMemo, useState } from "react";
import { useNavigate } from "@tanstack/react-router";
import { CommandPalette, type CommandItemTypes } from "@g4rcez/components";
import {
  PulseIcon,
  BellIcon,
  CameraIcon,
  KeyIcon,
  ChatIcon,
  MonitorIcon,
  MoonIcon,
  PlusIcon,
  ScalesIcon,
  MagnifyingGlassIcon,
  NotePencilIcon,
  SunIcon,
  SunDimIcon,
  FlowArrowIcon,
  PauseIcon,
  PlayIcon,
  type Icon as PhosphorIcon,
} from "@phosphor-icons/react";

import { BotAvatar } from "@/components/bot-avatar";
import { appLinks } from "@/components/app-links";
import { useTheme } from "@/components/theme-provider";
import { useToggleAgents } from "@/features/agents/pause-agents";
import { usePreferences } from "@/features/preferences/preferences";
import type { Theme } from "@/features/preferences/theme";

import type { Bot } from "../chat/chat-client";
import { chatQueries } from "../chat/chat-queries";
import {
  hitTarget,
  KIND_LABEL,
  plainSnippet,
  searchQueries,
  type SearchHit,
} from "../search/search-api";
import { useDebounced } from "../search/use-debounced";
import { isRailTab, studioTabs, type StudioTab } from "../studio/studio-tabs";

/**
 * Global ⌘K / Ctrl+K palette for the signed-in shell. Every `shortcut` below is also a global hotkey (the library registers them),
 * skipped while typing in an input or textarea. Hotkeys use Alt: ⌘/Ctrl+digit and most ⌘ letters belong to the browser, and
 * Alt+e/i/n/u are dead keys on macOS (they never reach the page as a letter), so those stay unbound.
 */
type Action = Extract<CommandItemTypes, { type: "shortcut" }>["action"];

const NO_HITS: SearchHit[] = [];
const RECENT = 8; // conversations listed before typing; searching looks through all of them
const isMac = () => /Mac|iPod|iPhone|iPad/.test(navigator.userAgent);
function PaletteIcon({ icon: Icon }: { icon: PhosphorIcon }) {
  return <Icon className="size-4" aria-hidden="true" />;
}

const STUDIO_ICONS: Partial<Record<StudioTab, PhosphorIcon>> = {
  attention: BellIcon,
  workflows: FlowArrowIcon,
  decisions: ScalesIcon,
  accounts: KeyIcon,
  snapshots: CameraIcon,
  activity: PulseIcon,
};

export function AppCommandPalette({
  open,
  onOpenChange,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const navigate = useNavigate();
  const { resolvedTheme } = useTheme();
  const { set: setPreferences } = usePreferences();
  const { paused, toggle: toggleAgents } = useToggleAgents();
  const qc = useQueryClient();
  const [text, setText] = useState("");
  const searching = text.trim() !== "";

  // Server search over everything the user owns, once they stop typing. The old results stay until the new ones come.
  const q = useDebounced(text.trim(), 250);
  const searchOn = open && q.length >= 2;
  const found = useQuery({
    ...searchQueries.hits(q, 12),
    enabled: searchOn,
    placeholderData: keepPreviousData,
  });
  const hits = searchOn ? (found.data ?? NO_HITS) : NO_HITS;

  // The library's own Mod+K binding ignores inputs and textareas; this one also works from the chat composer and closes the palette.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (
        e.key.toLowerCase() !== "k" ||
        e.altKey ||
        e.shiftKey ||
        !(isMac() ? e.metaKey : e.ctrlKey)
      )
        return;
      e.preventDefault();
      e.stopPropagation();
      onOpenChange(!open);
    };
    window.addEventListener("keydown", onKey, { capture: true });
    return () => window.removeEventListener("keydown", onKey, { capture: true });
  }, [open, onOpenChange]);

  // Bots and conversations load once up front (so per-bot hotkeys work before the first open) and load again on every open
  // when they are older than the query's stale time; the previous list stays visible meanwhile.
  const botsQuery = useQuery(chatQueries.bots());
  const chatsQuery = useQuery(chatQueries.conversations());
  useEffect(() => {
    if (!open) return;
    void qc.prefetchQuery(chatQueries.bots());
    void qc.prefetchQuery(chatQueries.conversations());
  }, [open, qc]);
  const botRows = botsQuery.data;
  const chatRows = chatsQuery.data;

  const commands = useMemo((): CommandItemTypes[] => {
    const go =
      (to: () => Promise<void>): Action =>
      ({ setOpen }) => {
        setOpen(false);
        void to();
      };
    const bots = [...(botRows ?? [])].sort(
      (a, b) => Number(b.kind === "chief") - Number(a.kind === "chief"),
    );
    const chats = (chatRows ?? [])
      .filter((c) => !c.kind || c.kind === "chat")
      .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
    const botName = new Map(bots.map((b) => [b.id, b.name]));
    // Same as picking a bot in the chat sidebar: its latest conversation, or an empty draft when it has none.
    const openBot = (bot: Bot): Action => {
      const latest = chats.find((c) => c.botId === bot.id);
      return latest
        ? go(() => navigate({ to: "/chat/{-$chatId}", params: { chatId: latest.id }, search: {} }))
        : go(() =>
            navigate({
              to: "/chat/{-$chatId}",
              params: { chatId: "new" },
              search: { bot: bot.id },
            }),
          );
    };
    const theme =
      (value: Theme): Action =>
      ({ setOpen }) => {
        setOpen(false);
        setPreferences({ theme: value });
      };

    const q = text.trim();
    const found: CommandItemTypes[] = hits.map((h) => ({
      type: "shortcut",
      title: `${KIND_LABEL[h.kind]} · ${h.kind === "message" ? plainSnippet(h.snippet).slice(0, 80) : h.title}`,
      // The library filters by title and hint; the server already matched, so the typed text keeps the hit visible.
      hint: [q],
      Icon: (
        <PaletteIcon
          icon={h.kind === "message" || h.kind === "conversation" ? ChatIcon : MagnifyingGlassIcon}
        />
      ),
      action: go(() => {
        const t = hitTarget(h);
        return navigate({
          to: t.to,
          params: t.params as never,
          search: (t.search ?? {}) as never,
        } as never);
      }),
    }));
    return [
      ...(found.length > 0
        ? [
            { type: "group" as const, title: "Search results", items: found },
            {
              type: "group" as const,
              title: "Search",
              items: [
                {
                  type: "shortcut" as const,
                  title: `See all results for "${q}"`,
                  hint: [q],
                  Icon: <PaletteIcon icon={MagnifyingGlassIcon} />,
                  action: go(() => navigate({ to: "/search", search: { q } })),
                },
              ],
            },
          ]
        : []),
      {
        type: "group",
        title: "Go to",
        items: appLinks.map((link, i) => ({
          type: "shortcut",
          title: link.label,
          hint: ["go", "open", "page"],
          shortcut: `Alt + ${i + 1}`,
          Icon: <PaletteIcon icon={link.icon} />,
          action: go(() =>
            navigate({
              to: link.to as string,
              params: ("params" in link ? link.params : undefined) as never,
            }),
          ),
        })),
      },
      {
        type: "group",
        title: "Agents",
        items: [
          {
            type: "shortcut",
            title: paused ? "Resume agents" : "Pause agents",
            hint: ["pause", "stop", "resume", "agents", "everything", "halt"],
            Icon: <PaletteIcon icon={paused ? PlayIcon : PauseIcon} />,
            action: ({ setOpen }) => {
              setOpen(false);
              void toggleAgents();
            },
          },
        ],
      },
      {
        type: "group",
        title: "Studio",
        items: studioTabs
          .filter((t) => !isRailTab(t.slug))
          .map((t) => ({
            type: "shortcut",
            title: t.label,
            hint: ["studio", t.slug],
            Icon: <PaletteIcon icon={STUDIO_ICONS[t.slug] ?? MonitorIcon} />,
            action: go(() => navigate({ to: "/studio/$tab", params: { tab: t.slug } })),
          })),
      },
      {
        type: "group",
        title: "Create",
        items: [
          // An empty draft per bot; the chief's keeps the Alt+C hotkey.
          ...bots.map((bot): CommandItemTypes => ({
            type: "shortcut",
            title: `New chat with ${bot.name}`,
            hint: ["new", "conversation", "message", "draft", bot.kind],
            ...(bot.kind === "chief" ? { shortcut: "Alt + c" } : {}),
            Icon: <PaletteIcon icon={NotePencilIcon} />,
            action: go(() =>
              navigate({
                to: "/chat/{-$chatId}",
                params: { chatId: "new" },
                search: { bot: bot.id },
              }),
            ),
          })),
          {
            type: "shortcut",
            title: "New bot",
            hint: ["create", "agent", "assistant", "onboarding"],
            shortcut: "Alt + b",
            Icon: <PaletteIcon icon={PlusIcon} />,
            action: go(() => navigate({ to: "/bots/new" })),
          },
        ],
      },
      ...(bots.length > 0
        ? [
            {
              type: "group" as const,
              title: "Bots",
              items: bots.map((bot): CommandItemTypes => ({
                type: "shortcut",
                title: `Chat with ${bot.name}`,
                hint: ["bot", bot.kind, bot.description],
                Icon: <BotAvatar bot={bot} size={16} />,
                action: openBot(bot),
              })),
            },
          ]
        : []),
      ...(chats.length > 0
        ? [
            {
              type: "group" as const,
              title: "Recent conversations",
              items: (searching ? chats : chats.slice(0, RECENT)).map((c): CommandItemTypes => ({
                type: "shortcut",
                title: c.title || "Untitled conversation",
                hint: ["conversation", botName.get(c.botId) ?? ""],
                Icon: <PaletteIcon icon={ChatIcon} />,
                action: go(() =>
                  navigate({ to: "/chat/{-$chatId}", params: { chatId: c.id }, search: {} }),
                ),
              })),
            },
          ]
        : []),
      {
        type: "group",
        title: "Appearance",
        items: [
          {
            type: "shortcut",
            title: "Toggle theme",
            hint: ["dark", "light", "mode", "appearance"],
            shortcut: "Alt + t",
            Icon: <PaletteIcon icon={SunDimIcon} />,
            action: theme(resolvedTheme === "dark" ? "light" : "dark"),
          },
          {
            type: "shortcut",
            title: "Light theme",
            hint: ["appearance", "mode"],
            Icon: <PaletteIcon icon={SunIcon} />,
            action: theme("light"),
          },
          {
            type: "shortcut",
            title: "Dark theme",
            hint: ["appearance", "mode"],
            Icon: <PaletteIcon icon={MoonIcon} />,
            action: theme("dark"),
          },
          {
            type: "shortcut",
            title: "System theme",
            hint: ["appearance", "mode", "auto"],
            Icon: <PaletteIcon icon={MonitorIcon} />,
            action: theme("system"),
          },
        ],
      },
    ];
  }, [
    botRows,
    chatRows,
    searching,
    text,
    hits,
    navigate,
    resolvedTheme,
    setPreferences,
    paused,
    toggleAgents,
  ]);

  return (
    <CommandPalette
      open={open}
      loading={open && (botsQuery.isPending || chatsQuery.isPending)}
      commands={commands}
      onChangeVisibility={onOpenChange}
      onChangeText={setText}
      emptyMessage="No matching commands"
    />
  );
}
