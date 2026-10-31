import { registerBotSection } from "../chat/bot-sections";
import { createElement } from "react";
import { BotPeersSection } from "./bot-peers-section";

registerBotSection({
  id: "peers",
  title: "Rooms",
  render: ({ bot, bots }) => createElement(BotPeersSection, { bot, bots }),
});
