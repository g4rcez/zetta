import { createElement } from "react";
import { registerBotSection } from "../chat/bot-sections";
import { BotPhoneSection } from "./bot-phone-section";

registerBotSection({
  id: "phone",
  title: "Phone number",
  render: ({ bot }) => createElement(BotPhoneSection, { bot }),
});
