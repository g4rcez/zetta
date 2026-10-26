import { defineRegistry, JSONUIProvider, Renderer } from "@json-render/react";
import { ArrowDownRight, ArrowRight, ArrowUpRight } from "lucide-react";
import type { ReactNode } from "react";

import { catalog } from "@zetta/render/catalog";
import type { UiSpec } from "@zetta/render/reply";
import { Badge } from "@zetta/ui/components/badge";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@zetta/ui/components/card";
import { Separator } from "@zetta/ui/components/separator";
import { cn } from "@zetta/ui/lib/utils";

type Tone = "default" | "muted" | "info" | "success" | "warning" | "danger";
const TEXT: Record<Tone, string> = { default: "text-foreground", muted: "text-muted-foreground", info: "text-sky-600 dark:text-sky-400", success: "text-emerald-600 dark:text-emerald-400", warning: "text-amber-600 dark:text-amber-400", danger: "text-destructive" };
const BOX: Record<Tone, string> = { default: "border-border bg-muted/40", muted: "border-border bg-muted/40", info: "border-sky-500/40 bg-sky-500/10", success: "border-emerald-500/40 bg-emerald-500/10", warning: "border-amber-500/40 bg-amber-500/10", danger: "border-destructive/40 bg-destructive/10" };
const GAP = { sm: "gap-1.5", md: "gap-3", lg: "gap-5" } as const;
const HEADING = { "1": "text-lg font-semibold", "2": "text-base font-semibold", "3": "text-sm font-semibold" } as const;
const TREND = { up: ArrowUpRight, down: ArrowDownRight, flat: ArrowRight } as const;
const cell = "px-2.5 py-1.5 text-left align-top";

/** Model-written links only ever point at public web pages; the catalog already checks this, the renderer checks again. */
const safeHref = (href: string) => (/^https?:\/\//i.test(href) ? href : undefined);

/** One implementation per catalog entry; `defineRegistry` fails the type check when the catalog gains a component this file lacks. */
const { registry } = defineRegistry(catalog, {
  components: {
    Stack: ({ props, children }) => <div className={cn("flex min-w-0 flex-wrap", props.direction === "horizontal" ? "flex-row items-start" : "flex-col", GAP[props.gap ?? "md"])}>{children}</div>,
    Card: ({ props, children }) => (
      <Card size="sm" className="w-full max-w-2xl">
        {(props.title || props.description) && <CardHeader>{props.title && <CardTitle>{props.title}</CardTitle>}{props.description && <CardDescription>{props.description}</CardDescription>}</CardHeader>}
        <CardContent className="flex min-w-0 flex-col gap-3">{children}</CardContent>
      </Card>),
    Heading: ({ props }) => <p role="heading" aria-level={Number(props.level ?? "2")} className={HEADING[props.level ?? "2"]}>{props.text}</p>,
    Text: ({ props }) => <p className={cn("whitespace-pre-wrap break-words text-sm", TEXT[props.tone ?? "default"])}>{props.text}</p>,
    Badge: ({ props }) => <Badge variant="outline" className={cn(TEXT[props.tone ?? "default"], BOX[props.tone ?? "default"])}>{props.label}</Badge>,
    Metric: ({ props }) => {
      const Trend = props.trend ? TREND[props.trend] : undefined;
      return (
        <div className="flex min-w-28 flex-col gap-0.5">
          <span className="text-xs text-muted-foreground">{props.label}</span>
          <span className="flex items-center gap-1 text-2xl font-semibold tabular-nums">{props.value}{Trend && <Trend aria-label={props.trend} className={cn("size-5", props.trend === "up" && TEXT.success, props.trend === "down" && TEXT.danger, props.trend === "flat" && TEXT.muted)} />}</span>
          {props.hint && <span className="text-xs text-muted-foreground">{props.hint}</span>}
        </div>);
    },
    KeyValue: ({ props }) => <dl className="grid grid-cols-[max-content_1fr] gap-x-4 gap-y-1 text-sm">{props.items.map((item, i) => <div key={i} className="contents"><dt className="text-muted-foreground">{item.label}</dt><dd className="min-w-0 break-words">{item.value}</dd></div>)}</dl>,
    Table: ({ props }) => (
      <div className="max-w-full overflow-x-auto rounded-md border">
        <table className="w-full border-collapse text-sm">
          <thead className="bg-muted/50"><tr>{props.columns.map((c, i) => <th key={i} scope="col" className={cn(cell, "font-medium")}>{c}</th>)}</tr></thead>
          <tbody>{props.rows.map((row, r) => <tr key={r} className="border-t">{props.columns.map((_, c) => <td key={c} className={cell}>{row[c] ?? ""}</td>)}</tr>)}</tbody>
        </table>
      </div>),
    List: ({ props }) => { const Tag = props.ordered ? "ol" : "ul"; return <Tag className={cn("space-y-0.5 pl-5 text-sm", props.ordered ? "list-decimal" : "list-disc")}>{props.items.map((item, i) => <li key={i} className="break-words">{item}</li>)}</Tag>; },
    Alert: ({ props }) => <div role="note" className={cn("rounded-md border px-3 py-2 text-sm", BOX[props.tone ?? "info"])}>{props.title && <p className="font-medium">{props.title}</p>}<p className="whitespace-pre-wrap break-words">{props.message}</p></div>,
    Progress: ({ props }) => (
      <div className="flex flex-col gap-1">
        {props.label && <div className="flex justify-between text-xs"><span>{props.label}</span><span className="tabular-nums text-muted-foreground">{Math.round(props.value)}%</span></div>}
        <div role="progressbar" aria-label={props.label ?? "Progress"} aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.round(props.value)} className="h-2 overflow-hidden rounded-full bg-muted"><div className="h-full rounded-full bg-primary" style={{ width: `${props.value}%` }} /></div>
      </div>),
    Code: ({ props }) => <pre className="max-w-full overflow-x-auto rounded-md bg-muted px-3 py-2 font-mono text-xs"><code data-language={props.language ?? undefined}>{props.code}</code></pre>,
    Link: ({ props }) => { const href = safeHref(props.href); return href ? <a href={href} target="_blank" rel="noopener noreferrer nofollow" className="w-fit break-words text-sm text-primary underline underline-offset-2">{props.label}</a> : <span className="text-sm">{props.label}</span>; },
    Divider: () => <Separator />,
  },
});

/** Placeholder while a block is still streaming and nothing drawable has arrived yet. */
export const UiSkeleton = (): ReactNode => <div role="status" aria-label="Building view" className="h-16 w-full max-w-2xl animate-pulse rounded-lg bg-muted motion-reduce:animate-none" />;

/** Draws a spec that already passed `@zetta/render/reply`; no state or actions are wired, so it is display-only. */
export function UiView({ spec, streaming = false }: { spec: UiSpec; streaming?: boolean }) {
  return <JSONUIProvider registry={registry}><Renderer spec={spec} registry={registry} loading={streaming} /></JSONUIProvider>;
}
