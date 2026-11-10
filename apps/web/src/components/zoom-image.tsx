import { ActionHint } from "@/components/action-hint";
import {
  CaretLeftIcon,
  CaretRightIcon,
  DownloadSimpleIcon,
  MagnifyingGlassMinusIcon,
  MagnifyingGlassPlusIcon,
  XIcon,
} from "@phosphor-icons/react";
import { Skeleton } from "@g4rcez/components";
import { cn } from "@zetta/ui/lib/utils";
import {
  useEffect,
  useRef,
  useState,
  type ComponentProps,
  type KeyboardEvent,
  type MouseEvent,
  type PointerEvent,
} from "react";

const MIN_SCALE = 1;
const MAX_SCALE = 8;
/** A double click or double tap jumps to this scale; another one goes back to fit. */
const DOUBLE_TAP_SCALE = 2.5;
const BUTTON_STEP = 1.5;

type View = { scale: number; x: number; y: number };
const FIT: View = { scale: 1, x: 0, y: 0 };

const clamp = (n: number, min: number, max: number) => Math.min(max, Math.max(min, n));

/** Zooms around a point given in pixels from the centre of the stage, so the spot under the cursor stays under it. */
export function zoomAt(view: View, next: number, px: number, py: number): View {
  const scale = clamp(next, MIN_SCALE, MAX_SCALE);
  if (scale === MIN_SCALE) return FIT;
  const k = scale / view.scale;
  return { scale, x: px - (px - view.x) * k, y: py - (py - view.y) * k };
}

type Point = { x: number; y: number };

/**
 * Fullscreen viewer for one image, in a native dialog. The wheel, a pinch, the + and - keys or the buttons zoom (up to 8x),
 * dragging moves a zoomed picture, a double click toggles 2.5x, `0` goes back to fit and Escape closes it.
 * It holds no source of its own: the parent passes `src` (and `onStep` for a set of pictures), so a live picture keeps updating.
 */
export function ImageLightbox({
  name,
  src,
  onClose,
  index = 0,
  count = 1,
  onStep,
}: {
  name: string;
  /** `undefined` while loading, `null` when the picture is gone. */
  src: string | null | undefined;
  onClose: () => void;
  index?: number;
  count?: number;
  onStep?: (direction: 1 | -1) => void;
}) {
  const dialog = useRef<HTMLDialogElement>(null);
  const stage = useRef<HTMLDivElement>(null);
  const [view, setView] = useState<View>(FIT);
  const [dragging, setDragging] = useState(false);
  const pointers = useRef(new Map<number, Point>());
  const pinch = useRef<number>(undefined);
  const moved = useRef(false);
  const picture = useRef<HTMLImageElement>(null);

  useEffect(() => {
    const d = dialog.current;
    if (d && !d.open) d.showModal();
  }, []);
  // Another picture of the set starts fitted. A live picture changes `src` on every frame and keeps its zoom.
  useEffect(() => setView(FIT), [index, name]);

  const centre = (clientX: number, clientY: number): Point => {
    const r = stage.current?.getBoundingClientRect();
    return r
      ? { x: clientX - (r.left + r.width / 2), y: clientY - (r.top + r.height / 2) }
      : { x: 0, y: 0 };
  };

  // React registers `wheel` as a passive listener, so the page-scroll block has to be a native one.
  useEffect(() => {
    const el = stage.current;
    if (!el) return;
    const onWheel = (e: WheelEvent) => {
      e.preventDefault();
      const p = centre(e.clientX, e.clientY);
      const factor = Math.exp(-e.deltaY * (e.ctrlKey ? 0.01 : 0.0025));
      setView((v) => zoomAt(v, v.scale * factor, p.x, p.y));
    };
    el.addEventListener("wheel", onWheel, { passive: false });
    return () => el.removeEventListener("wheel", onWheel);
  }, []);

  const zoomBy = (factor: number) => setView((v) => zoomAt(v, v.scale * factor, 0, 0));

  const down = (e: PointerEvent<HTMLDivElement>) => {
    e.currentTarget.setPointerCapture(e.pointerId);
    pointers.current.set(e.pointerId, { x: e.clientX, y: e.clientY });
    moved.current = false;
    if (pointers.current.size === 2) {
      const [a, b] = [...pointers.current.values()] as [Point, Point];
      pinch.current = Math.hypot(a.x - b.x, a.y - b.y);
    }
    setDragging(true);
  };
  const move = (e: PointerEvent<HTMLDivElement>) => {
    const last = pointers.current.get(e.pointerId);
    if (!last) return;
    const now = { x: e.clientX, y: e.clientY };
    pointers.current.set(e.pointerId, now);
    if (pointers.current.size === 2 && pinch.current) {
      const [a, b] = [...pointers.current.values()] as [Point, Point];
      const gap = Math.hypot(a.x - b.x, a.y - b.y);
      const p = centre((a.x + b.x) / 2, (a.y + b.y) / 2);
      const ratio = gap / pinch.current;
      pinch.current = gap;
      moved.current = true;
      setView((v) => zoomAt(v, v.scale * ratio, p.x, p.y));
      return;
    }
    const dx = now.x - last.x,
      dy = now.y - last.y;
    if (Math.abs(dx) + Math.abs(dy) > 0) moved.current = true;
    setView((v) => (v.scale === MIN_SCALE ? v : { ...v, x: v.x + dx, y: v.y + dy }));
  };
  const up = (e: PointerEvent<HTMLDivElement>) => {
    pointers.current.delete(e.pointerId);
    if (pointers.current.size < 2) pinch.current = undefined;
    if (pointers.current.size === 0) setDragging(false);
  };
  /** A click beside the picture (not the end of a drag) closes the viewer, as a click outside a dialog does. */
  const click = (e: MouseEvent<HTMLDivElement>) => {
    const r = picture.current?.getBoundingClientRect();
    const outside =
      !r || e.clientX < r.left || e.clientX > r.right || e.clientY < r.top || e.clientY > r.bottom;
    if (outside && !moved.current) dialog.current?.close();
  };
  const doubleClick = (e: MouseEvent<HTMLDivElement>) => {
    const p = centre(e.clientX, e.clientY);
    setView((v) => (v.scale > MIN_SCALE ? FIT : zoomAt(v, DOUBLE_TAP_SCALE, p.x, p.y)));
  };

  const keys = (e: KeyboardEvent<HTMLDialogElement>) => {
    if (e.key === "+" || e.key === "=") zoomBy(BUTTON_STEP);
    else if (e.key === "-" || e.key === "_") zoomBy(1 / BUTTON_STEP);
    else if (e.key === "0") setView(FIT);
    else if (count > 1 && onStep && (e.key === "ArrowRight" || e.key === "ArrowLeft")) {
      e.preventDefault();
      onStep(e.key === "ArrowRight" ? 1 : -1);
    } else return;
    if (e.key !== "ArrowRight" && e.key !== "ArrowLeft") e.preventDefault();
  };

  const percent = Math.round(view.scale * 100);
  return (
    <dialog
      ref={dialog}
      aria-label={name}
      onClose={onClose}
      onKeyDown={keys}
      className="fixed inset-0 m-0 h-dvh max-h-none w-dvw max-w-none overflow-hidden border-0 bg-black/90 p-0 text-white backdrop:bg-black"
    >
      <div
        ref={stage}
        onPointerDown={down}
        onPointerMove={move}
        onPointerUp={up}
        onPointerCancel={up}
        onClick={click}
        onDoubleClick={doubleClick}
        style={{ touchAction: "none" }}
        className={cn(
          "absolute inset-0 flex select-none items-center justify-center overflow-hidden",
          view.scale > MIN_SCALE
            ? dragging
              ? "cursor-grabbing"
              : "cursor-grab"
            : "cursor-default",
        )}
      >
        {src ? (
          <img
            ref={picture}
            src={src}
            alt={name}
            draggable={false}
            style={{
              transform: `translate(${view.x}px, ${view.y}px) scale(${view.scale})`,
              transition: dragging ? "none" : "transform 120ms ease-out",
            }}
            className="max-h-full max-w-full object-contain will-change-transform motion-reduce:transition-none"
          />
        ) : src === null ? (
          <span className="text-sm text-white/70">Image unavailable</span>
        ) : (
          <Skeleton as="div" decorative className="size-64!" />
        )}
      </div>
      <div className="pointer-events-none absolute inset-x-0 top-0 flex items-center gap-1 bg-gradient-to-b from-black/70 to-transparent px-4 py-3 text-sm">
        <span className="min-w-0 flex-1 truncate font-medium">{name}</span>
        {count > 1 && (
          <span className="mr-2 text-xs text-white/70">
            {index + 1} / {count}
          </span>
        )}
        <div className="pointer-events-auto flex items-center gap-0.5">
          <ActionHint label="Zoom out" side="bottom">
            <button
              type="button"
              aria-label="Zoom out"
              disabled={view.scale <= MIN_SCALE}
              onClick={() => zoomBy(1 / BUTTON_STEP)}
              className="rounded p-1.5 hover:bg-white/15 disabled:opacity-40"
            >
              <MagnifyingGlassMinusIcon className="size-5" />
            </button>
          </ActionHint>
          {/* No hint: visible text, the current zoom level. */}
          <button
            type="button"
            aria-label="Fit to screen"
            onClick={() => setView(FIT)}
            className="min-w-12 rounded px-1.5 py-1 text-xs tabular-nums hover:bg-white/15"
          >
            {percent}%
          </button>
          <ActionHint label="Zoom in" side="bottom">
            <button
              type="button"
              aria-label="Zoom in"
              disabled={view.scale >= MAX_SCALE}
              onClick={() => zoomBy(BUTTON_STEP)}
              className="rounded p-1.5 hover:bg-white/15 disabled:opacity-40"
            >
              <MagnifyingGlassPlusIcon className="size-5" />
            </button>
          </ActionHint>
          {src && (
            <ActionHint label="Download" side="bottom">
              <a
                href={src}
                download={name}
                aria-label="Download"
                className="ml-1 rounded p-1.5 hover:bg-white/15"
              >
                <DownloadSimpleIcon className="size-5" />
              </a>
            </ActionHint>
          )}
          <ActionHint label="Close" side="bottom">
            <button
              type="button"
              aria-label="Close"
              onClick={() => dialog.current?.close()}
              className="rounded p-1.5 hover:bg-white/15"
            >
              <XIcon className="size-5" />
            </button>
          </ActionHint>
        </div>
      </div>
      {count > 1 && onStep && (
        <>
          <ActionHint label="Previous image">
            <button
              type="button"
              aria-label="Previous image"
              onClick={() => onStep(-1)}
              className="absolute left-3 top-1/2 -translate-y-1/2 rounded-full bg-black/50 p-2 hover:bg-black/70"
            >
              <CaretLeftIcon className="size-5" />
            </button>
          </ActionHint>
          <ActionHint label="Next image">
            <button
              type="button"
              aria-label="Next image"
              onClick={() => onStep(1)}
              className="absolute right-3 top-1/2 -translate-y-1/2 rounded-full bg-black/50 p-2 hover:bg-black/70"
            >
              <CaretRightIcon className="size-5" />
            </button>
          </ActionHint>
        </>
      )}
    </dialog>
  );
}

/**
 * The app's `<img>` for any picture a person may want to inspect: a click, Enter or Space opens it in the fullscreen
 * `ImageLightbox` with zoom. Use it instead of a bare `<img>`; only decorative icons and avatars stay plain.
 * It keeps the element a plain `<img>` (same size and classes), so the layout does not change. Do not put it inside a
 * button or link: there, open `ImageLightbox` from the control's own handler.
 */
export function ZoomImage({
  alt = "",
  className,
  src,
  onKeyDown,
  ...props
}: Omit<ComponentProps<"img">, "src" | "onClick"> & { src: string }) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <img
        {...props}
        src={src}
        alt={alt}
        role="button"
        tabIndex={0}
        onClick={() => setOpen(true)}
        onKeyDown={(e) => {
          onKeyDown?.(e);
          if (e.key === "Enter" || e.key === " ") {
            e.preventDefault();
            setOpen(true);
          }
        }}
        className={cn("cursor-zoom-in outline-offset-2 focus-visible:outline-2", className)}
      />
      {open && <ImageLightbox name={alt || "Image"} src={src} onClose={() => setOpen(false)} />}
    </>
  );
}
