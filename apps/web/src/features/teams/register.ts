import { createElement } from "react";

import { registerBotSection } from "../chat/bot-sections";
import { BotTeamsSection } from "./bot-teams-section";

registerBotSection({
  id: "teams",
  title: "Teams",
  render: ({ bot }) => createElement(BotTeamsSection, { botId: bot.id }),
});
