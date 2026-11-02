import { useEffect, useState, type FormEvent } from "react";
import { Button, Input, Textarea } from "@/components/ui";

import { call } from "../chat/chat-client";
import { Badge } from "../shared/ui";
import { LayaSwitch } from "./laya-switch";

export function Decisions({ onError }: { onError: (m: string) => void }) {
  const [status, setStatus] = useState<string>("checking");
  const [variant, setVariant] = useState<string>();
  const [result, setResult] = useState<{ choice: string; probabilities: Record<string, number> }>();
  const [busy, setBusy] = useState(false);
  // Bumped when the administrator flips the switch, so the status is read again.
  const [epoch, setEpoch] = useState(0);
  useEffect(() => {
    let alive = true;
    let t: ReturnType<typeof setInterval> | undefined;
    // The model only loads once: stop polling when it is ready or off, and skip hidden tabs.
    const poll = () => {
      if (document.visibilityState === "visible")
        void call<{ state: string; variant?: string }>("/api/decisions/status")
          .then((r) => {
            if (!alive) return;
            setStatus(r.state);
            setVariant(r.variant);
            if (r.state === "ready" || r.state === "off") stop();
          })
          .catch(() => {
            if (alive) setStatus("unavailable");
          });
    };
    const stop = () => {
      clearInterval(t);
      document.removeEventListener("visibilitychange", poll);
    };
    poll();
    t = setInterval(poll, 4000);
    document.addEventListener("visibilitychange", poll);
    return () => {
      alive = false;
      stop();
    };
  }, [epoch]);
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
      <p className="flex flex-wrap items-center xl:col-span-2 gap-x-2 gap-y-1 text-sm text-pretty text-muted-foreground">
        Built-in decision model (Laya){" "}
        <Badge tone={status === "ready" ? "success" : status === "loading" ? "warning" : "neutral"}>
          {status === "ready"
            ? "Ready"
            : status === "loading"
              ? "Loading…"
              : status === "off"
                ? "Off"
                : status}
        </Badge>{" "}
        {status !== "off" && variant && (
          <span>({variant === "multilingual" ? "multilingual" : "English"} model) </span>
        )}
        Runs on this server for free and picks between options with calibrated probabilities.
        Workflows and bot routing can use it.
      </p>
      <LayaSwitch
        className="xl:col-span-2"
        onError={onError}
        onChanged={() => {
          setStatus("checking");
          setEpoch((n) => n + 1);
        }}
      />
      <form onSubmit={(e) => void decide(e)} className="space-y-3 rounded-xl border bg-card p-5">
        {/* Plain on purpose: pasted external text (a ticket, an email), where `@` appears in addresses and handles. */}
        <Textarea
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
      {result && (
        <div role="status" className="space-y-3 rounded-xl border bg-card p-5 text-sm">
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
