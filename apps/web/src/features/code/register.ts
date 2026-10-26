import { registerBotSection } from "../chat/bot-sections";
import { createElement } from "react";
import { BotCodeSection } from "./bot-code-section";

registerBotSection({ id: "code", title: "Code access", render: ({ bot, onBotChange }) => createElement(BotCodeSection, { bot, onBotChange }) });
