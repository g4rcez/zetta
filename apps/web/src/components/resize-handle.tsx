import { useRef, type KeyboardEvent, type PointerEvent } from "react";

const STEP = 16;
const clamp = (n: number, min: number, max: number) => Math.min(max, Math.max(min, n));

/**
 * A draggable divider on the right edge of a sidebar. The parent must be `relative`.
 * Drag, use the arrow keys (Shift for bigger steps), or double-click to restore the default width.
 */
export function ResizeHandle({
  label,
  value,
  min,
  max,
  fallback,
  onChange,
  onDragging,
}: {
  label: string;
  value: number;
  min: number;
  max: number;
  fallback: number;
  onChange: (width: number) => void;
  onDragging?: (dragging: boolean) => void;
}) {
  const start = useRef<{ x: number; width: number }>(undefined);
  const move = (event: PointerEvent<HTMLDivElement>) => {
    if (!start.current) return;
    onChange(clamp(start.current.width + event.clientX - start.current.x, min, max));
  };
  const end = () => {
    start.current = undefined;
    onDragging?.(false);
  };
  const key = (event: KeyboardEvent<HTMLDivElement>) => {
    const step = event.shiftKey ? STEP * 4 : STEP;
    const next =
      event.key === "ArrowLeft"
        ? value - step
        : event.key === "ArrowRight"
          ? value + step
          : event.key === "Home"
            ? min
            : event.key === "End"
              ? max
              : undefined;
    if (next === undefined) return;
    event.preventDefault();
    onChange(clamp(next, min, max));
  };
  return (
    <div
      role="separator"
      aria-orientation="vertical"
      aria-label={label}
      aria-valuenow={value}
      aria-valuemin={min}
      aria-valuemax={max}
      tabIndex={0}
      title="Drag to resize. Double-click to reset."
      className="absolute inset-y-0 right-0 z-20 hidden w-1.5 cursor-col-resize touch-none select-none transition-colors hover:bg-ring/40 focus-visible:bg-ring/60 active:bg-ring/60 md:block"
      onPointerDown={(event) => {
        event.preventDefault();
        event.currentTarget.setPointerCapture(event.pointerId);
        start.current = { x: event.clientX, width: value };
        onDragging?.(true);
      }}
      onPointerMove={move}
      onPointerUp={end}
      onPointerCancel={end}
      onDoubleClick={() => onChange(fallback)}
      onKeyDown={key}
    />
  );
}
