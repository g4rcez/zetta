import { createElement } from "react";

import { registerBotSection } from "../chat/bot-sections";
import { BotOrgSection } from "./bot-org-section";

registerBotSection({
  id: "organization",
  title: "Organization",
  render: ({ bot }) => createElement(BotOrgSection, { botId: bot.id }),
});
