import { useState } from "react";
import { Button } from "@/components/ui";

import { chatClient, errorMessage, type Bot, type Proposal, type ProposalKind } from "./chat-client";

const KIND_LABEL: Record<ProposalKind, string> = { config: "Change settings", create_bot: "Create bot", create_routine: "Create routine", create_workflow: "Create workflow", create_instruction: "Save instruction" };
const FIELD_LABEL: Record<string, string> = { name: "Name", title: "Title", description: "Description", instructions: "Instructions", personality: "Personality", prompt: "What it should do", harness: "Engine", model: "Model", dailyAt: "Daily at", everyMinutes: "Every (minutes)", timezone: "Timezone", graph: "Steps", steps: "Steps", body: "Steps", verification: "How to check" };
export function showValue(v: unknown, max = 240): string {
  if (v === null || v === undefined || v === "") return "(empty)";
  const text = typeof v === "string" ? v : JSON.stringify(v);
  return text.length > max ? `${text.slice(0, max)}…` : text;
}
/** One-line plain summary for create_* proposals. */
export function summarize(p: Proposal): string {
  const name = p.diff.find((d) => d.field === "name" || d.field === "title")?.to;
  return `${KIND_LABEL[p.kind ?? "config"]}${name ? `: ${showValue(name, 80)}` : ""}`;
}
const STALE = "This proposal is out of date because the bot changed after it was made. Nothing was applied; ask the bot for a new proposal.";

export function ProposalsPanel({ proposals, bots, onResolved, onBotsChanged, notify }: { proposals: Proposal[]; bots: Bot[]; onResolved: (id: string) => void; onBotsChanged: () => void; notify: (m: string) => void }) {
  const [busy, setBusy] = useState<string>();
  const [errors, setErrors] = useState<Record<string, string>>({});
  async function decide(p: Proposal, approve: boolean) {
    setBusy(p.id); setErrors(({ [p.id]: _, ...rest }) => rest);
    try {
      const r = await chatClient.decide(p.id, approve);
      onResolved(p.id);
      if (r.status === "stale") notify(STALE);
      else if (r.status === "rejected") notify("Rejected. Nothing was changed.");
      else { notify(p.kind && p.kind !== "config" ? `Done: ${summarize(p)}.` : "Change applied. Chat again to confirm the bot is ready."); onBotsChanged(); }
    } catch (e) { setErrors((m) => ({ ...m, [p.id]: errorMessage(e) })); } finally { setBusy(undefined); }
  }
  return (
    <>{proposals.map((p) => {
      const creating = p.kind && p.kind !== "config";
      return (
        <section key={p.id} aria-label={creating ? summarize(p) : "Proposed change"} className="mx-4 min-w-0 rounded-lg border border-yellow-600/50 p-3 text-sm">
          {creating
            ? <p className="font-medium">A bot suggests: {summarize(p)}</p>
            : <p className="font-medium">A bot proposed a change to {bots.find((b) => b.id === p.botId)?.name ?? "a bot"}</p>}
          <ul className="mt-1 space-y-1">{p.diff.map((d) => (
            <li key={d.field} className="break-words">
              <span className="font-medium">{FIELD_LABEL[d.field] ?? d.field}</span>:{" "}
              {creating ? <span>{showValue(d.to)}</span> : <><del className="opacity-60">{showValue(d.from, 120)}</del> → <ins>{showValue(d.to)}</ins></>}
            </li>))}</ul>
          {errors[p.id] && <p role="alert" className="mt-1 text-destructive">{errors[p.id]}</p>}
          <div className="mt-2 flex gap-2">
            <Button size="sm" disabled={busy === p.id} onClick={() => void decide(p, true)}>{creating ? "Approve and create" : "Approve"}</Button>
            <Button size="sm" variant="outline" disabled={busy === p.id} onClick={() => void decide(p, false)}>Reject</Button>
          </div>
        </section>);
    })}</>
  );
}
