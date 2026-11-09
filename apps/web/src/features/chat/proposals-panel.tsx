import { useQueryClient } from "@tanstack/react-query";
import { useState, type ReactNode } from "react";
import { Link } from "@tanstack/react-router";
import { ShieldWarningIcon } from "@phosphor-icons/react";

import { BotIdentity } from "@/components/bot-identity";
import { Button } from "@/components/ui";
import { useApprovalMode } from "../preferences/preferences";
import { HoldButton } from "../shared/ui";
import { relativeTime } from "../shared/relative-time";
import { FAILURE_TEXT } from "../skills/skills-api";
import {
  SkillsInstallCard,
  type SkillsChoice,
  type SkillsOffer,
} from "../skills/skills-install-card";
import { draftFromProposal } from "../memory/draft";
import { ToolPauseCard, type FormAnswer, type PausedCallPatch } from "./tool-card";
import { Item, ItemActions, ItemContent, ItemMedia, ItemTitle } from "@zetta/ui/components/item";

import {
  ApiError,
  chatClient,
  errorMessage,
  type Bot,
  type DecisionResult,
  type Proposal,
  type ProposalKind,
} from "./chat-client";

const KIND_LABEL: Record<ProposalKind, string> = {
  config: "Change settings",
  create_bot: "Create bot",
  create_routine: "Create routine",
  create_workflow: "Create workflow",
  create_vm: "New computer",
  open_discussion: "Open a room",
  discussion_brief: "Let a code bot act on outside content",
  start_loop: "Start a loop",
  team_goals: "Give the team goals",
  bot_permission: "Change what a bot may do",
  create_memory_item: "Save to memory",
  install_skills: "Install skills",
  chief_action: "Change your setup",
  bot_action: "Let the bot make these changes",
  tool_resume: "Answer a tool",
  publish_app: "Publish an app",
};
const FIELD_LABEL: Record<string, string> = {
  outputStyle: "Output style",
  discussion: "Room",
  goal: "Goal",
  members: "Bots",
  context: "Shared context",
  memory: "Memory item",
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
  computerMode: "Computer",
  codeAccess: "Code access",
  visibility: "Visibility",
  commitIdentity: "Commit identity",
  commitEmail: "Commit email",
  requiredConnections: "Accounts it needs",
  folder: "Folder",
  workspace: "Folder", // cards stored before the rename
  schedule: "Schedule",
  routine: "Routine",
  team: "Team",
  style: "Style",
  artifact: "Artifact",
  scope: "Who can use it",
  conversationMode: "Chat per run",
};
const fieldLabel = (f: string) => FIELD_LABEL[f] ?? f.charAt(0).toUpperCase() + f.slice(1);
export function showValue(v: unknown, max = 240): string {
  if (v === null || v === undefined || v === "") return "(empty)";
  const text = typeof v === "string" ? v : JSON.stringify(v);
  return text.length > max ? `${text.slice(0, max)}…` : text;
}
/** One-line plain summary for create_* proposals. */
export function summarize(p: Proposal): string {
  if (p.kind === "chief_action" && typeof p.patch?.title === "string") return p.patch.title;
  const name = p.diff.find(
    (d) =>
      d.field === "name" || d.field === "title" || d.field === "discussion" || d.field === "goal",
  )?.to;
  return `${KIND_LABEL[p.kind ?? "config"]}${name ? `: ${showValue(name, 80)}` : ""}`;
}
/** What the person is told once the skills they chose were installed. */
function skillsResult(r: NonNullable<DecisionResult["skills"]>): string {
  const n = r.installed.length;
  const m = r.attached.length;
  return [
    n ? `Installed ${n} ${n === 1 ? "skill" : "skills"} (${r.installed.join(", ")}).` : "",
    m
      ? `Gave ${m} ${m === 1 ? "skill" : "skills"} you already had to more bots (${r.attached.join(", ")}).`
      : "",
    !n && !m ? "Nothing was installed." : "",
    (n || m) && r.bots
      ? `${r.bots} ${r.bots === 1 ? "bot loads" : "bots load"} them at the next run.`
      : "",
    n && !r.bots ? "They are in your library: attach them to a bot from Skills." : "",
    r.skippedBots
      ? `${r.skippedBots} ${r.skippedBots === 1 ? "bot is" : "bots are"} full and did not get them.`
      : "",
    r.attachError ? `The bots could not take them (${r.attachError}).` : "",
    r.failed.length
      ? `Not installed: ${r.failed.map((f) => `${f.path.split("/").slice(-2, -1)[0] ?? f.path} ${FAILURE_TEXT[f.code] ?? f.code}`).join("; ")}.`
      : "",
  ]
    .filter(Boolean)
    .join(" ");
}
/** A bot named in a card: its avatar and name, never the name alone. A name no known bot has stays text. */
function BotNames({ names, bots }: { names: string[]; bots: Bot[] }) {
  const found = names.map((n) => bots.find((b) => b.name === n));
  if (found.some((b) => !b)) return <span>{names.join(", ")}</span>;
  return (
    <span className="inline-flex flex-wrap items-center gap-x-3 gap-y-1 align-middle">
      {found.map((b) => (
        <BotIdentity key={b!.id} bot={b!} size={16} className="w-auto flex-none" />
      ))}
    </span>
  );
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
  notify: (m: ReactNode) => void;
}) {
  const qc = useQueryClient();
  const approvalMode = useApprovalMode();
  const [busy, setBusy] = useState<string>();
  const [errors, setErrors] = useState<Record<string, string>>({});
  async function decide(p: Proposal, approve: boolean, choice?: SkillsChoice, answer?: FormAnswer) {
    setBusy(p.id);
    setErrors((m) => Object.fromEntries(Object.entries(m).filter(([id]) => id !== p.id)));
    try {
      const r = await chatClient.decide(p.id, approve, choice, answer);
      onResolved(p.id);
      // An approved change can touch the bot's hooks, skills, accounts, decision routing or plugins. The bot list itself is `onBotsChanged`'s.
      void qc.invalidateQueries({
        queryKey: ["bots"],
        predicate: (q) => q.queryKey.length > 1,
      });
      void qc.invalidateQueries({ queryKey: ["plugins"] });
      if (r.status === "stale") notify(STALE);
      else if (r.status === "rejected")
        notify(
          p.kind === "install_skills"
            ? "Nothing was installed."
            : p.kind === "tool_resume"
              ? "Declined. The tool did not run, and the bot is told."
              : "Rejected. Nothing was changed.",
        );
      else if (p.kind === "tool_resume")
        notify("Sent. The tool is running; the bot tells you the result in the chat.");
      else if (r.skills) notify(skillsResult(r.skills));
      else if (r.memory)
        notify(
          <>
            {r.memory.created ? "Added to memory" : "Updated memory"}:{" "}
            <Link to="/memory/$slug" params={{ slug: r.memory.slug }} className="underline">
              {r.memory.title}
            </Link>
          </>,
        );
      else if (r.note) {
        notify(`Done: ${summarize(p)}. ${r.note}`);
        onBotsChanged();
      } else {
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
      // Past its deadline the server closed the card: it leaves the list, with the reason.
      if (e instanceof ApiError && e.code === "PROPOSAL_EXPIRED") {
        onResolved(p.id);
        notify(e.message);
      } else setErrors((m) => ({ ...m, [p.id]: errorMessage(e) }));
    } finally {
      setBusy(undefined);
    }
  }
  // AI Elements Confirmation pattern: what the bot wants to do, then Approve / Reject.
  return (
    <>
      {proposals.map((p) => {
        const askerId = p.proposedByBotId ?? p.botId;
        const asker =
          bots.find((b) => b.id === askerId) ??
          (askerId ? { id: askerId, name: "A bot" } : undefined);
        const target = bots.find((b) => b.id === p.botId);
        if (p.kind === "install_skills" && p.patch)
          return (
            <div key={p.id} className="space-y-2">
              {asker && <BotIdentity bot={asker} size={24} sub="asks to install skills" />}
              <SkillsInstallCard
                offer={p.patch as unknown as SkillsOffer}
                busy={busy === p.id}
                error={errors[p.id]}
                onDecide={(approve, choice) => void decide(p, approve, choice)}
              />
            </div>
          );
        if (p.kind === "tool_resume" && p.patch)
          return (
            <ToolPauseCard
              key={p.id}
              asker={asker}
              patch={p.patch as unknown as PausedCallPatch}
              expiresAt={p.expiresAt}
              busy={busy === p.id}
              error={errors[p.id]}
              onDecide={(approve, answer) => void decide(p, approve, undefined, answer)}
            />
          );
        const creating = p.kind && p.kind !== "config";
        const draft = p.kind === "create_memory_item" ? draftFromProposal(p.patch) : undefined;
        const approveLabel =
          p.kind === "team_goals"
            ? "Start goals"
            : p.kind === "start_loop"
              ? "Start loop"
              : p.kind === "discussion_brief"
                ? "Approve this brief"
                : p.kind === "chief_action"
                  ? "Approve"
                  : p.kind === "create_memory_item"
                    ? "Save it"
                    : p.kind === "open_discussion"
                      ? "Approve and open"
                      : p.kind === "bot_permission" || p.kind === "bot_action"
                        ? "Approve"
                        : creating
                          ? "Approve and create"
                          : "Approve";
        const left = p.expiresAt ? relativeTime(p.expiresAt) : "";
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
              <ItemTitle className="flex-wrap gap-x-2 text-sm">
                {asker && <BotIdentity bot={asker} size={24} className="w-auto flex-none" />}
                {creating ? (
                  <span>suggests: {summarize(p)}</span>
                ) : (
                  <>
                    <span>proposed a change to</span>
                    {target ? (
                      <BotIdentity bot={target} size={20} className="w-auto flex-none" />
                    ) : (
                      <span>a bot</span>
                    )}
                  </>
                )}
              </ItemTitle>
              <ul className="space-y-0.5 text-xs text-muted-foreground">
                {p.diff.map((d, i) => (
                  <li key={`${d.field}-${i}`} className="break-words">
                    <span className="font-medium text-foreground">{fieldLabel(d.field)}</span>:{" "}
                    {creating &&
                    (d.field === "bot" || d.field === "members") &&
                    typeof d.to === "string" ? (
                      <BotNames names={d.to.split(", ")} bots={bots} />
                    ) : creating && !(p.kind === "chief_action" && d.from != null) ? (
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
              {left && (
                <p className="text-xs text-muted-foreground">
                  Expires {left === "now" ? "any moment" : left}
                </p>
              )}
              {draft && (
                <Link
                  to="/memory-draft"
                  search={{ d: draft }}
                  className="text-xs underline underline-offset-2"
                >
                  Preview the change (nothing is saved)
                </Link>
              )}
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
              {p.confirm === "hold" && approvalMode === "hold" ? (
                <HoldButton
                  size="sm"
                  variant="success"
                  disabled={busy === p.id}
                  onHold={() => void decide(p, true)}
                >
                  Hold to approve
                </HoldButton>
              ) : (
                <Button
                  size="sm"
                  variant="success"
                  disabled={busy === p.id}
                  onClick={() => void decide(p, true)}
                >
                  {approveLabel}
                </Button>
              )}
            </ItemActions>
          </Item>
        );
      })}
    </>
  );
}
