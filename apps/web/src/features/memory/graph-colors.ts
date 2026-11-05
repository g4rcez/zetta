import type { Graph } from "./memory-graph";
import { MISSING, OTHER } from "./memory-graph";

/** The theme colors a drawing needs, as `rgb()` strings the canvas and WebGL both understand. */
export type GraphColors = {
  group: (group: string) => string;
  link: string;
  linkDim: string;
  text: string;
  background: string;
  hit: string;
  muted: string;
};

// The chart tokens are the only multi-color ones. The red one (--chart-4) means "danger" in this design, so a group never gets it.
const GROUP_VARS = ["--chart-1", "--chart-2", "--chart-3", "--chart-5"];

/** A CSS color of any syntax (hex, oklch, a named one) as `rgb(r, g, b)`, by painting one pixel. Three.js cannot parse every syntax. */
function toRgb(css: string) {
  const c = document.createElement("canvas");
  c.width = c.height = 1;
  const ctx = c.getContext("2d", { willReadFrequently: true });
  if (!ctx || !css.trim()) return "rgb(128, 128, 128)";
  ctx.fillStyle = css.trim();
  ctx.fillRect(0, 0, 1, 1);
  const [r, g, b] = ctx.getImageData(0, 0, 1, 1).data;
  return `rgb(${r}, ${g}, ${b})`;
}

/** Reads the colors from the document's tokens. Call it again when the theme changes. */
export function readGraphColors(legend: Graph["legend"]): GraphColors {
  const style = getComputedStyle(document.documentElement);
  const v = (name: string) => toRgb(style.getPropertyValue(name));
  const muted = v("--muted-foreground");
  const palette = GROUP_VARS.map(v);
  const byGroup = new Map<string, string>();
  let next = 0;
  for (const { group } of legend)
    byGroup.set(
      group,
      group === OTHER
        ? muted
        : group === MISSING
          ? v("--border")
          : palette[next++ % palette.length]!,
    );
  return {
    group: (g) => byGroup.get(g) ?? muted,
    link: v("--border"),
    linkDim: v("--border"),
    text: v("--foreground"),
    background: v("--background"),
    hit: v("--primary"),
    muted,
  };
}

/** The same color with an opacity, for faint nodes and links. */
export const withAlpha = (rgb: string, alpha: number) =>
  rgb.replace("rgb(", "rgba(").replace(")", `, ${alpha})`);
