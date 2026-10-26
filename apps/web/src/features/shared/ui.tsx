import { useCallback, useEffect, useRef, useState, type ReactNode } from "react";
import { Button, Modal as LibModal } from "@/components/ui";

import { call, errorMessage } from "../chat/chat-client";

export const field = "w-full min-w-0 rounded-md border border-input bg-muted/40 px-3 py-2 text-sm transition-colors placeholder:text-muted-foreground focus-visible:border-ring focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-0 focus-visible:outline-ring/40";
export const card = "rounded-lg border bg-card p-4 text-sm";

export const Empty = ({ children }: { children: ReactNode }) => <p className="text-sm text-muted-foreground">{children}</p>;
export const Field = ({ label, children, className = "" }: { label: string; children: ReactNode; className?: string }) => <label className={`block min-w-0 text-sm ${className}`}><span className="mb-1 block font-medium">{label}</span>{children}</label>;
export const when = (iso?: string | null) => (iso ? new Date(iso).toLocaleString() : "-");

/** Loads `{[key]: T[]}` from a GET endpoint. */
export function useList<T>(path: string, key: string, onError: (m: string) => void) {
  const [rows, setRows] = useState<T[] | undefined>();
  const reload = useCallback(() => call<Record<string, T[]>>(path).then((r) => setRows(r[key]), (e) => onError(errorMessage(e))), [path, key, onError]);
  useEffect(() => { void reload(); }, [reload]);
  return [rows, reload, setRows] as const;
}

/** Two-step confirm: first click asks, second click confirms. Escape or Cancel backs out. */
export function ConfirmButton({ label, question, confirmLabel, onConfirm, variant = "outline", size = "sm" }: { label: string; question: string; confirmLabel: string; onConfirm: () => void | Promise<void>; variant?: "outline" | "destructive"; size?: "sm" | "xs" }) {
  const [asking, setAsking] = useState(false);
  const yes = useRef<HTMLButtonElement>(null);
  useEffect(() => { if (asking) yes.current?.focus(); }, [asking]);
  if (!asking) return <Button size={size} variant={variant} type="button" onClick={() => setAsking(true)}>{label}</Button>;
  return (
    <span role="group" aria-label={question} className="inline-flex flex-wrap items-center gap-1 rounded-md border border-destructive/40 px-2 py-1 text-xs" onKeyDown={(e) => { if (e.key === "Escape") setAsking(false); }}>
      <span>{question}</span>
      <Button ref={yes} size="xs" variant="destructive" type="button" onClick={() => { setAsking(false); void onConfirm(); }}>{confirmLabel}</Button>
      <Button size="xs" variant="outline" type="button" onClick={() => setAsking(false)}>Cancel</Button>
    </span>
  );
}

/** Modal dialog from @g4rcez/components (focus handling, Escape and overlay behaviour come from the library). */
export function Modal({ title, onClose, children }: { title: string; onClose: () => void; children: ReactNode }) {
  return <LibModal open onChange={(open: boolean) => { if (!open) onClose(); }} title={title} ariaTitle={title} overlayClickClose><div className="flex flex-col gap-3 text-sm">{children}</div></LibModal>;
}
