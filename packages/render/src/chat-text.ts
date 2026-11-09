import { toCard } from "@json-render/chat";
import type { Spec } from "@json-render/core";
import { cardChildToFallbackText, type CardChild, type CardElement } from "chat";

import { splitReply, UI_FENCE, type UiSpec } from "./reply";

/**
 * Turns `zetta:ui` blocks into plain text for channels that cannot draw them (WhatsApp, Telegram).
 * Our catalog maps onto the standard `@json-render/chat` vocabulary, `toCard` validates it, and the Chat SDK's own fallback
 * text prints the tables and charts. Any adapter that takes a Chat SDK card can reuse `toChatSpec` + `toCard` as they are.
 */

export type TextOptions = {
  /** Use the channel's text marks: `*bold*` titles and monospace fences around tables, charts and code. Off for plain-text channels. */
  marks?: boolean;
};

type Out = { type: string; props: Record<string, unknown>; children: string[] };
type Props = Record<string, any>;

const TREND = { up: "↑", down: "↓", flat: "→" } as const;
const ALERT_ICON = { info: "ℹ️", success: "✅", warning: "⚠️", danger: "❌" } as const;
const FENCE = "```";
/** A fence inside a cell or a line of code would close ours early. */
const safe = (s: string) => s.replaceAll(FENCE, "'''");
const bar = (percent: number) => {
  const filled = Math.round(Math.max(0, Math.min(100, percent)) / 10);
  return `${"▰".repeat(filled)}${"▱".repeat(10 - filled)} ${Math.round(percent)}%`;
};

/** Maps a spec that passed `reply.ts` onto the Chat SDK card vocabulary. The root is always a Card. */
export function toChatSpec(spec: UiSpec, { marks = false }: TextOptions = {}): Spec {
  const elements: Record<string, Out> = {};
  let n = 0;
  const add = (type: string, props: Props = {}, children: string[] = []) => {
    const key = `c${n++}`;
    elements[key] = { type, props, children };
    return key;
  };
  const text = (content: string, style?: "bold" | "muted") =>
    add("Text", { content, ...(style ? { style } : {}) });
  const fields = (items: [string, string][]) =>
    add(
      "Fields",
      {},
      items.map(([label, value]) => add("Field", { label, value })),
    );

  /** One of our elements becomes zero, one or several card elements. */
  const emit = (key: string): string[] => {
    const el = spec.elements[key];
    if (!el) return [];
    const p = el.props as Props;
    const kids = () => el.children.flatMap(emit);
    switch (el.type) {
      case "Card": {
        const children = kids();
        return [
          add(
            "Card",
            {
              ...(p.title ? { title: p.title } : {}),
              ...(p.description ? { subtitle: p.description } : {}),
            },
            children,
          ),
        ];
      }
      case "Stack":
        return [add("Section", {}, kids())];
      case "Heading":
        return [text(p.text, "bold")];
      case "Text":
        return [text(p.text, p.tone === "muted" ? "muted" : undefined)];
      case "Badge":
        return [text(p.label, "bold")];
      case "Metric": {
        const trend = p.trend ? ` ${TREND[p.trend as keyof typeof TREND]}` : "";
        return [
          fields([[p.label, `${p.value}${trend}`]]),
          ...(p.hint ? [text(p.hint, "muted")] : []),
        ];
      }
      case "KeyValue":
        return [
          fields((p.items as { label: string; value: string }[]).map((i) => [i.label, i.value])),
        ];
      case "Table": {
        const columns = p.columns as string[];
        return [
          add("Table", {
            headers: columns,
            rows: (p.rows as string[][]).map((r) => columns.map((_, i) => r[i] ?? "")),
          }),
        ];
      }
      case "List":
        return [
          text(
            (p.items as string[])
              .map((item, i) => `${p.ordered ? `${i + 1}.` : "•"} ${item}`)
              .join("\n"),
          ),
        ];
      case "Alert": {
        const icon = ALERT_ICON[(p.tone ?? "info") as keyof typeof ALERT_ICON];
        return p.title
          ? [text(`${icon} ${p.title}`, "bold"), text(p.message)]
          : [text(`${icon} ${p.message}`)];
      }
      case "Progress":
        return [fields([[p.label ?? "Progress", bar(p.value)]])];
      case "Chart":
        return [add("Chart", { title: p.title, chart: p.chart })];
      case "Code":
        return [text(marks ? `${FENCE}\n${safe(p.code)}\n${FENCE}` : p.code)];
      case "Link":
        return [add("Actions", {}, [add("LinkButton", { label: p.label, url: p.href })])];
      case "Divider":
        return [add("Divider")];
      default:
        return [];
    }
  };

  const root =
    spec.elements[spec.root]?.type === "Card"
      ? emit(spec.root)[0]!
      : add("Card", {}, emit(spec.root));
  return { root, elements } as unknown as Spec;
}

type Child = { type: string; [k: string]: any };

function childText(child: Child, marks: boolean): string {
  switch (child.type) {
    case "text":
      return marks && child.style === "bold" ? `*${child.content}*` : String(child.content);
    case "section":
      return (child.children as Child[])
        .map((c) => childText(c, marks))
        .filter(Boolean)
        .join("\n");
    // The SDK helper skips link buttons and dividers; a text channel still needs the address.
    case "actions":
      return (child.children as Child[])
        .map((b) => (b.type === "link-button" ? `${b.label}: ${b.url}` : String(b.label ?? "")))
        .join("\n");
    case "divider":
      return "———";
    case "table":
    case "chart": {
      const body = safe(cardChildToFallbackText(child as CardChild) ?? "");
      return marks && body ? `${FENCE}\n${body}\n${FENCE}` : body;
    }
    default:
      return cardChildToFallbackText(child as CardChild) ?? "";
  }
}

function cardText(card: CardElement, marks: boolean): string {
  const head = [card.title && (marks ? `*${card.title}*` : card.title), card.subtitle]
    .filter(Boolean)
    .join("\n");
  return [head, ...(card.children as Child[]).map((c) => childText(c, marks))]
    .filter(Boolean)
    .join("\n\n");
}

/** The text of one block, or "" when it does not pass the card checks (nothing half-drawn and never raw JSON). */
export function specToText(spec: UiSpec, { marks = false }: TextOptions = {}): string {
  try {
    return cardText(toCard(toChatSpec(spec, { marks })), marks);
  } catch {
    return "";
  }
}

const APP_LINK = /```zetta:app\.linkto\s*\n([\s\S]*?)```/g;
/** A `zetta:app.linkto` block becomes one line with the app's name and its path; a block that is not a slug is dropped. */
export function appLinksToText(content: string): string {
  if (!content.includes("zetta:app.linkto")) return content;
  return content.replace(APP_LINK, (_, body: string) => {
    try {
      const b = JSON.parse(body) as { app?: unknown; name?: unknown };
      if (typeof b.app !== "string" || !/^[a-z0-9][a-z0-9-]{0,63}$/.test(b.app)) return "";
      const name = typeof b.name === "string" && b.name.trim() ? b.name.trim().slice(0, 80) : b.app;
      return `📱 ${name}: /apps/${b.app}`;
    } catch {
      return "";
    }
  });
}

/**
 * A reply with every `zetta:ui` block turned into text; the markdown around it is kept as written. A block that does not
 * validate is dropped, so a phone never receives JSON patches.
 */
export function uiToText(rawContent: string, options: TextOptions = {}): string {
  const content = appLinksToText(rawContent);
  if (!content.includes("```" + UI_FENCE)) return content;
  return splitReply(content)
    .map((s) => (s.kind === "markdown" ? s.text : s.spec ? specToText(s.spec, options) : ""))
    .filter((s) => s.trim())
    .join("\n\n");
}
