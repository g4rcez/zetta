import { CheckIcon } from "@phosphor-icons/react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type ComponentProps,
  type ReactNode,
} from "react";
import { Button, Modal as LibModal } from "@/components/ui";
import { Skeleton } from "@g4rcez/components";

import { call, errorMessage } from "../chat/chat-client";
import { formatDateTime, type TimeFormat } from "@/features/preferences/time-format";

export const field =
  "w-full min-w-0 rounded-md border border-input bg-muted/40 px-3 py-2 text-sm transition-colors placeholder:text-muted-foreground focus-visible:border-ring focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-0 focus-visible:outline-ring/40 focus-within:border-ring focus-within:outline focus-within:outline-2 focus-within:outline-offset-0 focus-within:outline-ring/40";
export const card = "rounded-lg border bg-card p-4 text-sm";

export const Empty = ({ children }: { children: ReactNode }) => (
  <p className="rounded-lg border border-dashed px-4 py-6 text-center text-sm text-muted-foreground">
    {children}
  </p>
);

/** Suspense fallback while a lazy panel loads. */
export const Loading = () => (
  <div role="status" aria-label="Loading" className="space-y-3">
    <Skeleton className="h-5 w-1/3 rounded" />
    <Skeleton className="h-24 w-full rounded-lg" />
  </div>
);

/** Rows share one outer border and hairline dividers instead of a card per row. */
export const list = "divide-y overflow-hidden rounded-lg border bg-card empty:hidden";
export const listItem = "min-w-0 px-4 py-3 text-sm";

const TONE = {
  neutral: "bg-muted text-muted-foreground",
  // 10% tints with the status text: the pairs the contrast guard (tokens.test.ts) holds at 7:1.
  success: "bg-success/10 text-success",
  warning: "bg-warn/10 text-warn",
  danger: "bg-destructive/10 text-destructive",
  info: "bg-info/10 text-info",
} as const;
export const Badge = ({
  tone = "neutral",
  children,
}: {
  tone?: keyof typeof TONE;
  children: ReactNode;
}) => (
  <span
    className={`inline-flex shrink-0 items-center rounded-full px-2 py-0.5 text-xs font-medium ${TONE[tone]}`}
  >
    {children}
  </span>
);

/** A titled surface: header with optional count/description/action, then content. */
export function Panel({
  title,
  count,
  description,
  action,
  label,
  children,
}: {
  title: string;
  count?: number | undefined;
  description?: ReactNode;
  action?: ReactNode;
  label?: string;
  children: ReactNode;
}) {
  return (
    <section
      aria-label={label ?? title}
      className="min-w-0 space-y-4 rounded-xl border bg-card p-5"
    >
      <header className="flex flex-wrap items-start justify-between gap-x-4 gap-y-2">
        <div className="min-w-0">
          <h3 className="text-base font-semibold tracking-tight">
            {title}
            {count !== undefined && (
              <span className="ml-2 text-sm font-normal tabular-nums text-muted-foreground">
                {count}
              </span>
            )}
          </h3>
          {description && (
            <p className="mt-0.5 text-sm text-pretty text-muted-foreground">{description}</p>
          )}
        </div>
        {action}
      </header>
      {children}
    </section>
  );
}
export const when = (iso: string | null | undefined, f: TimeFormat) =>
  iso ? formatDateTime(iso, f) : "-";

/** Loads `{[key]: T[]}` from a GET endpoint. Components that ask for the same path share one request. */
export function useList<T>(path: string, key: string, onError: (m: string) => void) {
  const qc = useQueryClient();
  const queryKey = ["list", path] as const;
  const query = useQuery({
    queryKey,
    queryFn: () => call<Record<string, T[]>>(path).then((r) => r[key] as T[]),
  });
  const error = query.error;
  useEffect(() => {
    if (error) onError(errorMessage(error));
    // `onError` is usually an inline function; the message only matters when the error changes.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [error]);
  const reload = useCallback(() => qc.invalidateQueries({ queryKey: ["list", path] }), [qc, path]);
  const setRows = useCallback(
    (next: T[] | undefined) => qc.setQueryData<T[]>(["list", path], next),
    [qc, path],
  );
  return [query.data, reload, setRows] as const;
}

/** Two-step confirm: first click asks, second click confirms. Escape or Cancel backs out. */
export function ConfirmButton({
  label,
  question,
  confirmLabel,
  onConfirm,
  variant = "outline",
  size = "sm",
}: {
  label: string;
  question: string;
  confirmLabel: string;
  onConfirm: () => void | Promise<void>;
  variant?: "outline" | "destructive";
  size?: "sm" | "xs";
}) {
  const [asking, setAsking] = useState(false);
  const yes = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    if (asking) yes.current?.focus();
  }, [asking]);
  if (!asking)
    return (
      <Button size={size} variant={variant} type="button" onClick={() => setAsking(true)}>
        {label}
      </Button>
    );
  return (
    <span
      role="group"
      aria-label={question}
      className="inline-flex flex-wrap items-center gap-1 rounded-md border border-destructive/40 px-2 py-1 text-xs"
      onKeyDown={(e) => {
        if (e.key === "Escape") setAsking(false);
      }}
    >
      <span>{question}</span>
      <Button
        ref={yes}
        size="xs"
        variant="destructive"
        type="button"
        onClick={() => {
          setAsking(false);
          void onConfirm();
        }}
      >
        {confirmLabel}
      </Button>
      <Button size="xs" variant="outline" type="button" onClick={() => setAsking(false)}>
        Cancel
      </Button>
    </span>
  );
}

/**
 * Press and hold to confirm, for actions that widen what a bot may do. A click or a tap alone does nothing; the fill shows the hold and
 * letting go early starts over. The keyboard works the same way (hold Space or Enter). Reduced motion keeps the hold but hides the fill.
 */
export function HoldButton({
  children,
  onHold,
  holdMs = 1200,
  disabled,
  variant = "default",
  size = "sm",
  catchUp,
}: {
  children: ReactNode;
  onHold: () => void;
  holdMs?: number;
  disabled?: boolean;
  variant?: ComponentProps<typeof Button>["variant"];
  size?: ComponentProps<typeof Button>["size"];
  /** Marks the button as the card's main action, so Inbox's keyboard shortcut can focus it (see `data-catch-up`). */
  catchUp?: "act";
}) {
  const [holding, setHolding] = useState(false);
  const [early, setEarly] = useState(false);
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const start = () => {
    if (disabled || timer.current) return;
    setEarly(false);
    setHolding(true);
    timer.current = setTimeout(() => {
      timer.current = undefined;
      setHolding(false);
      onHold();
    }, holdMs);
  };
  const stop = () => {
    if (timer.current) {
      clearTimeout(timer.current);
      timer.current = undefined;
      setEarly(true);
    }
    setHolding(false);
  };
  useEffect(() => () => clearTimeout(timer.current), []);
  const isKey = (key: string) => key === " " || key === "Enter";
  return (
    <>
      <Button
        type="button"
        size={size}
        variant={variant}
        disabled={disabled}
        data-catch-up={catchUp}
        className="relative select-none overflow-hidden [-webkit-touch-callout:none]"
        onPointerDown={start}
        onPointerUp={stop}
        onPointerLeave={stop}
        onPointerCancel={stop}
        onContextMenu={(e) => e.preventDefault()}
        onKeyDown={(e) => {
          if (!isKey(e.key)) return;
          e.preventDefault();
          if (!e.repeat) start();
        }}
        onKeyUp={(e) => {
          if (!isKey(e.key)) return;
          e.preventDefault();
          stop();
        }}
        onBlur={stop}
      >
        <span
          aria-hidden
          className="pointer-events-none absolute inset-0 origin-left bg-black/25 motion-reduce:hidden"
          style={{
            transform: holding ? "scaleX(1)" : "scaleX(0)",
            transition: holding ? `transform ${holdMs}ms linear` : "transform 150ms ease-out",
          }}
        />
        <span className="relative">{children}</span>
      </Button>
      <span role="status" className="sr-only">
        {early ? "Keep holding to confirm." : ""}
      </span>
    </>
  );
}

/** Modal dialog from @g4rcez/components (focus handling, Escape and overlay behaviour come from the library). */
export function Modal({
  title,
  onClose,
  children,
}: {
  title: string;
  onClose: () => void;
  children: ReactNode;
}) {
  return (
    <LibModal
      open
      onChange={(open: boolean) => {
        if (!open) onClose();
      }}
      title={title}
      ariaTitle={title}
      overlayClickClose
    >
      <div className="flex flex-col gap-3 text-sm">{children}</div>
    </LibModal>
  );
}

/** A selectable tile backed by a real radio input, so arrow keys, focus and screen readers behave natively. */
export function Choice({
  name,
  value,
  checked,
  onSelect,
  title,
  art,
  children,
  className = "",
}: {
  name: string;
  value: string;
  checked: boolean;
  onSelect: (v: string) => void;
  title: ReactNode;
  art?: ReactNode;
  children?: ReactNode;
  className?: string;
}) {
  return (
    <label
      className={`relative flex cursor-pointer gap-4 rounded-lg border p-4 text-sm transition-colors has-[:focus-visible]:outline-2 has-[:focus-visible]:outline-ring ${checked ? "border-primary bg-primary/[0.06]" : "bg-card hover:border-foreground/25"} ${className}`}
    >
      <input
        type="radio"
        name={name}
        value={value}
        checked={checked}
        onChange={() => onSelect(value)}
        className="sr-only"
      />
      {art}
      <span className="flex min-w-0 flex-1 flex-col gap-1">
        <span className="flex items-center justify-between gap-2 font-medium">
          {title}
          <span
            aria-hidden="true"
            className={`grid size-4 shrink-0 place-items-center rounded-full ${checked ? "bg-primary text-primary-foreground" : "ring-1 ring-border"}`}
          >
            {checked && <CheckIcon className="size-3" />}
          </span>
        </span>
        {children && (
          <span className="text-sm leading-snug text-pretty text-muted-foreground">{children}</span>
        )}
      </span>
    </label>
  );
}
