import { useCallback, useEffect, useState, type RefObject } from "react";

import type { Artifact } from "./artifacts-api";
import { activeIndex, headingIds, MIN_OUTLINE, readingMinutes, type Heading } from "./reading";
import { useReadableText } from "./viewers";

const HEADINGS = [1, 2, 3].map((n) => `.reading [data-streamdown="heading-${n}"]`).join(",");
/** A heading counts as reached this far under the top of the scrolled view. */
const LINE = 96;
/** The air left above a heading after a jump. */
const JUMP_GAP = 16;

const sameHeadings = (a: Heading[], b: Heading[]) =>
  a.length === b.length &&
  a.every((h, i) => h.id === b[i]!.id && h.text === b[i]!.text && h.level === b[i]!.level);

/**
 * The headings of the document drawn inside `scroll`, which one the reader is under, and a jump to one. It reads the rendered headings
 * (and gives them ids), so it follows whatever the Markdown renderer drew.
 */
export function useOutline(scroll: RefObject<HTMLElement | null>, text: string | undefined) {
  const [items, setItems] = useState<Heading[]>([]);
  const [active, setActive] = useState<string>();

  useEffect(() => {
    const root = scroll.current;
    if (!root || text === undefined) {
      setItems([]);
      return;
    }
    let elements: HTMLElement[] = [];
    let frame = 0;
    const track = () => {
      frame = 0;
      if (!elements.length) return setActive(undefined);
      const line = root.getBoundingClientRect().top + LINE;
      const atEnd =
        root.scrollTop > 0 && root.scrollTop + root.clientHeight >= root.scrollHeight - 2;
      const tops = elements.map((el) => el.getBoundingClientRect().top - line);
      setActive(elements[activeIndex(tops, atEnd)]?.id);
    };
    const scan = () => {
      elements = [...root.querySelectorAll<HTMLElement>(HEADINGS)];
      const titles = elements.map((el) => el.textContent?.trim() ?? "");
      const ids = headingIds(titles);
      const next = elements.map((el, i) => {
        el.id = ids[i]!;
        // A jump moves the focus there too, so the keyboard and a screen reader follow.
        el.tabIndex = -1;
        return {
          id: ids[i]!,
          text: titles[i]!,
          level: Number(el.dataset.streamdown?.slice(-1) ?? 1),
        };
      });
      setItems((before) => (sameHeadings(before, next) ? before : next));
      track();
    };
    const onScroll = () => {
      frame ||= requestAnimationFrame(track);
    };
    scan();
    // The viewer draws the document after its download, and parts of it (code, diagrams) later still.
    const observer = new MutationObserver(scan);
    observer.observe(root, { childList: true, subtree: true, characterData: true });
    root.addEventListener("scroll", onScroll, { passive: true });
    return () => {
      observer.disconnect();
      root.removeEventListener("scroll", onScroll);
      if (frame) cancelAnimationFrame(frame);
    };
  }, [scroll, text]);

  const jump = useCallback(
    (id: string) => {
      const root = scroll.current;
      const heading = root?.querySelector<HTMLElement>(`[id="${id}"]`);
      if (!root || !heading) return;
      const reduce = window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;
      heading.focus({ preventScroll: true });
      // Scroll the document only: `scrollIntoView` would also move the frames around it.
      root.scrollTo({
        top:
          root.scrollTop +
          heading.getBoundingClientRect().top -
          root.getBoundingClientRect().top -
          JUMP_GAP,
        behavior: reduce ? "auto" : "smooth",
      });
    },
    [scroll],
  );

  return { items: items.length >= MIN_OUTLINE ? items : NO_HEADINGS, active, jump };
}
const NO_HEADINGS: Heading[] = [];

export type Outline = ReturnType<typeof useOutline>;

/** Everything the reading aids of one artifact need. `text` is `undefined` for a file that is not a document. */
export function useReading(
  artifact: Artifact | null | undefined,
  scroll: RefObject<HTMLElement | null>,
) {
  const text = useReadableText(artifact);
  const outline = useOutline(scroll, text);
  return { text, minutes: text === undefined ? undefined : readingMinutes(text), outline };
}
