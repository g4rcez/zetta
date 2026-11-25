/**
 * Telnyx as a plugin. Its settings are the plugin's own configuration, the same as any plugin's: sealed for the person who saved them, or
 * saved by the administrator as the team configuration so every member of a shared workspace (and every shared bot) uses one account.
 * The plugin has no tools: bots never call Telnyx directly, they place and answer calls through the phone module, which asks this
 * configuration for the account of the number's owner (`createPhoneProviderReader`, `telnyxAccount`).
 *
 * The public address, countries, limits and default provider stay installation-wide (one address reaches this server whatever the
 * account), and are shared with Twilio.
 */
import {
  PluginError,
  registerPlugin,
  type PluginContext,
  type PluginDef,
  type PluginStatus,
} from "../integrations/plugins/registry";
import { createTelnyxProvider, ed25519PublicKey } from "./telnyx";

export const TELNYX_PLUGIN_ID = "telnyx";

/** What one Telnyx account needs to place and answer calls. */
export type TelnyxAccount = { apiKey: string; publicKey: string; applicationId: string };

/** The account saved in a plugin configuration, or undefined while something is missing or the public key cannot be read. */
export function telnyxAccountOf(
  config: Readonly<Record<string, string>>,
): TelnyxAccount | undefined {
  const apiKey = (config.apiKey ?? "").trim();
  const publicKey = (config.publicKey ?? "").trim();
  const applicationId = (config.applicationId ?? "").trim();
  if (!apiKey || !publicKey || !applicationId) return undefined;
  if (!ed25519PublicKey(publicKey)) return undefined;
  return { apiKey, publicKey, applicationId };
}

async function status(ctx: PluginContext): Promise<PluginStatus> {
  const account = telnyxAccountOf(ctx.config);
  if (!account)
    return {
      state: "needs-auth",
      detail: "Add the API key, the public key and the Call Control application id.",
    };
  try {
    const check = await createTelnyxProvider({
      apiKey: account.apiKey,
      publicKey: account.publicKey,
      connectionRef: account.applicationId,
    }).checkAccount?.();
    if (check && !check.keyOk)
      return { state: "error", detail: "Telnyx did not accept the API key." };
    if (check && !check.applicationOk)
      return { state: "error", detail: "Telnyx does not know that Call Control application." };
    return { state: "connected", info: check?.balance ? { balance: check.balance } : undefined };
  } catch (e) {
    if (e instanceof PluginError) throw e;
    return { state: "error", detail: "Telnyx could not be reached. Try again in a moment." };
  }
}

export const telnyxPlugin: PluginDef = {
  id: "telnyx",
  name: "Telnyx",
  description:
    "Phone numbers and calls for your bots on your own Telnyx account: bots answer calls to their number and place calls for you.",
  icon: "telnyx",
  category: "messaging",
  kind: "native",
  auth: "api-key",
  docsUrl: "https://developers.telnyx.com",
  notes:
    "The numbers are bought and billed on your Telnyx account. Saved by the administrator as the team configuration, one account serves every member and every shared bot.",
  fields: [
    {
      key: "apiKey",
      label: "API key (v2)",
      kind: "password",
      secret: true,
      help: "Telnyx portal > Keys & Credentials > API Keys.",
    },
    {
      key: "publicKey",
      label: "Public key",
      kind: "text",
      help: "Telnyx portal > Keys & Credentials > Public Key. Used to check that a webhook came from Telnyx.",
    },
    {
      key: "applicationId",
      label: "Call Control application id",
      kind: "text",
      help: "Voice > Programmable Voice > Applications. Its webhook URL is shown in the setup steps.",
    },
  ],
  guide: () => [
    "Create a Telnyx account and fund it. Brazilian numbers need identity papers before the order is approved; buy one in the Telnyx portal and attach it here.",
    "Telnyx portal > Keys & Credentials > API Keys: create a v2 key and paste it in the API key field.",
    "Keys & Credentials > Public Key: paste it in the Public key field.",
    "Voice > Programmable Voice > Applications: add a Call Control application with API version v2, and paste its id in the application id field. Optionally add an outbound voice profile with a daily spend limit.",
    "Set the application's webhook URL to the address shown under Studio > Phone numbers for your account (the public address, then /api/phone/webhook/<your account id>).",
    "Press Test: it checks the key and the application.",
  ],
  // No tools on purpose: a bot never calls Telnyx. Its calls go through the phone module (phone_out) with this account.
  tools: [],
  status,
};

registerPlugin(telnyxPlugin);
