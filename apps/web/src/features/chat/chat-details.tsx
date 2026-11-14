import { ActionHint } from "@/components/action-hint";
import { Link } from "@tanstack/react-router";
import { GearSixIcon, PaperclipIcon, XIcon } from "@phosphor-icons/react";
import { Button } from "@/components/ui";

import { BotAvatar } from "@/components/bot-avatar";
import { BotCurrentTask, BotStatusLabel } from "@/components/bot-status";
import { useBotStatus } from "../bots/status";
import type { Attachment, Bot } from "./chat-client";

const size = (bytes: number) =>
  bytes < 1024
    ? `${bytes} B`
    : bytes < 1024 * 1024
      ? `${Math.round(bytes / 1024)} KB`
      : `${(bytes / (1024 * 1024)).toFixed(1)} MB`;

/** What the bot is on: its current task, and a way into all its open work on the tasks page. Nothing for a bot with no open task. */
function BotWork({ botId }: { botId: string }) {
  const entry = useBotStatus(botId);
  if (!entry || entry.openTasks === 0) return null;
  return (
    <div className="space-y-1">
      <p className="label-mono">Working on</p>
      <BotCurrentTask botId={botId} className="-ml-1.5 max-w-full text-sm" />
      <Link
        to="/tasks"
        search={{ stage: "open", botIds: [botId] }}
        className="block text-xs text-muted-foreground underline underline-offset-2 hover:text-foreground focus-visible:outline-2 focus-visible:outline-ring"
      >
        {entry.openTasks} open {entry.openTasks === 1 ? "task" : "tasks"} · See all
      </Link>
    </div>
  );
}

/**
 * The context panel's default view (DESIGN.md "Shell"): who the bot is and the files shared in this chat. Plain words only:
 * the harness and model stay in the bot's settings.
 */
export function ChatDetails({
  bot,
  files,
  onClose,
}: {
  bot: Bot | undefined;
  files: Attachment[];
  onClose: () => void;
}) {
  return (
    <div className="flex h-full min-h-0 flex-col">
      <header className="flex h-12 shrink-0 items-center gap-2 border-b px-4">
        <h2 className="flex-1 text-base font-medium">Details</h2>
        <ActionHint label="Close details">
          <Button size="icon-sm" variant="ghost" aria-label="Close details" onClick={onClose}>
            <XIcon />
          </Button>
        </ActionHint>
      </header>
      <div className="min-h-0 flex-1 space-y-6 overflow-y-auto p-4">
        {bot && (
          <section aria-label="Bot" className="space-y-3">
            <div className="flex items-center gap-3">
              <BotAvatar bot={bot} size={40} square />
              <div className="min-w-0">
                <p className="truncate text-sm font-semibold">{bot.name}</p>
                <p className="text-xs text-muted-foreground">
                  {bot.kind === "chief" ? "Your chief" : "Specialist"} ·{" "}
                  {bot.visibility === "private" ? "Private" : "Team"}
                </p>
              </div>
            </div>
            <BotStatusLabel botId={bot.id} />
            <BotWork botId={bot.id} />
            {bot.description && (
              <p className="text-sm text-pretty text-muted-foreground">{bot.description}</p>
            )}
            {bot.canEdit && (
              <Link
                to="/bots/$botId/settings"
                params={{ botId: bot.id }}
                className="inline-flex h-8 items-center gap-2 rounded-md border border-input bg-card px-3 text-sm font-medium hover:bg-accent focus-visible:outline-2 focus-visible:outline-ring"
              >
                <GearSixIcon aria-hidden="true" className="size-4" />
                Bot settings
              </Link>
            )}
          </section>
        )}
        <section aria-labelledby="chat-files" className="space-y-2">
          <h3 id="chat-files" className="label-mono">
            Files in this chat
          </h3>
          {files.length === 0 ? (
            <p className="text-sm text-muted-foreground">No files in this chat yet.</p>
          ) : (
            <ul className="space-y-px">
              {files.map((f) => (
                <li key={f.id} className="flex h-8 items-center gap-2 rounded-md px-2 text-sm">
                  <PaperclipIcon
                    aria-hidden="true"
                    className="size-4 shrink-0 text-muted-foreground"
                  />
                  <span className="min-w-0 flex-1 truncate" title={f.name}>
                    {f.name}
                  </span>
                  <span className="shrink-0 text-xs text-muted-foreground tabular-nums">
                    {size(f.size)}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </section>
      </div>
    </div>
  );
}
