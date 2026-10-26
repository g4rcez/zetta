import { createElement } from "react";
import { registerBotSection } from "../chat/bot-sections";
import { BotPluginsSection } from "./bot-plugins";

registerBotSection({ id: "plugins", title: "Plugins & MCP", render: ({ bot }) => createElement(BotPluginsSection, { botId: bot.id }) });
