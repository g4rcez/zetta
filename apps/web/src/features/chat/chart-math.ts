/** Geometry for the chat's Chart: pure functions, so the SVG component stays thin and the numbers are testable. */

/** Round tick values that cover [min, max]: steps of 1, 2 or 5 times a power of ten (rounded to the nearest, so 210 ends at 250, not 300). */
export function niceTicks(min: number, max: number, count = 4): number[] {
  if (min === max) {
    if (max === 0) return [0, 1];
    min = Math.min(min, 0);
    max = Math.max(max, 0);
  }
  const raw = (max - min) / count;
  const pow = 10 ** Math.floor(Math.log10(raw));
  const frac = raw / pow;
  const step =
    (frac <= Math.SQRT2 ? 1 : frac <= Math.sqrt(10) ? 2 : frac <= Math.sqrt(50) ? 5 : 10) * pow;
  const start = Math.floor(min / step) * step;
  const end = Math.ceil(max / step) * step;
  const ticks: number[] = [];
  for (let v = start; v <= end + step / 2; v += step) ticks.push(Number(v.toFixed(10)));
  return ticks;
}

/** A column from the baseline `y0` to the value's end `y1`, with the data end rounded (4px) and the baseline end square. */
export function barPath(x: number, y0: number, y1: number, width: number, radius = 4): string {
  const h = Math.abs(y1 - y0);
  if (h === 0 || width <= 0) return "";
  const r = Math.min(radius, h, width / 2);
  const right = x + width;
  return y1 < y0
    ? `M${x},${y0}V${y1 + r}Q${x},${y1} ${x + r},${y1}H${right - r}Q${right},${y1} ${right},${y1 + r}V${y0}Z`
    : `M${x},${y0}V${y1 - r}Q${x},${y1} ${x + r},${y1}H${right - r}Q${right},${y1} ${right},${y1 - r}V${y0}Z`;
}

/** A pie slice from `start` to `end` (fractions of the whole, from 12 o'clock, clockwise). A whole circle is drawn as two arcs. */
export function slicePath(cx: number, cy: number, r: number, start: number, end: number): string {
  const point = (f: number) => {
    const a = f * Math.PI * 2 - Math.PI / 2;
    return `${(cx + r * Math.cos(a)).toFixed(3)},${(cy + r * Math.sin(a)).toFixed(3)}`;
  };
  if (end - start >= 0.9999)
    return `M${cx},${cy - r}A${r},${r} 0 1 1 ${cx},${cy + r}A${r},${r} 0 1 1 ${cx},${cy - r}Z`;
  return `M${cx},${cy}L${point(start)}A${r},${r} 0 ${end - start > 0.5 ? 1 : 0} 1 ${point(end)}Z`;
}

/** 1,234 / 12.9K on an axis that needs the room; full numbers in the table and tooltip. */
export const compact = (v: number) =>
  new Intl.NumberFormat("en", { notation: "compact", maximumFractionDigits: 1 }).format(v);
export const full = (v: number) =>
  new Intl.NumberFormat("en", { maximumFractionDigits: 2 }).format(v);

/** Cuts a long category label for the axis; the table and tooltip keep it whole. */
export const shorten = (s: string, max = 12) => (s.length > max ? `${s.slice(0, max - 1)}…` : s);
