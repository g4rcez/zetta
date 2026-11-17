import { Modal } from "@/components/ui";
import { toast } from "@/lib/notify";
import { chatClient, errorMessage, type Bot } from "./chat-client";

/** The bots a person may delete: their own specialists. The chief is the account's assistant and stays. */
export const canDeleteBot = (bot: Pick<Bot, "kind" | "canEdit">) =>
  bot.kind === "specialist" && bot.canEdit;

/**
 * Asks first, then deletes the bot and says so. Returns true when the bot is gone, so the caller can take it out of its own lists. Its
 * chats stay. Shared by the sidebar menu and the Bots page, so both ask the same question.
 */
export async function confirmDeleteBot(bot: Pick<Bot, "id" | "name">): Promise<boolean> {
  const confirmed = await Modal.confirm<boolean>({
    title: `Delete ${bot.name}?`,
    description:
      "It loses its plugins, accounts, computer access, inbound channels, routines and team places, and all its running work stops. Its chats stay.",
    confirm: { text: "Delete bot", theme: "danger" },
  });
  if (!confirmed) return false;
  try {
    await chatClient.deleteBot(bot.id);
    toast.success(`${bot.name} was deleted.`);
    return true;
  } catch (e) {
    toast.error(errorMessage(e));
    return false;
  }
}
