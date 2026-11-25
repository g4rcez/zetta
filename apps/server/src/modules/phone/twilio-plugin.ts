/**
 * Twilio as a plugin, the same way as Telnyx (`telnyx-plugin.ts`): its settings are the plugin's own configuration, sealed for the person
 * who saved them, or saved by the administrator as the team configuration so every member and every shared bot uses one account. The
 * plugin has no tools: bots place and answer calls through the phone module, which asks this configuration for the account of the
 * number's owner (`createPhoneProviderReader`, `twilioAccount`).
 *
 * The public address (shared with Telnyx) stays an installation setting: it is where Twilio reaches this server whatever the account.
 */
import {
  PluginError,
  registerPlugin,
  type PluginContext,
  type PluginDef,
  type PluginStatus,
} from "../integrations/plugins/registry";
import { createTwilioProvider } from "./twilio";

export const TWILIO_PLUGIN_ID = "twilio";

/** What one Twilio account needs to place and answer calls. */
export type TwilioAccount = { accountSid: string; authToken: string };

/** The account saved in a plugin configuration, or undefined while something is missing or the Account SID is not one. */
export function twilioAccountOf(
  config: Readonly<Record<string, string>>,
): TwilioAccount | undefined {
  const accountSid = (config.accountSid ?? "").trim();
  const authToken = (config.authToken ?? "").trim();
  if (!/^AC[0-9a-zA-Z]{32}$/.test(accountSid) || !authToken) return undefined;
  return { accountSid, authToken };
}

async function status(ctx: PluginContext): Promise<PluginStatus> {
  const account = twilioAccountOf(ctx.config);
  if (!account) return { state: "needs-auth", detail: "Add the Account SID and the Auth Token." };
  try {
    // Only the key and the number list are checked here: the webhook addresses are set on each number, so the public address is not needed.
    const check = await createTwilioProvider({
      accountSid: account.accountSid,
      authToken: account.authToken,
      publicUrl: "https://unused.invalid",
    }).checkAccount?.();
    if (check && !check.keyOk)
      return { state: "error", detail: "Twilio did not accept the Account SID and Auth Token." };
    if (check && !check.applicationOk)
      return { state: "error", detail: "Twilio did not let Zetta read the account's numbers." };
    return { state: "connected", info: check?.balance ? { balance: check.balance } : undefined };
  } catch (e) {
    if (e instanceof PluginError) throw e;
    return { state: "error", detail: "Twilio could not be reached. Try again in a moment." };
  }
}

export const twilioPlugin: PluginDef = {
  id: "twilio",
  name: "Twilio",
  description:
    "Phone numbers and calls for your bots on your own Twilio account: bots answer calls to their number and place calls for you.",
  icon: "twilio",
  category: "messaging",
  kind: "native",
  auth: "api-key",
  docsUrl: "https://www.twilio.com/docs/voice",
  notes:
    "The numbers are bought and billed on your Twilio account. Saved by the administrator as the team configuration, one account serves every member and every shared bot.",
  fields: [
    {
      key: "accountSid",
      label: "Account SID",
      kind: "text",
      placeholder: "AC…",
      help: "Twilio Console > Account info. Not a secret.",
    },
    {
      key: "authToken",
      label: "Auth Token",
      kind: "password",
      secret: true,
      help: "Twilio Console > Account info. Also the key that checks every webhook; rotating it in Twilio means saving it here again.",
    },
  ],
  guide: () => [
    "Create a Twilio account and fund it. Brazilian local numbers are not available to individuals: buy one in the Twilio console with your company's bundle, then attach it in Studio.",
    "Twilio Console > Account info: copy the Account SID and the Auth Token into the two fields.",
    "Studio > Phone numbers needs the public address of this server (https, no path): it is shared by every provider and account.",
    "There is no application to create. When Zetta buys or attaches a number it sets the number's voice and status addresses itself: <public address>/api/phone/twilio/voice/<your account id> and /api/phone/twilio/status/<your account id>.",
    "Set a low auto-recharge or usage triggers in the Twilio Console: it is a limit Zetta cannot see.",
    "Press Test: it checks the Account SID, the Auth Token and that the account's numbers can be read.",
  ],
  // No tools on purpose: a bot never calls Twilio. Its calls go through the phone module (phone_out) with this account.
  tools: [],
  status,
};

registerPlugin(twilioPlugin);
