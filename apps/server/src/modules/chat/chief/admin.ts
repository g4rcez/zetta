import type { ChiefArgs } from "./schemas";
import type { ChiefCtx, Outcome } from "./types";

/** Administrator tools open a form: the server checks the administrator again when the form calls its API. */
export async function runAdmin(ctx: ChiefCtx, a: ChiefArgs<"admin">): Promise<Outcome> {
  if (!ctx.actor.isAdmin) return { error: "only an administrator can do this." };
  return a.action === "invite"
    ? {
        card: { form: "invite", botId: null, botName: null, prefill: {} },
        text: "A form is now shown to the user to invite someone. They get a one-time token to share; you never see it.",
      }
    : {
        card: { form: "installation", botId: null, botName: null, prefill: {} },
        text: "The installation settings are now shown to the user. Nothing changes until they press the button.",
      };
}
