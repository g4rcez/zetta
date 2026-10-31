export type SetupCardData = {
  plugin: string;
  botId: string;
  scope: "mine" | "team";
  /** Google permissions to preselect. */
  scopes?: string[];
};

const ID = /^[a-z0-9_-]{1,32}$/;

/** Reads the body of a ```zetta:setup-card block. The server builds it; anything unexpected is undefined and the reply shows the raw block. */
export function parseSetupCard(raw: string): SetupCardData | undefined {
  try {
    const d = JSON.parse(raw) as Record<string, unknown>;
    if (typeof d.plugin !== "string" || !ID.test(d.plugin)) return undefined;
    if (typeof d.botId !== "string" || !d.botId) return undefined;
    if (d.scope !== "mine" && d.scope !== "team") return undefined;
    const scopes = Array.isArray(d.scopes)
      ? d.scopes.filter((s): s is string => typeof s === "string").slice(0, 10)
      : undefined;
    return { plugin: d.plugin, botId: d.botId, scope: d.scope, ...(scopes && { scopes }) };
  } catch {
    return undefined;
  }
}

const URL_AT_END = /^(https?:\/\/\S+?)([.,;:)]*)$/;
/** Splits a guide step into text and web addresses, so the card can draw the addresses as links. A trailing full stop is not part of the address. */
export function linkParts(step: string): { text: string; href?: string }[] {
  return step
    .split(/(\s+)/)
    .flatMap((w) => {
      const m = URL_AT_END.exec(w);
      return m ? [{ text: m[1]!, href: m[1]! }, ...(m[2] ? [{ text: m[2] }] : [])] : [{ text: w }];
    })
    .reduce<{ text: string; href?: string }[]>((out, p) => {
      const last = out.at(-1);
      if (last && !last.href && !p.href) last.text += p.text;
      else out.push({ ...p });
      return out;
    }, []);
}
