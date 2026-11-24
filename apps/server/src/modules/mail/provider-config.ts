import { mailIsOn, type MailSettings } from "@zetta/core/mail-provision";
import type { InstallationKeyReader, InstallationKeyState } from "../connections/installation-key";
import type { InstallationSettings } from "../installation/service";
import type { MailProvider } from "./providers/provider";
import { createResendProvider } from "./providers/resend";

/** The mail columns of the installation settings, and nothing else. */
export const mailSettingsOf = (s: InstallationSettings): MailSettings => ({
  mailProvider: s.mailProvider,
  mailDomain: s.mailDomain,
});

/**
 * What bot addresses read, on every call, so a change in Studio applies at once (the way `installation/speech.ts` does). The same in
 * every `ZETTA_ROLE`. The key is opened only to build the provider for one use and never leaves this file.
 */
export function createMailProviderReader(deps: {
  load: () => Promise<InstallationSettings>;
  key: InstallationKeyReader;
  /** Replaceable so a test needs no network. */
  create?: (name: MailSettings["mailProvider"], apiKey: string) => MailProvider | undefined;
}) {
  const create =
    deps.create ??
    ((name: MailSettings["mailProvider"], apiKey: string) =>
      name === "resend" ? createResendProvider({ apiKey }) : undefined);
  const keyState = async (): Promise<InstallationKeyState> =>
    deps.key.state((await deps.load()).mailConnectionId);
  return {
    settings: async (): Promise<MailSettings> => mailSettingsOf(await deps.load()),
    keyState,
    /** Whether a bot can be given an address now: a provider, a domain and a key that can be read. */
    async enabled(): Promise<{ on: boolean; domain: string }> {
      const s = await deps.load();
      const on = mailIsOn(mailSettingsOf(s), await deps.key.state(s.mailConnectionId));
      return { on, domain: on ? s.mailDomain : "" };
    },
    /** The provider for the saved choice, or undefined when it is off or has no readable key. */
    async provider(): Promise<MailProvider | undefined> {
      const s = await deps.load();
      if (s.mailProvider === "off") return undefined;
      const secret = await deps.key.secret(s.mailConnectionId);
      if (!secret) return undefined;
      try {
        return create(s.mailProvider, secret.toString("utf8"));
      } finally {
        secret.fill(0);
      }
    },
  };
}
export type MailProviderReader = ReturnType<typeof createMailProviderReader>;
