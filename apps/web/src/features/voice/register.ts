import { createElement } from "react";
import { registerBotSection } from "../chat/bot-sections";
import { BotVoiceSection } from "./bot-voice-section";

registerBotSection({
  id: "voice",
  title: "Voice",
  render: ({ bot, onBotChange }) => createElement(BotVoiceSection, { bot, onBotChange }),
});
