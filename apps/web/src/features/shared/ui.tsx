import { useCallback, useEffect, useRef, useState, type ReactNode } from "react";
import { Button, Modal as LibModal } from "@/components/ui";
import { Skeleton } from "@g4rcez/components";

import { call, errorMessage } from "../chat/chat-client";

export const field =
  "w-full min-w-0 rounded-md border border-input bg-muted/40 px-3 py-2 text-sm transition-colors placeholder:text-muted-foreground focus-visible:border-ring focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-0 focus-visible:outline-ring/40";
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
  success: "bg-success/15 text-success",
  warning: "bg-warn/15 text-warn",
  danger: "bg-destructive/15 text-destructive",
  info: "bg-primary/15 text-primary",
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
export const when = (iso?: string | null) => (iso ? new Date(iso).toLocaleString() : "-");

/** Loads `{[key]: T[]}` from a GET endpoint. */
export function useList<T>(path: string, key: string, onError: (m: string) => void) {
  const [rows, setRows] = useState<T[] | undefined>();
  const reload = useCallback(
    () =>
      call<Record<string, T[]>>(path).then(
        (r) => setRows(r[key]),
        (e) => onError(errorMessage(e)),
      ),
    [path, key, onError],
  );
  useEffect(() => {
    void reload();
  }, [reload]);
  return [rows, reload, setRows] as const;
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
