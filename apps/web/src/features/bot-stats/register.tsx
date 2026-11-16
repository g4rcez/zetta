import { registerBotSection } from "../chat/bot-sections";
import { StatsSection } from "./stats-section";

// The first section of a bot's page, above Setup (see BOT_TABS in chat/bot-settings.tsx): routines, calls, messages, tasks and one chart.
registerBotSection({
  id: "stats",
  title: "Stats",
  render: ({ bot, onBotChange, notify }) => (
    <StatsSection bot={bot} onBotChange={onBotChange} notify={notify} />
  ),
});
