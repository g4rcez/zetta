/**
 * The Zetta look for HTML artifacts. A bot's page runs in a sandboxed iframe with no access to the app's CSS, so the server injects this
 * stylesheet into every HTML artifact it serves. The token values are copied from packages/ui/src/styles/globals.css; design-system.test.ts
 * fails when they drift apart.
 */
export const ARTIFACT_CSS = `
:root{--background:oklch(0.985 0.003 265);--foreground:oklch(0.2 0.01 265);--card:oklch(1 0 0);--card-foreground:oklch(0.2 0.01 265);--primary:oklch(0.55 0.2 275);--primary-foreground:oklch(0.99 0 0);--secondary:oklch(0.955 0.006 265);--secondary-foreground:oklch(0.25 0.01 265);--muted:oklch(0.955 0.006 265);--muted-foreground:oklch(0.5 0.015 265);--accent:oklch(0.94 0.02 275);--accent-foreground:oklch(0.3 0.08 275);--destructive:oklch(0.58 0.22 27);--border:oklch(0.91 0.008 265);--input:oklch(0.9 0.008 265);--ring:oklch(0.6 0.15 275);--chart-1:oklch(0.809 0.105 251.813);--chart-2:oklch(0.623 0.214 259.815);--chart-3:oklch(0.546 0.245 262.881);--chart-4:oklch(0.488 0.243 264.376);--chart-5:oklch(0.424 0.199 265.638);--radius:0.5rem;color-scheme:light}
@media (prefers-color-scheme:dark){:root{--background:oklch(0.15 0.006 265);--foreground:oklch(0.97 0.003 265);--card:oklch(0.2 0.008 265);--card-foreground:oklch(0.97 0.003 265);--primary:oklch(0.68 0.17 275);--primary-foreground:oklch(0.15 0.01 265);--secondary:oklch(0.255 0.008 265);--secondary-foreground:oklch(0.97 0.003 265);--muted:oklch(0.235 0.008 265);--muted-foreground:oklch(0.7 0.012 265);--accent:oklch(0.3 0.04 275);--accent-foreground:oklch(0.97 0.003 265);--destructive:oklch(0.704 0.191 22.216);--border:oklch(1 0 0 / 8%);--input:oklch(1 0 0 / 12%);--ring:oklch(0.62 0.15 275);color-scheme:dark}}
*,*::before,*::after{box-sizing:border-box;border-color:var(--border)}
body{margin:0;padding:1.5rem 1rem;background:var(--background);color:var(--foreground);font:0.875rem/1.55 "Manrope Variable",ui-sans-serif,system-ui,sans-serif;-webkit-font-smoothing:antialiased}
h1,h2,h3,h4{font-family:"Outfit Variable","Manrope Variable",ui-sans-serif,system-ui,sans-serif;letter-spacing:-0.01em;margin:0}
h1{font-size:1.5rem;font-weight:600}h2{font-size:1rem;font-weight:600}h3{font-size:0.9375rem;font-weight:600}
p{margin:0}a{color:var(--primary);text-underline-offset:2px}a:hover{text-decoration-thickness:2px}
code,pre{font-family:"Fira Code Variable",ui-monospace,SFMono-Regular,Menlo,monospace;font-size:0.8125rem}
code{background:var(--muted);border-radius:calc(var(--radius) - 4px);padding:0.1rem 0.3rem}
pre{background:var(--muted);border:1px solid var(--border);border-radius:var(--radius);padding:0.75rem;overflow:auto}pre code{background:none;padding:0}
hr{border:0;border-top:1px solid var(--border);margin:0}
img{max-width:100%;height:auto;border-radius:var(--radius)}
.page{max-width:48rem;margin:0 auto;display:flex;flex-direction:column;gap:1.25rem}
.page-wide{max-width:72rem}
.stack{display:flex;flex-direction:column;gap:0.75rem}
.row{display:flex;flex-wrap:wrap;align-items:center;gap:0.5rem}
.grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(14rem,1fr));gap:0.75rem}
.card{background:var(--card);color:var(--card-foreground);border:1px solid var(--border);border-radius:var(--radius);padding:1rem;display:flex;flex-direction:column;gap:0.5rem}
.muted{color:var(--muted-foreground)}.small{font-size:0.75rem}
.badge{display:inline-flex;align-items:center;border-radius:999px;border:1px solid var(--border);background:var(--secondary);color:var(--secondary-foreground);padding:0.1rem 0.55rem;font-size:0.75rem;font-weight:500}
.badge-primary{background:var(--accent);color:var(--accent-foreground);border-color:transparent}
.badge-danger{background:color-mix(in oklch,var(--destructive) 15%,transparent);color:var(--destructive);border-color:transparent}
.btn{display:inline-flex;align-items:center;gap:0.4rem;border:1px solid var(--border);border-radius:var(--radius);background:var(--card);color:var(--foreground);padding:0.4rem 0.8rem;font:inherit;font-weight:500;text-decoration:none;cursor:pointer}
.btn:hover{background:var(--muted)}.btn-primary{background:var(--primary);color:var(--primary-foreground);border-color:transparent}.btn-primary:hover{background:color-mix(in oklch,var(--primary),black 12%)}
.stat{display:flex;flex-direction:column;gap:0.15rem}.stat-value{font-family:"Outfit Variable",ui-sans-serif,system-ui,sans-serif;font-size:1.5rem;font-weight:600}
.callout{border:1px solid color-mix(in oklch,var(--primary) 30%,transparent);background:var(--accent);color:var(--accent-foreground);border-radius:var(--radius);padding:0.75rem 1rem}
.callout-danger{border-color:color-mix(in oklch,var(--destructive) 40%,transparent);background:color-mix(in oklch,var(--destructive) 10%,transparent);color:var(--foreground)}
.table{width:100%;border-collapse:collapse}.table th{text-align:left;font-weight:600;background:var(--muted)}.table th,.table td{padding:0.5rem 0.75rem;border-bottom:1px solid var(--border)}
`.trim();

/** One line per class, shown to the bots. Keep it in step with ARTIFACT_CSS. */
export const ARTIFACT_CLASSES = [
  ".page (centered column, use it on one wrapper div; .page-wide for tables)",
  ".stack (vertical gap), .row (wrapping horizontal gap), .grid (responsive card grid)",
  ".card (panel), .callout / .callout-danger (highlighted note)",
  ".muted / .small (secondary text), .badge / .badge-primary / .badge-danger (labels)",
  ".btn / .btn-primary (a link or button), .stat + .stat-value (a number with its label), table.table",
];
export const ARTIFACT_COLOR_VARS =
  "--background --foreground --card --primary --primary-foreground --secondary --muted --muted-foreground --accent --destructive --border --chart-1 … --chart-5";

/** The part of the bot instructions about HTML artifacts. */
export const designSystemPrompt = () =>
  `Zetta adds its design system to every HTML artifact (light and dark follow the viewer), so do not write your own CSS for layout or color. Plain h1, h2, p, a, code, pre, hr and img are already styled. Build the page from these classes: ${ARTIFACT_CLASSES.join("; ")}. When you need a color, use only var(--token) with ${ARTIFACT_COLOR_VARS}; never write hex, rgb or named colors, and never override fonts. A small <style> is allowed only for something no class covers, and it must use those variables.`;

/** Puts the stylesheet first in the page, so the bot's own rules can still refine it. */
export function withDesignSystem(html: string) {
  const tag = `<style id="zetta-design">${ARTIFACT_CSS}</style>`;
  const head = /<head(\s[^>]*)?>/i.exec(html);
  return head
    ? html.slice(0, head.index + head[0].length) + tag + html.slice(head.index + head[0].length)
    : tag + html;
}
