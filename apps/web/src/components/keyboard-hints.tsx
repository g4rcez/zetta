import {
  computePosition,
  detectOverflow,
  offset,
  shift,
  type Middleware,
  type Placement,
} from "@floating-ui/dom";
import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type ReactElement,
} from "react";
import { cn } from "@zetta/ui/lib/utils";

const CLICKABLE_SELECTOR = [
  "a",
  "button",
  "input:not([type='hidden'])",
  "select",
  "textarea",
  "summary",
  "[role='button']",
  "[role='link']",
  "[onclick]",
].join(",");
const LETTERS = "ABCDEFGHIJKLMNOPQRSTUVWXYZ";
const MAX_HINT_COUNT = LETTERS.length * LETTERS.length;
const EDGE_PADDING = 4;
// Fixed label box, so the placement can be computed before the label is rendered.
const LABEL_WIDTH = 28;
const LABEL_HEIGHT = 20;
const LABEL_GAP = 4;

const SIDES: Placement[] = ["left-start", "right-start", "top-start", "bottom-start"];
const CORNERS: Placement[] = ["top-start", "bottom-start"];

export type Box = { left: number; top: number; right: number; bottom: number };
export type Spot = { left: number; top: number; fits: boolean };
type Hint = { code: string; element: HTMLElement; left: number; top: number };

/** `AA` … `ZZ` in DOM order; `null` past 676 elements. */
export function hintCode(index: number): string | null {
  if (!Number.isInteger(index) || index < 0 || index >= MAX_HINT_COUNT) return null;
  return `${LETTERS.charAt(Math.floor(index / LETTERS.length))}${LETTERS.charAt(index % LETTERS.length)}`;
}

/**
 * Alt/Option + Shift + /. On macOS Option+Shift+/ types "¿", so the physical key (`code`) is checked first.
 * `IntlRo` is the ABNT2 key that types "/" and "?".
 */
export function isHintsShortcut(
  event: Pick<KeyboardEvent, "altKey" | "shiftKey" | "metaKey" | "ctrlKey" | "key" | "code">,
): boolean {
  if (!event.altKey || !event.shiftKey || event.metaKey || event.ctrlKey) return false;
  return (
    event.code === "Slash" || event.code === "IntlRo" || event.key === "/" || event.key === "?"
  );
}

function isDisabled(element: HTMLElement): boolean {
  return (
    (element instanceof HTMLButtonElement ||
      element instanceof HTMLInputElement ||
      element instanceof HTMLSelectElement ||
      element instanceof HTMLTextAreaElement) &&
    element.disabled
  );
}

function isUsable(element: HTMLElement): boolean {
  if (element.closest("[data-keyboard-hints-overlay]")) return false;
  if (element.closest("[hidden],[inert],[aria-hidden='true']")) return false;
  if (isDisabled(element) || element.getAttribute("aria-disabled") === "true") return false;
  const style = window.getComputedStyle(element);
  if (style.display === "none" || style.visibility === "hidden" || style.pointerEvents === "none")
    return false;
  const rect = element.getBoundingClientRect();
  return (
    rect.width > 0 &&
    rect.height > 0 &&
    rect.bottom >= 0 &&
    rect.right >= 0 &&
    rect.top <= window.innerHeight &&
    rect.left <= window.innerWidth
  );
}

const overlaps = (a: Box, b: Box) =>
  a.left < b.right && a.right > b.left && a.top < b.bottom && a.bottom > b.top;
const boxOf = (spot: Spot): Box => ({
  left: spot.left,
  top: spot.top,
  right: spot.left + LABEL_WIDTH,
  bottom: spot.top + LABEL_HEIGHT,
});

/** First spot that lies inside the viewport and covers none of the `avoid` boxes. */
export function findFreeSpot(spots: Spot[], avoid: Box[]): Spot | undefined {
  return spots.find((spot) => spot.fits && !avoid.some((other) => overlaps(boxOf(spot), other)));
}

// Floating UI reports how far the label sticks out of the viewport and of the scroll containers around the element.
const fitsViewport: Middleware = {
  name: "fitsViewport",
  async fn(state) {
    const overflow = await detectOverflow(state, { padding: EDGE_PADDING });
    return {
      data: {
        fits:
          overflow.top <= 0 && overflow.right <= 0 && overflow.bottom <= 0 && overflow.left <= 0,
      },
    };
  },
};

async function spotFor(
  element: HTMLElement,
  probe: HTMLElement,
  placement: Placement,
  straddle: boolean,
): Promise<Spot> {
  const { x, y, middlewareData } = await computePosition(element, probe, {
    placement,
    strategy: "fixed",
    middleware: [
      // Beside the element, centered on its first 16px. `straddle` pulls the label half way over the element's corner.
      offset(({ placement: current, rects }) =>
        straddle
          ? { mainAxis: -rects.floating.height / 2 }
          : current.startsWith("left") || current.startsWith("right")
            ? {
                mainAxis: LABEL_GAP,
                alignmentAxis: Math.min(rects.reference.height / 2, 16) - rects.floating.height / 2,
              }
            : { mainAxis: LABEL_GAP },
      ),
      shift({ padding: EDGE_PADDING }),
      fitsViewport,
    ],
  });
  return { left: x, top: y, fits: middlewareData.fitsViewport?.fits === true };
}

/** Same size as a label, so Floating UI measures the real box. Never clickable, never visible. */
function createProbe(): HTMLElement {
  const probe = document.createElement("div");
  probe.setAttribute("data-keyboard-hints-overlay", "");
  Object.assign(probe.style, {
    position: "fixed",
    left: "0",
    top: "0",
    width: `${LABEL_WIDTH}px`,
    height: `${LABEL_HEIGHT}px`,
    visibility: "hidden",
    pointerEvents: "none",
  });
  document.body.append(probe);
  return probe;
}

/**
 * Beside the element first (left, right, above, below), where no other label or clickable element is. When every side is
 * taken, the label straddles the top or bottom corner, so it covers padding and not text. The last resort is any spot.
 */
async function collectHints(): Promise<Hint[]> {
  const elements = Array.from(document.querySelectorAll(CLICKABLE_SELECTOR)).filter(
    (node): node is HTMLElement => node instanceof HTMLElement && isUsable(node),
  );
  const rects = elements.map((element) => element.getBoundingClientRect());
  const probe = createProbe();
  const placed: Box[] = [];
  const hints: Hint[] = [];
  try {
    for (const [index, element] of elements.entries()) {
      const code = hintCode(index);
      if (!code) break;
      const obstacles = rects.filter((_, other) => other !== index);
      const sides = await Promise.all(SIDES.map((side) => spotFor(element, probe, side, false)));
      let spot = findFreeSpot(sides, [...placed, ...obstacles]);
      if (!spot) {
        const corners = await Promise.all(
          CORNERS.map((corner) => spotFor(element, probe, corner, true)),
        );
        spot =
          findFreeSpot(corners, placed) ??
          findFreeSpot(sides, placed) ??
          [...sides, ...corners].find((s) => s.fits) ??
          sides[0];
      }
      placed.push(boxOf(spot));
      hints.push({ code, element, left: spot.left, top: spot.top });
    }
  } finally {
    probe.remove();
  }
  return hints;
}

function letterOf(event: KeyboardEvent): string | null {
  if (event.key.length !== 1) return null;
  const key = event.key.toUpperCase();
  return LETTERS.includes(key) ? key : null;
}

/**
 * Keyboard-only mode: Alt+Shift+/ labels every visible clickable element with a two-letter code (AA…ZZ).
 * The second letter focuses and clicks the element. Esc closes, Backspace erases the first letter.
 */
export function KeyboardHints(): ReactElement | null {
  const [open, setOpen] = useState(false);
  const [typed, setTyped] = useState("");
  const [hints, setHints] = useState<Hint[]>([]);

  const latest = useRef(0);

  const close = useCallback(() => {
    setOpen(false);
    setTyped("");
  }, []);

  // Positions are async: only the newest run may write, so a slow older run never replaces fresher labels.
  const refresh = useCallback(async () => {
    const run = ++latest.current;
    const next = await collectHints();
    if (run === latest.current) setHints(next);
  }, []);

  useLayoutEffect(() => {
    if (open) return void refresh();
    latest.current++;
    setHints([]);
  }, [open, refresh]);

  // Labels follow their element while the page resizes or scrolls; a pointer press means the user left the keyboard.
  useEffect(() => {
    if (!open) return;
    const controller = new AbortController();
    const { signal } = controller;
    let frame = 0;
    const schedule = () => {
      if (frame) cancelAnimationFrame(frame);
      frame = requestAnimationFrame(() => void refresh());
    };
    window.addEventListener("resize", schedule, { signal });
    document.addEventListener("scroll", schedule, { capture: true, signal });
    document.addEventListener("pointerdown", close, { capture: true, signal });
    return () => {
      if (frame) cancelAnimationFrame(frame);
      controller.abort();
    };
  }, [open, close, refresh]);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (isHintsShortcut(event)) {
        event.preventDefault();
        event.stopPropagation();
        setTyped("");
        setOpen((current) => !current);
        return;
      }
      if (!open || event.metaKey || event.ctrlKey || event.altKey) return;
      // Capture phase: no key reaches the page (for example the chat composer) while the labels are visible.
      event.preventDefault();
      event.stopPropagation();
      if (event.key === "Escape") return close();
      if (event.key === "Backspace") return setTyped((current) => current.slice(0, -1));
      const letter = letterOf(event);
      if (!letter) return;
      if (typed.length === 0) return setTyped(letter);
      const hint = hints.find((current) => current.code === typed + letter);
      if (!hint) return setTyped("");
      close();
      // After the overlay unmounts, so a focus trap or `aria-hidden` of the overlay cannot swallow the click.
      window.setTimeout(() => {
        hint.element.focus();
        hint.element.click();
      }, 0);
    };
    window.addEventListener("keydown", onKeyDown, { capture: true });
    return () => window.removeEventListener("keydown", onKeyDown, { capture: true });
  }, [close, hints, open, typed]);

  if (!open) return null;

  return (
    <div
      aria-hidden="true"
      data-keyboard-hints-overlay
      className="pointer-events-none fixed inset-0 z-[2147483647] print:hidden"
    >
      {hints.map((hint) => (
        <span
          key={hint.code}
          style={{ left: hint.left, top: hint.top, width: LABEL_WIDTH, height: LABEL_HEIGHT }}
          className={cn(
            "fixed flex items-center justify-center rounded-md border border-border bg-popover font-mono text-xs leading-none text-popover-foreground shadow-sm",
            typed !== "" && hint.code.startsWith(typed) && "border-primary ring-2 ring-primary/60",
          )}
        >
          {hint.code}
        </span>
      ))}
    </div>
  );
}
