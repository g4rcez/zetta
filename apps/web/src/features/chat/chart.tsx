import { useState } from "react";

import { cn } from "@zetta/ui/lib/utils";
import { barPath, compact, full, niceTicks, shorten, slicePath } from "./chart-math";

/**
 * The chat's Chart (a `Chart` element of @zetta/render's catalog), drawn as plain SVG: no chart library.
 * Marks follow one fixed spec: columns up to 24px with a 4px rounded data end, 2px lines, 8px dots with a 2px ring in the
 * card color, areas as a 10% wash, hairline grid. Series colors are `--viz-1..8` (index.css), in a fixed order.
 */

export type PieData = { type: "pie"; segments: { label: string; value: number }[] };
export type AxisData = {
  type: "bar" | "line" | "area";
  categories: string[];
  series: { name: string; values: number[] }[];
  xLabel?: string | null | undefined;
  yLabel?: string | null | undefined;
};

const W = 640;
const H = 260;
const GAP = 2;
const MAX_BAR = 24;
const color = (i: number) => `var(--viz-${(i % 8) + 1})`;

/** The color of a series, with its shape: a short line for line charts, a square for the rest. */
function Key({ i, line }: { i: number; line?: boolean }) {
  return (
    <span
      aria-hidden="true"
      className={cn(
        "inline-block shrink-0",
        line ? "h-0.5 w-3 rounded-full" : "size-2.5 rounded-sm",
      )}
      style={{ backgroundColor: color(i) }}
    />
  );
}

function ValuesTable({ chart }: { chart: AxisData }) {
  return (
    <details className="text-xs">
      <summary className="w-fit cursor-pointer text-muted-foreground">Values</summary>
      <div className="mt-1 max-w-full overflow-x-auto rounded-md border">
        <table className="w-full border-collapse">
          <thead className="bg-muted/50">
            <tr>
              <th scope="col" className="px-2 py-1 text-left font-medium" />
              {chart.series.map((s, i) => (
                <th key={i} scope="col" className="px-2 py-1 text-right font-medium">
                  {s.name}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {chart.categories.map((c, r) => (
              <tr key={r} className="border-t">
                <th scope="row" className="px-2 py-1 text-left font-normal">
                  {c}
                </th>
                {chart.series.map((s, i) => (
                  <td key={i} className="px-2 py-1 text-right tabular-nums">
                    {full(s.values[r] ?? 0)}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </details>
  );
}

function AxisChart({ title, chart }: { title: string; chart: AxisData }) {
  const [hover, setHover] = useState<number | null>(null);
  const { type, categories, series } = chart;
  const values = series.flatMap((s) => s.values);
  // Columns and areas grow from zero, so zero is always on the axis; a line may float.
  const grows = type !== "line";
  const ticks = niceTicks(
    grows ? Math.min(0, ...values) : Math.min(...values),
    grows ? Math.max(0, ...values) : Math.max(...values),
  );
  const [min, max] = [ticks[0]!, ticks[ticks.length - 1]!];
  const left = chart.yLabel ? 60 : 48;
  const bottom = chart.xLabel ? 44 : 30;
  const top = 12;
  const right = 12;
  const pw = W - left - right;
  const ph = H - top - bottom;
  const band = pw / categories.length;
  const y = (v: number) => top + ph - ((v - min) / (max - min || 1)) * ph;
  const x = (i: number) => left + band * i + band / 2;
  const base = y(Math.min(Math.max(0, min), max));
  const every = Math.ceil(categories.length / Math.max(1, Math.floor(pw / 64)));
  const barW = Math.max(
    1,
    Math.min(MAX_BAR, (band * 0.7 - (series.length - 1) * GAP) / series.length),
  );
  const groupW = series.length * barW + (series.length - 1) * GAP;
  const label = `${title}. ${type} chart, ${series.length === 1 ? "one series" : `${series.length} series`}, ${categories.length} categories. The values follow in a table.`;
  const tipLeft = hover === null ? 0 : Math.min(85, Math.max(15, (x(hover) / W) * 100));

  return (
    <>
      {series.length > 1 && (
        <ul className="m-0 flex list-none flex-wrap gap-x-4 gap-y-1 p-0 text-xs text-muted-foreground">
          {series.map((s, i) => (
            <li key={i} className="flex items-center gap-1.5">
              <Key i={i} line={type === "line"} />
              {s.name}
            </li>
          ))}
        </ul>
      )}
      <div className="relative">
        <svg
          role="img"
          aria-label={label}
          viewBox={`0 0 ${W} ${H}`}
          className="h-auto w-full overflow-visible"
          onPointerLeave={() => setHover(null)}
        >
          {ticks.map((t) => (
            <g key={t}>
              <line
                x1={left}
                x2={W - right}
                y1={y(t)}
                y2={y(t)}
                strokeWidth={1}
                className={t === 0 && grows ? "stroke-muted-foreground/50" : "stroke-border"}
              />
              <text
                x={left - 8}
                y={y(t)}
                textAnchor="end"
                dominantBaseline="middle"
                fontSize={11}
                className="fill-muted-foreground"
              >
                {compact(t)}
              </text>
            </g>
          ))}
          {categories.map((c, i) =>
            i % every === 0 ? (
              <text
                key={i}
                x={x(i)}
                y={H - bottom + 16}
                textAnchor="middle"
                fontSize={11}
                className="fill-muted-foreground"
              >
                {shorten(c)}
              </text>
            ) : null,
          )}
          {chart.xLabel && (
            <text
              x={left + pw / 2}
              y={H - 4}
              textAnchor="middle"
              fontSize={11}
              className="fill-muted-foreground"
            >
              {chart.xLabel}
            </text>
          )}
          {chart.yLabel && (
            <text
              transform={`translate(12 ${top + ph / 2}) rotate(-90)`}
              textAnchor="middle"
              fontSize={11}
              className="fill-muted-foreground"
            >
              {chart.yLabel}
            </text>
          )}
          {hover !== null && (
            <rect
              x={left + band * hover}
              y={top}
              width={band}
              height={ph}
              className="fill-muted/60"
            />
          )}
          {type === "bar" &&
            categories.map((_, i) =>
              series.map((s, j) => {
                const v = s.values[i] ?? 0;
                return (
                  <path
                    key={`${i}-${j}`}
                    d={barPath(x(i) - groupW / 2 + j * (barW + GAP), base, y(v), barW)}
                    style={{ fill: color(j) }}
                  />
                );
              }),
            )}
          {type !== "bar" &&
            series.map((s, j) => {
              const pts = s.values.map((v, i) => `${x(i).toFixed(2)},${y(v).toFixed(2)}`);
              const line = `M${pts.join("L")}`;
              return (
                <g key={j}>
                  {type === "area" && (
                    <path
                      d={`${line}L${x(s.values.length - 1).toFixed(2)},${base}L${x(0).toFixed(2)},${base}Z`}
                      style={{ fill: color(j) }}
                      opacity={0.1}
                    />
                  )}
                  <path
                    d={line}
                    fill="none"
                    strokeWidth={2}
                    strokeLinejoin="round"
                    strokeLinecap="round"
                    style={{ stroke: color(j) }}
                  />
                </g>
              );
            })}
          {type !== "bar" &&
            series.map((s, j) => {
              const dots = hover !== null ? [hover] : [s.values.length - 1];
              return dots.map((i) => (
                <circle
                  key={`${j}-${i}`}
                  cx={x(i)}
                  cy={y(s.values[i] ?? 0)}
                  r={4}
                  strokeWidth={2}
                  className="stroke-card"
                  style={{ fill: color(j) }}
                />
              ));
            })}
          {categories.map((_, i) => (
            <rect
              key={i}
              x={left + band * i}
              y={top}
              width={band}
              height={ph}
              fill="transparent"
              onPointerEnter={() => setHover(i)}
              onPointerMove={() => setHover(i)}
            />
          ))}
        </svg>
        {hover !== null && (
          <div
            aria-hidden="true"
            className="pointer-events-none absolute top-0 z-10 min-w-28 -translate-x-1/2 rounded-md border bg-popover px-2.5 py-1.5 text-xs text-popover-foreground shadow-md"
            style={{ left: `${tipLeft}%` }}
          >
            <div className="mb-1 font-medium">{categories[hover]}</div>
            {series.map((s, i) => (
              <div key={i} className="flex items-center gap-1.5">
                <Key i={i} line={type === "line"} />
                <span className="text-muted-foreground">{s.name}</span>
                <span className="ml-auto pl-3 tabular-nums">{full(s.values[hover] ?? 0)}</span>
              </div>
            ))}
          </div>
        )}
      </div>
      <ValuesTable chart={chart} />
    </>
  );
}

function PieChart({ title, chart }: { title: string; chart: PieData }) {
  const total = chart.segments.reduce((sum, s) => sum + s.value, 0);
  if (total <= 0) return <p className="text-sm text-muted-foreground">No data.</p>;
  let from = 0;
  const slices = chart.segments.map((s, i) => {
    const share = s.value / total;
    const slice = { ...s, i, share, start: from, end: from + share };
    from += share;
    return slice;
  });
  const percent = (share: number) => `${Math.round(share * 100)}%`;
  const label = `${title}. Pie chart: ${slices.map((s) => `${s.label} ${percent(s.share)}`).join(", ")}.`;
  return (
    <div className="flex flex-wrap items-center gap-x-6 gap-y-3">
      <svg role="img" aria-label={label} viewBox="0 0 160 160" className="size-40 shrink-0">
        {slices.map((s) =>
          s.share > 0 ? (
            <path
              key={s.i}
              d={slicePath(80, 80, 76, s.start, s.end)}
              strokeWidth={2}
              className="stroke-card"
              style={{ fill: color(s.i) }}
            />
          ) : null,
        )}
      </svg>
      <ul className="m-0 flex min-w-0 list-none flex-col gap-1 p-0 text-xs">
        {slices.map((s) => (
          <li key={s.i} className="flex items-center gap-1.5">
            <Key i={s.i} />
            <span className="min-w-0 break-words text-muted-foreground">{s.label}</span>
            <span className="pl-2 tabular-nums">
              {full(s.value)} <span className="text-muted-foreground">({percent(s.share)})</span>
            </span>
          </li>
        ))}
      </ul>
    </div>
  );
}

export function ChartView({ title, chart }: { title: string; chart: PieData | AxisData }) {
  return (
    <figure className="m-0 flex w-full min-w-0 max-w-2xl flex-col gap-2">
      <figcaption className="text-sm font-medium">{title}</figcaption>
      {chart.type === "pie" ? (
        <PieChart title={title} chart={chart} />
      ) : (
        <AxisChart title={title} chart={chart} />
      )}
    </figure>
  );
}
