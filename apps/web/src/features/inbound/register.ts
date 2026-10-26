import { registerBotSection } from "../chat/bot-sections";
import { createElement } from "react";
import { BotInboundSection } from "./bot-inbound-section";

registerBotSection({ id: "inbound", title: "Incoming messages", render: ({ bot }) => createElement(BotInboundSection, { bot }) });
