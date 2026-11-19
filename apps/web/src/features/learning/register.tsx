import { registerBotSection } from "../chat/bot-sections";
import { LessonsSection } from "./lessons-section";
import { ProgressSection } from "./progress-section";

// "What I learned": the lessons of a bot, in the Skills and learning tab of its settings (see BOT_TABS in chat/bot-settings.tsx).
registerBotSection({
  id: "lessons",
  title: "What I learned",
  render: ({ bot, bots }) => <LessonsSection bot={bot} bots={bots} />,
});

// "Is it getting better?": the trend of how often the person stepped in, in the Quality tab (see BOT_TABS in chat/bot-settings.tsx).
registerBotSection({
  id: "progress",
  title: "Is it getting better?",
  render: ({ bot, onBotChange, notify }) => (
    <ProgressSection bot={bot} onBotChange={onBotChange} notify={notify} />
  ),
});
