import { useEffect, useState, type FormEvent } from "react";
import { Button } from "@/components/ui";

import { call } from "../chat/chat-client";
import { field } from "../shared/ui";

export function Decisions({ onError }: { onError: (m: string) => void }) {
  const [status, setStatus] = useState<string>("checking");
  const [result, setResult] = useState<{ choice: string; probabilities: Record<string, number> }>();
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    let alive = true;
    const poll = () => call<{ state: string }>("/api/decisions/status").then((r) => { if (alive) setStatus(r.state); }).catch(() => { if (alive) setStatus("unavailable"); });
    void poll(); const t = setInterval(poll, 4000);
    return () => { alive = false; clearInterval(t); };
  }, []);
  async function decide(e: FormEvent<HTMLFormElement>) {
    e.preventDefault(); const f = new FormData(e.currentTarget);
    const options = String(f.get("options")).split(",").map((o) => o.trim()).filter(Boolean);
    setBusy(true); setResult(undefined);
    try {
      const r = await call<{ answers: { pick: { choice: string; probabilities: Record<string, number> } } }>("/api/decisions", "POST", { subject: String(f.get("subject")), questions: { pick: { type: "choice", instructions: String(f.get("question")), criteria: Object.fromEntries(options.map((o) => [o, o])) } } });
      setResult(r.answers.pick);
    } catch { onError("The decision model is not ready yet. It loads in the background; try again shortly."); } finally { setBusy(false); }
  }
  return (
    <section aria-label="Decisions" className="space-y-3">
      <p className="text-sm">Built-in decision model (Laya): <strong>{status === "ready" ? "ready" : status === "loading" ? "loading…" : status}</strong>. It runs on this server, is free, and picks between options with calibrated probabilities. Workflows and bot routing can use it.</p>
      <form onSubmit={(e) => void decide(e)} className="space-y-2 rounded-lg border bg-card p-4">
        <label className="block">Situation<textarea name="subject" required rows={3} className={field} placeholder="Paste a ticket, email or note" /></label>
        <label className="block">Question<input name="question" required className={field} placeholder="Which team should handle this?" /></label>
        <label className="block">Options (comma separated)<input name="options" required className={field} placeholder="billing, support, sales" /></label>
        <Button type="submit" size="sm" disabled={busy || status !== "ready"}>{busy ? "Deciding…" : "Decide"}</Button>
      </form>
      {result && <div role="status" className="rounded-lg border bg-card p-4 text-sm"><p className="font-medium">Decision: {result.choice}</p><ul>{Object.entries(result.probabilities).sort((a, b) => b[1] - a[1]).map(([k, v]) => <li key={k}>{k}: {(v * 100).toFixed(1)}%</li>)}</ul></div>}
    </section>
  );
}
