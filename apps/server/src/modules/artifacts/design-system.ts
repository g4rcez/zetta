/**
 * The Zetta look for HTML artifacts. A bot's page runs in a sandboxed iframe with no access to the app's CSS, so the server injects this
 * stylesheet into every HTML artifact it serves. The token values are copied from packages/ui/src/styles/globals.css; design-system.test.ts
 * fails when they drift apart.
 */
export const ARTIFACT_CSS = `
:root{--background:#fbfbfc;--foreground:#18181b;--card:#ffffff;--card-foreground:#18181b;--primary:#015a45;--primary-foreground:#ffffff;--secondary:#f0f0f3;--secondary-foreground:#18181b;--muted:#f0f0f3;--muted-foreground:#4a4a52;--accent:#ededf0;--accent-foreground:#18181b;--destructive:#8a1818;--border:#e2e2e6;--input:#8a8a93;--ring:#015a45;--chart-1:#015a45;--chart-2:#16457e;--chart-3:#6a4100;--chart-4:#8a1818;--chart-5:#4a4a52;--radius:0.5rem;color-scheme:light}
@media (prefers-color-scheme:dark){:root{--background:#0f0f11;--foreground:#ededf0;--card:#141417;--card-foreground:#ededf0;--primary:#47c7a1;--primary-foreground:#09090b;--secondary:#1c1c20;--secondary-foreground:#ededf0;--muted:#1c1c20;--muted-foreground:#b4b4bc;--accent:#26262b;--accent-foreground:#ededf0;--destructive:#ff9c94;--border:#212121;--input:#6e6e78;--ring:#47c7a1;--chart-1:#47c7a1;--chart-2:#8db8f2;--chart-3:#f5b455;--chart-4:#ff9c94;--chart-5:#b4b4bc;color-scheme:dark}}
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
.btn:hover{background:var(--muted)}.btn-primary{background:var(--primary);color:var(--primary-foreground);border-color:transparent}.btn-primary:hover{background:color-mix(in oklch,var(--primary),var(--foreground) 12%)}
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
