import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useState, type FormEvent } from "react";
import { EditorField } from "@/components/editor/editor";
import { Button, Input } from "@/components/ui";

import { call } from "../chat/chat-client";
import { Badge } from "../shared/ui";
import { LayaSwitch } from "./laya-switch";
import { DECISIONS_STATUS, decisionsQueries } from "./studio-queries";

export function Decisions({ onError }: { onError: (m: string) => void }) {
  const qc = useQueryClient();
  const [result, setResult] = useState<{ choice: string; probabilities: Record<string, number> }>();
  const [busy, setBusy] = useState(false);
  // The model only loads once: polling stops when it is ready or off. Hidden tabs do not poll.
  const state = useQuery({
    ...decisionsQueries.status(),
    refetchInterval: (q) => {
      const s = q.state.data?.state;
      return s === "ready" || s === "off" ? false : 4000;
    },
  });
  const status = state.isError ? "unavailable" : (state.data?.state ?? "checking");
  const variant = state.data?.variant;
  async function decide(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const f = new FormData(e.currentTarget);
    const options = String(f.get("options"))
      .split(",")
      .map((o) => o.trim())
      .filter(Boolean);
    setBusy(true);
    setResult(undefined);
    try {
      const r = await call<{
        answers: { pick: { choice: string; probabilities: Record<string, number> } };
      }>("/api/decisions", "POST", {
        subject: String(f.get("subject")),
        questions: {
          pick: {
            type: "choice",
            instructions: String(f.get("question")),
            criteria: Object.fromEntries(options.map((o) => [o, o])),
          },
        },
      });
      setResult(r.answers.pick);
    } catch {
      onError(
        "The decision model is not ready yet. It loads in the background; try again shortly.",
      );
    } finally {
      setBusy(false);
    }
  }
  return (
    <section aria-label="Decisions" className="grid items-start gap-4 xl:grid-cols-2">
      <p className="flex flex-wrap items-center gap-x-2 gap-y-1 text-sm text-pretty text-muted-foreground xl:col-span-2">
        Laya{variant ? ` (${variant === "multilingual" ? "multilingual" : "English"})` : ""}
        <Badge tone={status === "ready" ? "success" : status === "loading" ? "warning" : "neutral"}>
          {status === "ready"
            ? "Ready"
            : status === "loading"
              ? "Loading…"
              : status === "off"
                ? "Off"
                : status}
        </Badge>
        Free, local, and used by workflows and bot routing without any setup.
      </p>
      <LayaSwitch
        className="xl:col-span-2"
        onError={onError}
        // Reset, not invalidate: the badge shows "checking" until the new state arrives.
        onChanged={() => void qc.resetQueries({ queryKey: DECISIONS_STATUS })}
      />
      <details className="rounded-xl border bg-card p-5 xl:col-span-2">
        <summary className="cursor-pointer text-sm font-medium focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring">
          Try it on a sample
        </summary>
        <form onSubmit={(e) => void decide(e)} className="mt-4 space-y-3">
          {/* Plain on purpose: pasted external text (a ticket, an email), where `@` appears in addresses and handles. */}
          <EditorField
            title="Situation"
            name="subject"
            required
            rows={3}
            placeholder="Paste a ticket, email or note"
          />
          <Input
            title="Question"
            name="question"
            required
            placeholder="Which team should handle this?"
          />
          <Input
            title="Options (comma separated)"
            name="options"
            required
            placeholder="billing, support, sales"
          />
          <Button type="submit" size="sm" disabled={busy || status !== "ready"}>
            {busy ? "Deciding…" : "Decide"}
          </Button>
        </form>
      </details>
      {result && (
        <div
          role="status"
          className="space-y-3 rounded-xl border bg-card p-5 text-sm xl:col-span-2"
        >
          <p className="text-base font-semibold">Decision: {result.choice}</p>
          <ul className="space-y-2">
            {Object.entries(result.probabilities)
              .sort((a, b) => b[1] - a[1])
              .map(([k, v]) => (
                <li key={k}>
                  <div className="flex justify-between gap-3">
                    <span className="break-words">{k}</span>
                    <span className="tabular-nums text-muted-foreground">
                      {(v * 100).toFixed(1)}%
                    </span>
                  </div>
                  <div className="mt-1 h-1.5 overflow-hidden rounded-full bg-muted">
                    <div
                      className={`h-full rounded-full ${k === result.choice ? "bg-primary" : "bg-muted-foreground/40"}`}
                      style={{ width: `${v * 100}%` }}
                    />
                  </div>
                </li>
              ))}
          </ul>
        </div>
      )}
    </section>
  );
}
