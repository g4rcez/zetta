/**
 * Forms the chief can open in the chat for things the model must never see or type: secrets, sign-ins, a destructive confirmation.
 * The server builds a ```zetta:form-card block; the person fills it in and the card calls the normal API with their own session.
 * `prefill` holds only harmless text (a name, a URL the chief suggested), never a secret.
 */
export const FORMS = [
  "bot_database_reset",
  "connection",
  "invite",
  "installation",
  "source_login",
] as const;
export type FormName = (typeof FORMS)[number];
export type FormCardBody = {
  form: FormName;
  /** The bot the form is about, when it is about one. */
  botId: string | null;
  botName: string | null;
  prefill: Record<string, string>;
};
/** Backticks become quotes so a value can never close the fence. */
export const formBlock = (b: FormCardBody) =>
  `\`\`\`zetta:form-card\n${JSON.stringify(b).replace(/`/g, "'")}\n\`\`\``;
