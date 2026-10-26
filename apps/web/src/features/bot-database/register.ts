import { createElement } from "react";
import { registerBotSection } from "../chat/bot-sections";
import { DatabaseSection } from "./database-section";

registerBotSection({ id: "database", title: "Database", render: ({ bot, notify }) => createElement(DatabaseSection, { bot, notify }) });
