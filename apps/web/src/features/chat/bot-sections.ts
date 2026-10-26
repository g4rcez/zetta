import type { ReactNode } from "react";
import type { Bot } from "./chat-client";

/** A tab inside the bot settings drawer. */
export type BotSection = { id: string; title: string; render: (ctx: { bot: Bot; bots: Bot[]; onBotChange: (b: Bot) => void; notify: (m: string) => void }) => ReactNode };

const registry = new Map<string, BotSection>();

/**
 * Registry of extra bot-settings tabs. Other features call `registerBotSection` at import time; the drawer lists them after its built-in tabs.
 * PLUGINS_AND_MCP_SLOT: the "Plugins & MCP" feature registers `{ id: "plugins", title: "Plugins & MCP", render }` here (or passes `extraSections` to the drawer).
 */
export function registerBotSection(section: BotSection) { registry.set(section.id, section); }
export const registeredBotSections = () => [...registry.values()];
