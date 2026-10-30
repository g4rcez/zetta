import { Link, useNavigate } from "@tanstack/react-router";
import { ArrowLeftIcon } from "@phosphor-icons/react";
import { useEffect, useState } from "react";
import { toast } from "sonner";

import { BotIdentity } from "@/components/bot-identity";
import { call, chatClient, type Bot } from "../chat/chat-client";
import { CopyButton } from "../chat/chat-copy";
import { ago } from "../artifacts/artifacts-api";
import { ConfirmButton, Empty } from "../shared/ui";
import { knowledgeError, type Instruction } from "./knowledge";

/** One saved instruction: its steps, when to use it, how to check it, and who wrote it. Archived ones are not listed, so they show as missing. */
export function InstructionPage({ id }: { id: string }) {
  const navigate = useNavigate();
  const [item, setItem] = useState<Instruction | null>();
  const [bot, setBot] = useState<Bot>();
  const [team, setTeam] = useState<string>();

  useEffect(() => {
    setItem(undefined);
    call<{ instructions: Instruction[] }>("/api/instructions").then(
      (r) => setItem(r.instructions.find((i) => i.id === id) ?? null),
      () => setItem(null),
    );
  }, [id]);
  const botId = item?.createdByBotId;
  useEffect(() => {
    if (botId)
      chatClient.bots().then(
        (all) => setBot(all.find((b) => b.id === botId)),
        () => {},
      );
  }, [botId]);
  const teamId = item?.teamId;
  useEffect(() => {
    if (teamId)
      call<{ teams: { id: string; name: string }[] }>("/api/teams").then(
        (r) => setTeam(r.teams.find((t) => t.id === teamId)?.name ?? "a team"),
        () => setTeam("a team"),
      );
  }, [teamId]);

  const archive = (i: Instruction) =>
    call(`/api/instructions/${i.id}`, "PATCH", { expectedVersion: i.version, archived: true }).then(
      () => void navigate({ to: "/studio/$tab", params: { tab: "instructions" } }),
      (e) => void toast.error(knowledgeError(e)),
    );

  return (
    <div className="h-full overflow-y-auto">
      <div className="mx-auto flex w-full max-w-3xl flex-col gap-5 p-4 md:p-8">
        <Link
          to="/studio/$tab"
          params={{ tab: "instructions" }}
          className="inline-flex w-fit items-center gap-1 text-sm text-muted-foreground hover:text-foreground"
        >
          <ArrowLeftIcon aria-hidden="true" className="size-4" />
          Instructions
        </Link>
        {item === undefined ? (
          <p className="text-sm text-muted-foreground">Loading…</p>
        ) : item === null ? (
          <Empty>This instruction does not exist or was archived.</Empty>
        ) : (
          <>
            <header className="flex flex-wrap items-start gap-x-6 gap-y-3">
              <div className="min-w-0 flex-1 space-y-1">
                <h1 className="break-words text-lg">{item.title}</h1>
                <p className="text-xs text-muted-foreground">
                  {item.teamId ? `Team: ${team ?? "…"}` : "All my bots"} ·{" "}
                  <time dateTime={item.createdAt} title={new Date(item.createdAt).toLocaleString()}>
                    {ago(item.createdAt)}
                  </time>
                </p>
              </div>
              {item.createdByBotId && (
                <BotIdentity
                  bot={bot ?? { id: item.createdByBotId, name: "Deleted bot" }}
                  size={32}
                  sub="Author"
                  className="w-48"
                />
              )}
            </header>
            <div className="flex flex-wrap items-center gap-2">
              <CopyButton text={window.location.href} label="Copy link" />
              <Link
                to="/studio/$tab"
                params={{ tab: "instructions" }}
                className="inline-flex items-center gap-1.5 rounded-md border px-3 py-1.5 text-sm hover:bg-muted"
              >
                Edit in Studio
              </Link>
              <span className="ml-auto">
                <ConfirmButton
                  label="Archive"
                  question="Archive this instruction?"
                  confirmLabel="Archive"
                  onConfirm={() => archive(item)}
                />
              </span>
            </div>
            <section aria-label="Steps" className="rounded-lg border bg-card p-4">
              <p className="whitespace-pre-wrap break-words text-sm">{item.body}</p>
            </section>
            {item.trigger && (
              <p className="break-words text-sm text-muted-foreground">Use when: {item.trigger}</p>
            )}
            {item.verification && (
              <p className="break-words text-sm text-muted-foreground">
                Check: {item.verification}
              </p>
            )}
          </>
        )}
      </div>
    </div>
  );
}
