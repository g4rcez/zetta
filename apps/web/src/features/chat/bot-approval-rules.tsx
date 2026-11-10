import { useEffect, useState } from "react";

import { Button } from "@/components/ui";
import { Empty, Loading } from "../shared/ui";
import { chatClient, errorMessage, type ApprovalRule, type Bot } from "./chat-client";

/** The changes this bot may make without a card, because the person chose "Always allow" on one. Each can be taken back. */
export function BotApprovalRules({ bot, notify }: { bot: Bot; notify: (m: string) => void }) {
  const [rules, setRules] = useState<ApprovalRule[]>();
  const [error, setError] = useState<string>();
  useEffect(() => {
    let live = true;
    chatClient
      .approvalRules(bot.id)
      .then((r) => live && setRules(r))
      .catch((e) => live && setError(errorMessage(e)));
    return () => {
      live = false;
    };
  }, [bot.id]);
  async function revoke(rule: ApprovalRule) {
    try {
      await chatClient.revokeApprovalRule(rule.id);
      setRules((l) => l?.filter((r) => r.id !== rule.id));
      notify(`${bot.name} asks again before: ${rule.label}.`);
    } catch (e) {
      setError(errorMessage(e));
    }
  }
  if (error)
    return (
      <p role="alert" className="text-sm text-destructive">
        {error}
      </p>
    );
  if (!rules) return <Loading />;
  if (!rules.length)
    return (
      <Empty>
        Nothing yet. When {bot.name} asks for approval, "Always allow" on the card adds that kind of
        change here.
      </Empty>
    );
  return (
    <ul className="divide-y divide-border rounded-md border border-border">
      {rules.map((r) => (
        <li key={r.id} className="flex items-center justify-between gap-3 px-3 py-2 text-sm">
          <span className="min-w-0 truncate">
            {r.label}
            {r.conversationId ? (
              <span className="text-muted-foreground"> · in one chat</span>
            ) : null}
          </span>
          <Button size="xs" variant="ghost" onClick={() => void revoke(r)}>
            Ask again
          </Button>
        </li>
      ))}
    </ul>
  );
}
