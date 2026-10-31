import { useState } from "react";
import { ShieldWarningIcon } from "@phosphor-icons/react";

import { Button } from "@/components/ui";
import { Item, ItemActions, ItemContent, ItemMedia, ItemTitle } from "@zetta/ui/components/item";

import {
  chatClient,
  errorMessage,
  type Bot,
  type Proposal,
  type ProposalKind,
} from "./chat-client";

const KIND_LABEL: Record<ProposalKind, string> = {
  config: "Change settings",
  create_bot: "Create bot",
  create_routine: "Create routine",
  create_workflow: "Create workflow",
  create_instruction: "Save instruction",
  create_vm: "New computer",
  open_discussion: "Open a room",
  discussion_brief: "Let a code bot act on outside content",
  start_loop: "Start a loop",
  team_goals: "Give the team goals",
  bot_permission: "Change what a bot may do",
  create_memory: "Save to memory",
  create_wiki_page: "Save to the wiki",
};
const FIELD_LABEL: Record<string, string> = {
  discussion: "Room",
  goal: "Goal",
  members: "Bots",
  context: "Shared context",
  memory: "Memory",
  instruction: "Instruction",
  wiki: "Wiki page",
  request: "What it was asked",
  bot: "Bot",
  preset: "Preset",
  allow: "Allow",
  deny: "Deny",
  revoke: "Remove",
  name: "Name",
  title: "Title",
  description: "Description",
  instructions: "Instructions",
  personality: "Personality",
  prompt: "What it should do",
  harness: "Engine",
  model: "Model",
  doneWhen: "Done when",
  dailyAt: "Daily at",
  everyMinutes: "Every (minutes)",
  timezone: "Timezone",
  graph: "Steps",
  steps: "Steps",
  body: "Steps",
  verification: "How to check",
};
export function showValue(v: unknown, max = 240): string {
  if (v === null || v === undefined || v === "") return "(empty)";
  const text = typeof v === "string" ? v : JSON.stringify(v);
  return text.length > max ? `${text.slice(0, max)}…` : text;
}
/** One-line plain summary for create_* proposals. */
export function summarize(p: Proposal): string {
  const name = p.diff.find(
    (d) =>
      d.field === "name" || d.field === "title" || d.field === "discussion" || d.field === "goal",
  )?.to;
  return `${KIND_LABEL[p.kind ?? "config"]}${name ? `: ${showValue(name, 80)}` : ""}`;
}
const STALE =
  "This proposal is out of date because the bot changed after it was made. Nothing was applied; ask the bot for a new proposal.";

export function ProposalsPanel({
  proposals,
  bots,
  onResolved,
  onBotsChanged,
  notify,
}: {
  proposals: Proposal[];
  bots: Bot[];
  onResolved: (id: string) => void;
  onBotsChanged: () => void;
  notify: (m: string) => void;
}) {
  const [busy, setBusy] = useState<string>();
  const [errors, setErrors] = useState<Record<string, string>>({});
  async function decide(p: Proposal, approve: boolean) {
    setBusy(p.id);
    setErrors((m) => Object.fromEntries(Object.entries(m).filter(([id]) => id !== p.id)));
    try {
      const r = await chatClient.decide(p.id, approve);
      onResolved(p.id);
      if (r.status === "stale") notify(STALE);
      else if (r.status === "rejected") notify("Rejected. Nothing was changed.");
      else {
        notify(
          p.kind === "start_loop" || p.kind === "team_goals"
            ? "Loop started. The bot keeps working until the goal is done; press Stop to end it."
            : p.kind && p.kind !== "config"
              ? `Done: ${summarize(p)}.`
              : "Change applied. Chat again to confirm the bot is ready.",
        );
        onBotsChanged();
      }
    } catch (e) {
      setErrors((m) => ({ ...m, [p.id]: errorMessage(e) }));
    } finally {
      setBusy(undefined);
    }
  }
  // AI Elements Confirmation pattern: what the bot wants to do, then Approve / Reject.
  return (
    <>
      {proposals.map((p) => {
        const creating = p.kind && p.kind !== "config";
        return (
          <Item
            key={p.id}
            variant="outline"
            size="sm"
            role="group"
            aria-label={creating ? summarize(p) : "Proposed change"}
            className="rounded-lg border-warn/40 bg-warn/5 text-sm"
          >
            <ItemMedia variant="icon">
              <ShieldWarningIcon className="text-warn" />
            </ItemMedia>
            <ItemContent className="min-w-0">
              <ItemTitle className="text-sm">
                {creating
                  ? `A bot suggests: ${summarize(p)}`
                  : `A bot proposed a change to ${bots.find((b) => b.id === p.botId)?.name ?? "a bot"}`}
              </ItemTitle>
              <ul className="space-y-0.5 text-xs text-muted-foreground">
                {p.diff.map((d) => (
                  <li key={d.field} className="break-words">
                    <span className="font-medium text-foreground">
                      {FIELD_LABEL[d.field] ?? d.field}
                    </span>
                    :{" "}
                    {creating ? (
                      <span>{showValue(d.to)}</span>
                    ) : (
                      <>
                        <del className="opacity-60">{showValue(d.from, 120)}</del> →{" "}
                        <ins className="no-underline">{showValue(d.to)}</ins>
                      </>
                    )}
                  </li>
                ))}
              </ul>
              {errors[p.id] && (
                <p role="alert" className="text-xs text-destructive">
                  {errors[p.id]}
                </p>
              )}
            </ItemContent>
            <ItemActions>
              <Button
                size="sm"
                variant="destructive"
                disabled={busy === p.id}
                onClick={() => void decide(p, false)}
              >
                {p.kind === "start_loop" || p.kind === "team_goals"
                  ? "Not now"
                  : p.kind === "bot_permission"
                    ? "Deny"
                    : "Reject"}
              </Button>
              <Button
                size="sm"
                variant="success"
                disabled={busy === p.id}
                onClick={() => void decide(p, true)}
              >
                {p.kind === "team_goals"
                  ? "Start goals"
                  : p.kind === "start_loop"
                    ? "Start loop"
                    : p.kind === "discussion_brief"
                      ? "Approve this brief"
                      : p.kind === "create_memory" ||
                          p.kind === "create_wiki_page" ||
                          p.kind === "create_instruction"
                        ? "Save it"
                        : p.kind === "open_discussion"
                          ? "Approve and open"
                          : creating
                            ? "Approve and create"
                            : "Approve"}
              </Button>
            </ItemActions>
          </Item>
        );
      })}
    </>
  );
}
