import { registerBotSection } from "../chat/bot-sections";
import { HistorySection, PerformanceSection, SavedTestsSection } from "./sections";

// The Quality tab of a bot's settings (see BOT_TABS in chat/bot-settings.tsx): history, saved tests and the numbers.
registerBotSection({
  id: "history",
  title: "History",
  render: ({ bot, onBotChange, notify }) => (
    <HistorySection bot={bot} onBotChange={onBotChange} notify={notify} />
  ),
});
registerBotSection({
  id: "saved-tests",
  title: "Saved tests",
  render: ({ bot, onBotChange, notify }) => (
    <SavedTestsSection bot={bot} onBotChange={onBotChange} notify={notify} />
  ),
});
registerBotSection({
  id: "performance",
  title: "Performance",
  render: ({ bot, onBotChange, notify }) => (
    <PerformanceSection bot={bot} onBotChange={onBotChange} notify={notify} />
  ),
});
