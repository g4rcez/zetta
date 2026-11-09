import { defineRegistry, JSONUIProvider, Renderer } from "@json-render/react";
import { ArrowDownRightIcon, ArrowRightIcon, ArrowUpRightIcon } from "@phosphor-icons/react";
import { Alert } from "@g4rcez/components/alert";
import type { ComponentContext } from "@json-render/react";
import type { ReactNode } from "react";

import { catalog } from "@zetta/render/catalog";
import type { UiSpec } from "@zetta/render/reply";
import { Card } from "@g4rcez/components/card";
import { Tag } from "@g4rcez/components/tag";
import { Separator } from "@/components/ui";
import { cn } from "@zetta/ui/lib/utils";
import { Progress } from "@/components/ui";
import { ChartView } from "./chart";

type Tone = "default" | "muted" | "info" | "success" | "warning" | "danger";
const TEXT: Record<Tone, string> = {
  default: "text-foreground",
  muted: "text-muted-foreground",
  info: "text-info",
  success: "text-success",
  warning: "text-warn",
  danger: "text-destructive",
};
const ALERT_THEME = {
  default: "neutral",
  muted: "neutral",
  info: "info",
  success: "success",
  warning: "warn",
  danger: "danger",
} as const satisfies Record<Tone, string>;
const TAG_THEME = { ...ALERT_THEME, muted: "muted" } as const satisfies Record<Tone, string>;
const GAP = { sm: "gap-1.5", md: "gap-3", lg: "gap-5" } as const;
const HEADING = {
  "1": "text-lg font-semibold",
  "2": "text-base font-semibold",
  "3": "text-sm font-semibold",
} as const;
const TREND = { up: ArrowUpRightIcon, down: ArrowDownRightIcon, flat: ArrowRightIcon } as const;
const cell = "px-2.5 py-1.5 text-left align-top";

/** Model-written links only ever point at public web pages; the catalog already checks this, the renderer checks again. */
const safeHref = (href: string) => (/^https?:\/\//i.test(href) ? href : undefined);

function UiStack({ props, children }: ComponentContext<typeof catalog, "Stack">) {
  return (
    <div
      className={cn(
        "flex min-w-0 flex-wrap",
        props.direction === "horizontal" ? "flex-row items-start" : "flex-col",
        GAP[props.gap ?? "md"],
      )}
    >
      {children}
    </div>
  );
}

function UiCard({ props, children }: ComponentContext<typeof catalog, "Card">) {
  return (
    <Card
      title={props.title ?? undefined}
      container="w-full max-w-2xl"
      className="flex min-w-0 flex-col gap-3"
    >
      {props.description && <p className="text-sm text-muted-foreground">{props.description}</p>}
      {children}
    </Card>
  );
}

function UiHeading({ props }: ComponentContext<typeof catalog, "Heading">) {
  return (
    <p
      role="heading"
      aria-level={Number(props.level ?? "2")}
      className={HEADING[props.level ?? "2"]}
    >
      {props.text}
    </p>
  );
}

function UiText({ props }: ComponentContext<typeof catalog, "Text">) {
  return (
    <p className={cn("whitespace-pre-wrap break-words text-sm", TEXT[props.tone ?? "default"])}>
      {props.text}
    </p>
  );
}

function UiBadge({ props }: ComponentContext<typeof catalog, "Badge">) {
  return (
    <Tag theme={TAG_THEME[props.tone ?? "default"]} size="tiny">
      {props.label}
    </Tag>
  );
}

function UiMetric({ props }: ComponentContext<typeof catalog, "Metric">) {
  const trend = props.trend ?? undefined,
    Trend = trend && TREND[trend];
  return (
    <div className="flex min-w-28 flex-col gap-0.5">
      <span className="text-xs text-muted-foreground">{props.label}</span>
      <span className="flex items-center gap-1 text-2xl font-semibold tabular-nums">
        {props.value}
        {Trend && (
          <Trend
            aria-label={trend}
            className={cn(
              "size-5",
              trend === "up" && TEXT.success,
              trend === "down" && TEXT.danger,
              trend === "flat" && TEXT.muted,
            )}
          />
        )}
      </span>
      {props.hint && <span className="text-xs text-muted-foreground">{props.hint}</span>}
    </div>
  );
}

function UiKeyValue({ props }: ComponentContext<typeof catalog, "KeyValue">) {
  return (
    <dl className="grid grid-cols-[max-content_1fr] gap-x-4 gap-y-1 text-sm">
      {props.items.map((item, i) => (
        <div key={i} className="contents">
          <dt className="text-muted-foreground">{item.label}</dt>
          <dd className="min-w-0 break-words">{item.value}</dd>
        </div>
      ))}
    </dl>
  );
}

function UiTable({ props }: ComponentContext<typeof catalog, "Table">) {
  return (
    <div className="max-w-full overflow-x-auto rounded-md border">
      <table className="w-full border-collapse text-sm">
        <thead className="bg-muted/50">
          <tr>
            {props.columns.map((c, i) => (
              <th key={i} scope="col" className={cn(cell, "font-medium")}>
                {c}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {props.rows.map((row, r) => (
            <tr key={r} className="border-t">
              {props.columns.map((_, c) => (
                <td key={c} className={cell}>
                  {row[c] ?? ""}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function UiList({ props }: ComponentContext<typeof catalog, "List">) {
  const Tag = props.ordered ? "ol" : "ul";
  return (
    <Tag className={cn("space-y-0.5 pl-5 text-sm", props.ordered ? "list-decimal" : "list-disc")}>
      {props.items.map((item, i) => (
        <li key={i} className="break-words">
          {item}
        </li>
      ))}
    </Tag>
  );
}

function UiAlert({ props }: ComponentContext<typeof catalog, "Alert">) {
  return (
    <Alert theme={ALERT_THEME[props.tone ?? "info"]} title={props.title ?? undefined}>
      <p className="whitespace-pre-wrap break-words">{props.message}</p>
    </Alert>
  );
}

function UiProgress({ props }: ComponentContext<typeof catalog, "Progress">) {
  return (
    <div className="flex flex-col gap-1">
      {props.label && (
        <div className="flex justify-between text-xs">
          <span>{props.label}</span>
          <span className="tabular-nums text-muted-foreground">{Math.round(props.value)}%</span>
        </div>
      )}
      <Progress label={props.label ?? "Progress"} value={props.value} size="medium" />
    </div>
  );
}

function UiCode({ props }: ComponentContext<typeof catalog, "Code">) {
  return (
    <pre className="max-w-full overflow-x-auto rounded-md bg-muted px-3 py-2 font-mono text-xs">
      <code data-language={props.language ?? undefined}>{props.code}</code>
    </pre>
  );
}

function UiLink({ props }: ComponentContext<typeof catalog, "Link">) {
  const href = safeHref(props.href);
  return href ? (
    <a
      href={href}
      target="_blank"
      rel="noopener noreferrer nofollow"
      className="w-fit break-words text-sm text-primary underline underline-offset-2"
    >
      {props.label}
    </a>
  ) : (
    <span className="text-sm">{props.label}</span>
  );
}

/** One implementation per catalog entry; `defineRegistry` fails the type check when the catalog gains a component this file lacks. */
const { registry } = defineRegistry(catalog, {
  components: {
    Stack: UiStack,
    Card: UiCard,
    Heading: UiHeading,
    Text: UiText,
    Badge: UiBadge,
    Metric: UiMetric,
    KeyValue: UiKeyValue,
    Table: UiTable,
    List: UiList,
    Alert: UiAlert,
    Progress: UiProgress,
    Chart: ({ props }) => <ChartView title={props.title} chart={props.chart} />,
    Code: UiCode,
    Link: UiLink,
    Divider: () => <Separator />,
  },
});

/** Placeholder while a block is still streaming and nothing drawable has arrived yet. */
export const UiSkeleton = (): ReactNode => (
  <div
    role="status"
    aria-label="Building view"
    className="h-16 w-full max-w-2xl animate-pulse rounded-lg bg-muted motion-reduce:animate-none"
  />
);

/** Draws a spec that already passed `@zetta/render/reply`; no state or actions are wired, so it is display-only. */
export function UiView({ spec, streaming = false }: { spec: UiSpec; streaming?: boolean }) {
  return (
    <JSONUIProvider registry={registry}>
      <Renderer spec={spec} registry={registry} loading={streaming} />
    </JSONUIProvider>
  );
}
