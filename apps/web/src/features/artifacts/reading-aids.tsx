import { ListBulletsIcon } from "@phosphor-icons/react";
import { useEffect, useRef, type RefObject } from "react";
import { cn } from "@zetta/ui/lib/utils";

import { ActionHint } from "@/components/action-hint";
import { Button, Menu, MenuItem } from "@/components/ui";

import type { Artifact } from "./artifacts-api";
import type { Outline } from "./use-reading";
import { ArtifactViewer } from "./viewers";

/** A thin bar of how far down the document the reader is. Decorative: the "min read" text is what carries meaning. */
export function ReadingProgress({
  scroll,
  text,
}: {
  scroll: RefObject<HTMLElement | null>;
  text: string;
}) {
  const bar = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const root = scroll.current;
    if (!root) return;
    let frame = 0;
    // The width changes through `transform` straight on the node: no render and no layout for each scroll step.
    const paint = () => {
      frame = 0;
      const room = root.scrollHeight - root.clientHeight;
      const done = room > 0 ? Math.min(1, root.scrollTop / room) : 0;
      if (bar.current) bar.current.style.transform = `scaleX(${done})`;
    };
    const schedule = () => {
      frame ||= requestAnimationFrame(paint);
    };
    paint();
    root.addEventListener("scroll", schedule, { passive: true });
    const sizes = typeof ResizeObserver === "undefined" ? undefined : new ResizeObserver(schedule);
    sizes?.observe(root);
    if (root.firstElementChild) sizes?.observe(root.firstElementChild);
    return () => {
      root.removeEventListener("scroll", schedule);
      sizes?.disconnect();
      if (frame) cancelAnimationFrame(frame);
    };
  }, [scroll, text]);
  return (
    <div aria-hidden="true" data-reading-progress="" className="h-0.5 overflow-hidden">
      <div ref={bar} className="h-full origin-left bg-primary" style={{ transform: "scaleX(0)" }} />
    </div>
  );
}

export function ReadingTime({ minutes, className }: { minutes: number; className?: string }) {
  return (
    <span
      className={cn(
        "shrink-0 whitespace-nowrap text-xs tabular-nums text-muted-foreground",
        className,
      )}
    >
      {minutes} min read
    </span>
  );
}

/** One step of indent for each heading level under the highest one of the document. */
const INDENT = ["pl-2", "pl-5", "pl-8"] as const;
// "!": the library's menu item sets its own padding and background, which beat plain utilities.
const MENU_INDENT = ["!pl-3", "!pl-6", "!pl-9"] as const;
const depthOf = (outline: Outline, level: number) =>
  Math.min(2, level - Math.min(...outline.items.map((h) => h.level)));

/** The headings as a list beside the document. */
export function OutlineList({ outline }: { outline: Outline }) {
  return (
    <nav aria-label="Outline">
      <p className="label-mono mb-2 pl-2">Contents</p>
      <ul className="space-y-0.5">
        {outline.items.map((h) => (
          <li key={h.id}>
            <button
              type="button"
              aria-current={h.id === outline.active ? "location" : undefined}
              onClick={() => outline.jump(h.id)}
              className={cn(
                "w-full rounded-md py-1 pr-2 text-left text-xs leading-4 text-pretty text-muted-foreground hover:bg-muted hover:text-foreground focus-visible:outline-2 focus-visible:outline-ring aria-[current]:bg-muted aria-[current]:font-medium aria-[current]:text-foreground",
                INDENT[depthOf(outline, h.level)],
              )}
            >
              {h.text}
            </button>
          </li>
        ))}
      </ul>
    </nav>
  );
}

/** The same headings behind one button, for a view too narrow for the list. */
export function OutlineMenu({ outline, className }: { outline: Outline; className?: string }) {
  return (
    <Menu
      asChild
      hover={false}
      title=""
      floatingClassName="max-h-[60dvh] w-80 max-w-[calc(100vw-2rem)] overflow-x-hidden overflow-y-auto"
      label={
        <ActionHint label="Contents" side="bottom">
          <Button size="icon-sm" variant="ghost" aria-label="Contents" className={className}>
            <ListBulletsIcon />
          </Button>
        </ActionHint>
      }
    >
      {outline.items.map((h) => (
        <MenuItem
          key={h.id}
          title={h.text}
          className={cn(
            MENU_INDENT[depthOf(outline, h.level)],
            "!h-auto !whitespace-normal !py-1.5 text-left aria-[current]:!bg-muted aria-[current]:!font-medium",
          )}
          aria-current={h.id === outline.active ? "location" : undefined}
          onClick={() => outline.jump(h.id)}
        >
          <span className="min-w-0 text-pretty">{h.text}</span>
        </MenuItem>
      ))}
    </Menu>
  );
}

/**
 * The preview of an artifact with its outline beside it when there is room. The room is that of the nearest `@container/artifact`; the
 * caller shows an `OutlineMenu` below the same width.
 */
export function ReadingBody({ artifact, outline }: { artifact: Artifact; outline: Outline }) {
  return (
    <div className="flex items-start gap-8">
      <div className="min-w-0 flex-1">
        <ArtifactViewer a={artifact} />
      </div>
      {outline.items.length > 0 && (
        <aside className="sticky top-0 hidden max-h-[calc(100dvh-12rem)] w-52 shrink-0 overflow-y-auto @min-[60rem]/artifact:block">
          <OutlineList outline={outline} />
        </aside>
      )}
    </div>
  );
}
