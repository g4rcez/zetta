export type InboundCardFilter = { direct: boolean; groups: boolean; chats: string[] };
export type InboundCardData = {
  plugin: string;
  pluginName: string;
  botId: string;
  botName: string;
  /** Plugin settings to save: only what changes. */
  settings: { key: string; label: string; from: string; to: string }[];
  /** The route after Apply; `replaces` is the bot that answers the channel now. */
  incoming?: { state: "on" | "off"; filter: InboundCardFilter; replaces?: string };
};

const ID = /^[a-z0-9_-]{1,32}$/;
const KEY = /^[a-zA-Z0-9_]{1,32}$/;
const text = (v: unknown, max: number): v is string => typeof v === "string" && v.length <= max;

/**
 * Reads the body of a ```zetta:inbound-card block. The server builds it; anything unexpected is undefined and the reply shows the raw block.
 * Apply saves exactly these values, so a field that is not the expected shape rejects the whole card.
 */
export function parseInboundCard(raw: string): InboundCardData | undefined {
  try {
    const d = JSON.parse(raw) as Record<string, unknown>;
    if (typeof d.plugin !== "string" || !ID.test(d.plugin)) return undefined;
    if (!text(d.pluginName, 80) || !text(d.botName, 80)) return undefined;
    if (typeof d.botId !== "string" || !d.botId) return undefined;
    if (!Array.isArray(d.settings) || d.settings.length > 10) return undefined;
    const settings: InboundCardData["settings"] = [];
    for (const s of d.settings as Record<string, unknown>[]) {
      if (typeof s?.key !== "string" || !KEY.test(s.key)) return undefined;
      if (!text(s.label, 120) || !text(s.from, 300) || !text(s.to, 300) || !s.to) return undefined;
      settings.push({ key: s.key, label: s.label, from: s.from, to: s.to });
    }
    const out: InboundCardData = {
      plugin: d.plugin,
      pluginName: d.pluginName,
      botId: d.botId,
      botName: d.botName,
      settings,
    };
    if (d.incoming !== undefined) {
      const i = d.incoming as Record<string, unknown>;
      const f = i?.filter as Record<string, unknown> | undefined;
      if (i?.state !== "on" && i?.state !== "off") return undefined;
      if (typeof f?.direct !== "boolean" || typeof f.groups !== "boolean") return undefined;
      if (!Array.isArray(f.chats) || f.chats.length > 50 || !f.chats.every((c) => text(c, 80)))
        return undefined;
      if (i.replaces !== undefined && !text(i.replaces, 80)) return undefined;
      out.incoming = {
        state: i.state,
        filter: { direct: f.direct, groups: f.groups, chats: f.chats as string[] },
        ...(i.replaces !== undefined && { replaces: i.replaces as string }),
      };
    }
    return settings.length || out.incoming ? out : undefined;
  } catch {
    return undefined;
  }
}

/** Who may start a bot turn through the channel, in words. */
export const reachLabel = (f: InboundCardFilter) =>
  f.chats.length
    ? `only ${f.chats.length} chosen chat${f.chats.length === 1 ? "" : "s"}`
    : f.direct && f.groups
      ? "direct chats and groups"
      : f.groups
        ? "groups only"
        : "direct chats only";

/** What Apply sends: the changed plugin settings (if any), then the route (if any). */
export function applyPlan(d: InboundCardData) {
  return {
    settings: Object.fromEntries(d.settings.map((s) => [s.key, s.to])),
    route: d.incoming && {
      enabled: d.incoming.state === "on",
      filter: d.incoming.filter,
    },
  };
}
