export type AppLinkData = { app: string; name?: string };

const SLUG = /^[a-z0-9][a-z0-9-]{0,63}$/;

/**
 * Reads the body of a ```zetta:app.linkto block. The server builds it after a publish and a bot may write it, so only the slug is used to
 * look the app up (with the viewer's own session); `name` is fallback text. Anything else is undefined and the reply shows the raw block.
 */
export function parseAppLink(raw: string): AppLinkData | undefined {
  try {
    const d = JSON.parse(raw) as Record<string, unknown> | null;
    if (!d || typeof d.app !== "string" || !SLUG.test(d.app)) return undefined;
    const name = typeof d.name === "string" ? d.name.trim().slice(0, 80) : "";
    return name ? { app: d.app, name } : { app: d.app };
  } catch {
    return undefined;
  }
}
