import { registerBotSection } from "../chat/bot-sections";
import { createElement } from "react";
import { BotAddressSection } from "./bot-address-section";

registerBotSection({
  id: "bot-address",
  title: "E-mail address",
  render: ({ bot }) => createElement(BotAddressSection, { bot }),
});
