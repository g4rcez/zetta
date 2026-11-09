import { bridgePrelude } from "@zetta/core/app-bridge";
import { ARTIFACT_HTML_CSP } from "@zetta/core/artifact-csp";
import type { AppFileSnapshot } from "@zetta/db/schema/apps";
import { ARTIFACT_CSS } from "../artifacts/design-system";
import { buildBrowser } from "../playground/build-browser";
import { PlaygroundError } from "../playground/types";

/** The page of an app is `ui/index.html` of its files. A playground that is a page itself (HTML) is its own page. */
export const UI_ENTRY = "ui/index.html";

/** Which file is the app's page, or null when the app has none. */
export function uiEntryOf(
  files: readonly { path: string }[],
  playground: { language: string; entry: string },
): string | null {
  if (files.some((f) => f.path === UI_ENTRY)) return UI_ENTRY;
  if (playground.language === "html" && files.some((f) => f.path === playground.entry))
    return playground.entry;
  return null;
}

/**
 * Builds the page of an app into one HTML file that needs nothing else, at publish time, so serving it is cheap and a version never
 * changes. What goes first in the head, in this order:
 *   1. a Content-Security-Policy meta tag, the same policy as an HTML artifact. The preview iframe's `csp` attribute is enforced only in
 *      Chromium; a meta tag is enforced by every browser, so the network stays closed everywhere.
 *   2. the design system, so the app looks like Zetta and follows light and dark; the page's own CSS comes later and can refine it.
 *   3. the bridge (`window.zetta.call`) and then the console relay.
 * A bare package import is refused with a message that names the CDNs the policy allows; a page over 5 MB is refused.
 */
export async function buildAppUi(o: {
  files: readonly AppFileSnapshot[];
  entry: string;
}): Promise<{ html: string; bytes: number }> {
  const head =
    `<meta http-equiv="Content-Security-Policy" content="${ARTIFACT_HTML_CSP}">` +
    `<style id="zetta-design">${ARTIFACT_CSS}</style>` +
    bridgePrelude();
  const { html } = await buildBrowser({
    language: "html",
    entry: o.entry,
    files: o.files,
    inputs: {},
    head,
  });
  return { html, bytes: Buffer.byteLength(html) };
}

/** The message of a failed build, for the person who wrote the page. */
export const uiBuildMessage = (e: unknown) =>
  e instanceof PlaygroundError
    ? (e.detail ?? "The page could not be built.")
    : "The page could not be built.";
