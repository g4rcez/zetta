import { registerBotSection } from "../chat/bot-sections";
import { createElement } from "react";
import { BotComputerSection } from "./bot-computer-section";

registerBotSection({ id: "computer", title: "Computer use", render: ({ bot, onBotChange }) => createElement(BotComputerSection, { bot, onBotChange }) });
