/**
 * Vertical resizing of the scrolling blocks of a reply: a table and a code block. Streamdown caps each at a fixed height (300 and 400px) with
 * an inline `max-height`, which CSS `resize` cannot grow past, so the block carries a grip along its bottom edge (drawn in index.css,
 * `.chat-response … ::after`) and one handler on the document reads the drag. Dragging sets the block's `max-height`; a double click on
 * the grip toggles between Streamdown's height and the whole content. The fullscreen view stays the way to read a block without scrolling
 * when a pointer is not at hand.
 */

type Spec = {
  /** The block that carries the grip: the grip is its `::after`, so a press on it lands on the block itself. */
  box: string;
  /** The part of the block that scrolls, whose `max-height` is the one that changes. */
  scroll: (box: HTMLElement) => HTMLElement | undefined;
};

const SPECS: Spec[] = [
  {
    box: '[data-streamdown="table-wrapper"]',
    scroll: (box) =>
      Array.from(box.children).find(
        (c): c is HTMLElement => c instanceof HTMLElement && !!c.querySelector(":scope > table"),
      ),
  },
  {
    box: '[data-streamdown="code-block"]',
    scroll: (box) =>
      box.querySelector<HTMLElement>('[data-streamdown="code-block-body"]') ?? undefined,
  },
];

/** The height of the grip along the bottom edge of a block, in px: a press inside it starts a resize. */
export const GRIP_PX = 12;
/** A block never gets shorter than this, so it is still a block with something to read and a grip to grab. */
export const MIN_HEIGHT_PX = 96;

const FULLSCREEN = '[data-streamdown="table-fullscreen"]';

/** The block and its scrolling part when the event hit a grip, otherwise undefined. */
function gripAt(e: MouseEvent): { box: HTMLElement; scroll: HTMLElement } | undefined {
  const target = e.target;
  if (!(target instanceof HTMLElement)) return undefined;
  const spec = SPECS.find((s) => target.matches(s.box));
  // The fullscreen copy of a table is a page of its own: it has no cap to change.
  if (!spec || target.closest(FULLSCREEN)) return undefined;
  if (e.clientY < target.getBoundingClientRect().bottom - GRIP_PX) return undefined;
  const scroll = spec.scroll(target);
  return scroll ? { box: target, scroll } : undefined;
}

/** What the block was capped at before the person touched it, so a double click can give it back. */
const ORIGINAL = "resizableOriginal";

const remember = (scroll: HTMLElement) => {
  if (scroll.dataset[ORIGINAL] === undefined) scroll.dataset[ORIGINAL] = scroll.style.maxHeight;
};

/** Starts listening on a document. Returns the function that stops it. Installing twice on one document is a no-op. */
const installed = new WeakSet<Document>();
export function installResizableBlocks(doc: Document = document): () => void {
  if (installed.has(doc)) return () => {};
  installed.add(doc);

  const onDown = (e: PointerEvent) => {
    if (e.button !== 0 || e.pointerType === "touch") return;
    const grip = gripAt(e);
    if (!grip) return;
    e.preventDefault();
    const { scroll } = grip;
    remember(scroll);
    const startY = e.clientY;
    const startHeight = scroll.getBoundingClientRect().height;
    const body = doc.body;
    const selection = body.style.userSelect;
    body.style.userSelect = "none";
    const move = (ev: PointerEvent) => {
      const next = Math.max(MIN_HEIGHT_PX, Math.round(startHeight + ev.clientY - startY));
      scroll.style.maxHeight = `${next}px`;
    };
    const end = () => {
      body.style.userSelect = selection;
      doc.removeEventListener("pointermove", move);
      doc.removeEventListener("pointerup", end);
      doc.removeEventListener("pointercancel", end);
    };
    doc.addEventListener("pointermove", move);
    doc.addEventListener("pointerup", end);
    doc.addEventListener("pointercancel", end);
  };

  const onDouble = (e: MouseEvent) => {
    const grip = gripAt(e);
    if (!grip) return;
    e.preventDefault();
    const { scroll } = grip;
    remember(scroll);
    const original = scroll.dataset[ORIGINAL] ?? "";
    // First the whole content; the next double click gives Streamdown's height back.
    scroll.style.maxHeight = scroll.style.maxHeight === "none" ? original : "none";
  };

  doc.addEventListener("pointerdown", onDown);
  doc.addEventListener("dblclick", onDouble);
  return () => {
    doc.removeEventListener("pointerdown", onDown);
    doc.removeEventListener("dblclick", onDouble);
    installed.delete(doc);
  };
}

if (typeof document !== "undefined") installResizableBlocks();
