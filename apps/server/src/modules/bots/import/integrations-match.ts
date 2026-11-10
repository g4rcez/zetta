/**
 * A Grok bot lists the "apps" it uses by name (Google Calendar, GitHub, Ramp...). This pairs each one with the Zetta plugin that does the
 * same job, so the new bot's page can say "connect Google" instead of just repeating a name. No match is an honest answer: the setup list
 * then reads "no Zetta equivalent".
 *
 * Pure on purpose: the caller hands in the plugins this server has, and only an id from that list is ever returned.
 */
export type PluginRef = { id: string; name: string };
export type MatchedIntegration = { name: string; description: string; pluginId: string | null };

/** Names a person (or the author) uses that are not a plugin's own name. The right-hand side must exist on the server to count. */
const ALIASES: Record<string, string> = {
  "google calendar": "google",
  gmail: "google",
  "google mail": "google",
  "google drive": "google",
  "google docs": "google",
  "google sheets": "google",
  "google workspace": "google",
  "one password": "onepassword",
  "1password": "onepassword",
};

/** Catch-all plugins: they reach many services, so a loose name must never land on them. */
const GENERIC = new Set(["apps", "composio"]);

/** Lowercase words only: "Chrome-DevTools", "chrome_devtools" and "Chrome DevTools" all become "chrome devtools". */
const words = (s: string) =>
  s
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim();

export function matchIntegrations(
  integrations: { name: string; description: string }[],
  plugins: readonly PluginRef[],
): MatchedIntegration[] {
  const byId = new Map(plugins.map((p) => [p.id, p]));
  // Each plugin under its id and its name, as words ("chrome devtools"); the loose rule skips the generic ones.
  const keys = plugins.flatMap((p) =>
    [words(p.id), words(p.name)].filter(Boolean).map((key) => ({ key, id: p.id })),
  );

  const find = (name: string): string | null => {
    const w = words(name);
    if (!w) return null;
    const exact = keys.find((k) => k.key === w);
    if (exact) return exact.id;
    const alias = ALIASES[w];
    if (alias && byId.has(alias)) return alias;
    // "GitHub Issues" starts with the plugin's name as whole words; "Not Linear At All" and "Linearity" do not count.
    const prefix = keys.find((k) => !GENERIC.has(k.id) && w.startsWith(`${k.key} `));
    return prefix?.id ?? null;
  };

  return integrations.map((i) => ({
    name: i.name,
    description: i.description,
    pluginId: find(i.name),
  }));
}
