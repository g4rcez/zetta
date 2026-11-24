import { ImageIcon } from "@phosphor-icons/react";
import { useEffect, useRef, useState, useSyncExternalStore } from "react";

import { Button } from "@/components/ui";
import type { ImageMode, Message } from "./mail-api";
import {
  buildFrameDocument,
  FRAME_SANDBOX,
  linkify,
  PAPER,
  paletteFor,
  readAppPalette,
  type FramePalette,
  type TextPart,
} from "./mail-frame";

const SERVER_PALETTE: FramePalette = PAPER;

/** The app's colours, read again whenever the theme changes (the class, `data-theme` or the main colour on the root element). */
function subscribeTheme(notify: () => void) {
  if (typeof MutationObserver === "undefined") return () => {};
  const watch = new MutationObserver(notify);
  watch.observe(document.documentElement, {
    attributes: true,
    attributeFilter: ["class", "data-theme", "style"],
  });
  return () => watch.disconnect();
}
let lastKey = "";
let last: FramePalette = SERVER_PALETTE;
function snapshotTheme(): FramePalette {
  const now = readAppPalette();
  const key = `${now.scheme}|${now.foreground}|${now.background}|${now.link}`;
  if (key !== lastKey) {
    lastKey = key;
    last = now;
  }
  return last;
}
/** A hook for the app's palette: stable between changes, so the frame is rebuilt only when the theme really changed. */
export function useAppPalette(): FramePalette {
  return useSyncExternalStore(subscribeTheme, snapshotTheme, () => SERVER_PALETTE);
}

/** The words of a plain-text message with line breaks kept and `http(s)` addresses as links that open in a new tab. */
function TextParts({ parts }: { parts: TextPart[] }) {
  return (
    <>
      {parts.map((p, i) =>
        p.kind === "link" ? (
          <a
            key={i}
            href={p.href}
            target="_blank"
            rel="noopener noreferrer nofollow"
            className="text-primary underline underline-offset-2"
          >
            {p.text}
          </a>
        ) : (
          <span key={i}>{p.text}</span>
        ),
      )}
    </>
  );
}

export function PlainText({ text }: { text: string }) {
  return (
    <p className="text-sm break-words whitespace-pre-wrap [overflow-wrap:anywhere]">
      <TextParts parts={linkify(text)} />
    </p>
  );
}

const EXTRA_SCROLLBAR = 16;

/**
 * One message's HTML in a sandboxed frame (see `FRAME_SANDBOX` for every token). The frame is as tall as its content: the page watches
 * the frame's own document, so no script runs inside it.
 */
export function HtmlFrame({
  html,
  images,
  title,
}: {
  html: string;
  images: ImageMode;
  title: string;
}) {
  const app = useAppPalette();
  const palette = paletteFor(html, app);
  const srcDoc = buildFrameDocument({ html, images, palette });
  const frame = useRef<HTMLIFrameElement>(null);
  const watch = useRef<ResizeObserver>(undefined);
  const [height, setHeight] = useState(96);

  function attach() {
    const el = frame.current;
    const doc = el?.contentDocument;
    if (!el || !doc?.documentElement) return;
    watch.current?.disconnect();
    const measure = () => {
      const root = doc.documentElement;
      // With the frame squeezed to nothing for one synchronous read, `scrollHeight` is the whole extent of the content, including a margin
      // or a line box that reaches past the root box. The height is put back before anything is painted.
      const kept = el.style.height;
      el.style.height = "0px";
      const content = root.scrollHeight;
      // A page wider than the frame gets a scrollbar of its own.
      const wide = root.scrollWidth > root.clientWidth;
      el.style.height = kept;
      setHeight(content + (wide ? EXTRA_SCROLLBAR : 0));
    };
    measure();
    if (typeof ResizeObserver === "undefined") return;
    watch.current = new ResizeObserver(measure);
    watch.current.observe(doc.documentElement);
    watch.current.observe(el);
  }
  // A frame that finished loading before the handler was attached, and the cleanup of the observer.
  useEffect(() => {
    if (frame.current?.contentDocument?.readyState === "complete") attach();
    return () => watch.current?.disconnect();
  }, [srcDoc]);

  return (
    // The border is on a wrapper: a border on the frame itself would take two pixels of its height and bring back a scrollbar.
    <div className="overflow-hidden rounded-md border border-border">
      <iframe
        ref={frame}
        title={title}
        sandbox={FRAME_SANDBOX}
        referrerPolicy="no-referrer"
        srcDoc={srcDoc}
        onLoad={attach}
        style={{ height }}
        className="block w-full border-0"
      />
    </div>
  );
}

/** Says remote images were left out, and lets the person load them for this conversation only. */
export function ImagesBar({ onLoad, loading }: { onLoad: () => void; loading: boolean }) {
  return (
    <div
      role="note"
      className="flex flex-wrap items-center gap-x-3 gap-y-2 rounded-md bg-muted px-3 py-2 text-sm"
    >
      <ImageIcon aria-hidden="true" className="size-4 shrink-0 text-muted-foreground" />
      <p className="min-w-0 flex-1 text-pretty">
        Images from other sites were not loaded. Loading them tells the sender this mail was opened.
      </p>
      <Button type="button" size="sm" variant="outline" disabled={loading} onClick={onLoad}>
        {loading ? "Loading…" : "Load images"}
      </Button>
    </div>
  );
}

/** A message's body: its HTML in the frame, or its text. A message that was too long for HTML shows its text with a note. */
export function MessageBody({ message, images }: { message: Message; images: ImageMode }) {
  const title = `Message from ${message.from?.name || message.from?.address || "an unknown sender"}`;
  if (message.source === "unreadable")
    return <p className="text-sm text-muted-foreground">This message could not be read.</p>;
  const tooLarge = message.htmlSize === "too_large";
  return (
    <div className="space-y-2">
      {message.source === "truncated" && (
        <p className="text-xs text-muted-foreground">
          This message is very long, so only the first part is shown.
        </p>
      )}
      {message.html && !tooLarge ? (
        <HtmlFrame html={message.html} images={images} title={title} />
      ) : (
        <>
          {tooLarge && (
            <p className="text-xs text-muted-foreground">
              The formatted version is too large to show. This is its text.
            </p>
          )}
          {message.text.trim() ? (
            <PlainText text={message.text} />
          ) : (
            <p className="text-sm text-muted-foreground">This message has no text.</p>
          )}
        </>
      )}
    </div>
  );
}
