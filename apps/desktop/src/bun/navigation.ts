/**
 * Where a link clicked inside a server window goes.
 * `inside`: the page stays where it is (the server's own origins). `external`: the system browser opens it, so a page we do not trust never
 * runs inside the app. `block`: not opened anywhere (`javascript:`, `file:`, `views:`, `data:`...).
 */
export type NavigationTarget = "inside" | "external" | "block";

export function decideNavigation(url: string, insideOrigins: readonly string[]): NavigationTarget {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return "block";
  }
  if (url === "about:blank") return "inside";
  if (parsed.protocol === "mailto:") return "external";
  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") return "block";
  return insideOrigins.includes(parsed.origin) ? "inside" : "external";
}
