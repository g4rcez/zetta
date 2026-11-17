import { QuotesIcon } from "@phosphor-icons/react";
import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";

import type { Row } from "./chat-rows";

/** The longest part of a message a quote carries (the server takes the same). */
export const QUOTE_EXCERPT = 500;

/**
 * A message the way a person reads it: Markdown links keep their label, the marks go, whitespace collapses. A selection is copied from
 * the page, which shows the rendered text, so both sides are flattened before they are compared. The server keeps the same rule
 * (`flatten` in `apps/server/src/modules/chat/messages.ts`).
 */
export const flatten = (text: string) =>
  text
    .replace(/\[([^\]]*)\]\([^)]*\)/g, "$1")
    .replace(/^\s*(?:[-+]|\d+[.)])\s+/gm, "")
    .replace(/[*_~`#>@|]/g, "")
    .replace(/\s+/g, " ")
    .trim();

/** True when the selected text is part of the message, so the server will accept it as the excerpt of a quote. */
export const selectionInContent = (content: string, selection: string) => {
  const needle = flatten(selection);
  return needle.length > 0 && flatten(content).includes(needle);
};

/** The row a page hands to its quote state: the message, with the part the person selected when there is one. */
export const quoteRow = (row: Row, selection?: string): Row =>
  selection ? { ...row, quoteSelection: selection.trim().slice(0, QUOTE_EXCERPT) } : row;

/** What a send carries for the message being quoted. */
export const quoteFields = (quoting: Row | undefined) =>
  quoting
    ? {
        quotedMessageId: quoting.id,
        ...(quoting.quoteSelection ? { quoteExcerpt: quoting.quoteSelection } : {}),
      }
    : {};

/** The chip above the composer: who is quoted and what of it. */
export const quoteChip = (quoting: Row, name: string, onCancel: () => void) => ({
  id: quoting.id,
  name,
  excerpt: quoting.quoteSelection ?? quoting.content,
  selection: quoting.quoteSelection !== undefined,
  onCancel,
});

const PREFIX = "message-";

/** The message element that holds a node, or nothing when the node is not inside one. */
const messageOf = (node: Node | null): HTMLElement | undefined => {
  const el = node instanceof Element ? node : node?.parentElement;
  const found = el?.closest(`[id^="${PREFIX}"]`);
  return found instanceof HTMLElement ? found : undefined;
};

type Chosen = { id: string; text: string; x: number; y: number };

/**
 * Select text inside a message and a small "Quote selection" button appears above it. The quote then carries the selection (up to 500
 * characters). One listener for the whole list; the button only shows for a selection inside one saved message of the list, and only
 * when that text is really in the message (a selection that crosses messages or the quote line above one is not offered).
 */
export function QuoteSelection({
  rows,
  onQuote,
}: {
  rows: readonly Row[];
  onQuote: (row: Row) => void;
}) {
  const [pick, setPick] = useState<Chosen>();
  const latest = useRef({ rows, onQuote });
  latest.current = { rows, onQuote };
  useEffect(() => {
    const read = () => {
      const selection = window.getSelection();
      if (!selection || selection.isCollapsed || selection.rangeCount === 0)
        return setPick(undefined);
      const range = selection.getRangeAt(0);
      const host = messageOf(range.commonAncestorContainer);
      const id = host?.id.slice(PREFIX.length);
      const row = id ? latest.current.rows.find((r) => r.id === id) : undefined;
      const text = selection.toString().trim();
      if (
        !row ||
        row.streaming ||
        row.role === "system" ||
        !text ||
        !selectionInContent(row.content, text)
      )
        return setPick(undefined);
      const box = range.getBoundingClientRect();
      setPick({
        id: row.id,
        text: text.slice(0, QUOTE_EXCERPT),
        x: box.left + box.width / 2,
        y: box.top,
      });
    };
    document.addEventListener("selectionchange", read);
    window.addEventListener("scroll", read, true);
    return () => {
      document.removeEventListener("selectionchange", read);
      window.removeEventListener("scroll", read, true);
    };
  }, []);
  if (!pick) return null;
  return createPortal(
    // No hint: the button has visible text.
    <button
      type="button"
      style={{ left: pick.x, top: Math.max(8, pick.y - 40) }}
      className="fixed z-50 flex -translate-x-1/2 items-center gap-1.5 rounded-lg border bg-popover px-2.5 py-1.5 text-xs font-medium text-popover-foreground shadow-md hover:bg-accent focus-visible:outline-2 focus-visible:outline-ring"
      // Pressing the button must not clear the selection before the click reads it.
      onMouseDown={(e) => e.preventDefault()}
      onClick={() => {
        const row = latest.current.rows.find((r) => r.id === pick.id);
        window.getSelection()?.removeAllRanges();
        setPick(undefined);
        if (row) latest.current.onQuote(quoteRow(row, pick.text));
      }}
    >
      <QuotesIcon aria-hidden="true" className="size-3.5" />
      Quote selection
    </button>,
    document.body,
  );
}
