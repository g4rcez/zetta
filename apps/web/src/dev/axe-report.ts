import axe from "axe-core";

// Development only (main.tsx loads it when the URL has `?axe` and the build is a dev build). It checks the open page
// against WCAG A/AA plus AAA contrast (PRODUCT.md: 7:1 for text) and prints the result in a panel, because the
// accessibility audit (RFC-088) reads it from the page itself.
const TAGS = ["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "wcag22aa", "wcag2aaa"];
const SETTLE_MS = 2000;

export async function runAxeReport() {
  await new Promise((resolve) => setTimeout(resolve, SETTLE_MS));
  const result = await axe.run(document, {
    runOnly: { type: "tag", values: TAGS },
    resultTypes: ["violations"],
  });
  // One line per rule, then the last part of up to three selectors and their text, so the panel stays readable.
  const short = (target: string) => (target.length > 70 ? `…${target.slice(-70)}` : target);
  const lines = result.violations.map(
    (v) =>
      `${v.id} [${v.impact ?? "n/a"}] x${v.nodes.length}\n  ${v.nodes
        .slice(0, 3)
        .map(
          (n) =>
            `${short(String(n.target.at(-1)))} «${(n.html.match(/>([^<]{1,40})/)?.[1] ?? "").trim()}»`,
        )
        .join("\n  ")}`,
  );
  const panel = document.createElement("pre");
  panel.setAttribute("role", "log");
  panel.setAttribute("aria-label", "axe report");
  panel.style.cssText =
    "position:fixed;left:8px;bottom:8px;z-index:2147483647;max-width:min(720px,90vw);max-height:45vh;overflow:auto;margin:0;padding:8px;background:#000;color:#fff;font:12px/16px monospace;white-space:pre-wrap;border-radius:8px";
  panel.textContent = `axe: ${result.violations.length} violation(s) on ${location.pathname}\n${lines.join("\n")}`;
  document.body.append(panel);
}
