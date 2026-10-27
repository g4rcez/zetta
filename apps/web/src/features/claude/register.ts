import { createElement } from "react";
import { registerBotSection } from "../chat/bot-sections";
import { ClaudeSection } from "./claude-section";

registerBotSection({
  id: "claude",
  title: "Agent settings",
  render: ({ bot, notify }) => createElement(ClaudeSection, { bot, notify }),
});
