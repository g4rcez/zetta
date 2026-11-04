/** The forms the server may ask the chat to draw (apps/server/src/modules/chat/chief/forms.ts). */
export const FORMS = [
  "bot_database_reset",
  "connection",
  "invite",
  "installation",
  "source_login",
] as const;
export type FormName = (typeof FORMS)[number];
export type FormCardData = {
  form: FormName;
  botId: string | null;
  botName: string | null;
  /** Harmless text the chief suggested (a name, an address). Never a secret. */
  prefill: Record<string, string>;
};

/** Reads the body of a ```zetta:form-card block. The server builds it; anything unexpected is undefined and the reply shows the raw block. */
export function parseFormCard(raw: string): FormCardData | undefined {
  try {
    const d = JSON.parse(raw) as Record<string, unknown>;
    if (!FORMS.includes(d.form as FormName)) return undefined;
    const text = (v: unknown) => (typeof v === "string" && v ? v : null);
    const prefill: Record<string, string> = {};
    if (d.prefill && typeof d.prefill === "object" && !Array.isArray(d.prefill))
      for (const [k, v] of Object.entries(d.prefill).slice(0, 8))
        if (/^[a-zA-Z0-9_]{1,32}$/.test(k) && typeof v === "string") prefill[k] = v.slice(0, 300);
    return {
      form: d.form as FormName,
      botId: text(d.botId),
      botName: text(d.botName),
      prefill,
    };
  } catch {
    return undefined;
  }
}
