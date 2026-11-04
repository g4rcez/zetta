import { useEffect, useRef, useState } from "react";
import { Button, Input, Select } from "@/components/ui";

import {
  chatClient,
  errorMessage,
  type Bot,
  type BotPatch,
  type CommitIdentity,
} from "../chat/chat-client";

const OPTIONS = [
  { value: "on", label: "On" },
  { value: "off", label: "Off" },
];

/** The bot's own commit address, as the server writes it (`Code Reviewer` is `code_reviewer@zettabot.app`). */
const botAddress = (name: string) =>
  `${
    name
      .normalize("NFKD")
      .replace(/\p{M}/gu, "")
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "_")
      .replace(/^_+|_+$/g, "")
      .slice(0, 64)
      .replace(/_+$/, "") || "bot"
  }@zettabot.app`;

const HELP: Record<CommitIdentity, string> = {
  "git-config":
    "Commits use the git name and email configured on the server. If it has none, they use the bot address.",
  bot: "Commits use the bot's name and its own address.",
  account: "Commits use your Zetta account name and email. They show in the repository history.",
  custom: "Commits use the bot's name and the email below.",
};

/** Owner-controlled "Code access" capability of a bot (on by default), and who its commits are signed as. Mount it inside the bot settings. */
export function BotCodeSection({
  bot,
  onBotChange,
}: {
  bot: Bot;
  onBotChange?: (bot: Bot) => void;
}) {
  const [on, setOn] = useState(bot.codeAccess ?? true);
  const [identity, setIdentity] = useState<CommitIdentity>(bot.commitIdentity ?? "git-config");
  const [email, setEmail] = useState(bot.commitEmail ?? "");
  const [status, setStatus] = useState<string>();
  const [busy, setBusy] = useState(false);
  const version = useRef(bot.version);
  useEffect(() => {
    setOn(bot.codeAccess ?? true);
    setIdentity(bot.commitIdentity ?? "git-config");
    setEmail(bot.commitEmail ?? "");
    version.current = bot.version;
  }, [bot.codeAccess, bot.commitIdentity, bot.commitEmail, bot.version]);
  async function save(patch: BotPatch, undo: () => void, ok: string) {
    setBusy(true);
    setStatus(undefined);
    try {
      const updated = await chatClient.updateBot(bot.id, version.current, patch);
      version.current = updated.version;
      onBotChange?.(updated);
      setStatus(ok);
    } catch (e) {
      undo();
      setStatus(errorMessage(e));
    }
    setBusy(false);
  }
  function change(next: boolean) {
    const previous = on;
    setOn(next);
    return save(
      { codeAccess: next },
      () => setOn(previous),
      next ? "Code access saved." : "Code access is off.",
    );
  }
  function changeIdentity(next: CommitIdentity) {
    const previous = identity;
    setIdentity(next);
    // A custom email is saved with its own button, once it is typed.
    if (next === "custom") return;
    return save({ commitIdentity: next }, () => setIdentity(previous), "Commit identity saved.");
  }
  const locked = busy || !bot.canEdit;
  return (
    <section aria-label="Code access" className="space-y-2">
      <Select
        title="Code access"
        required={false}
        value={on ? "on" : "off"}
        disabled={locked}
        onChange={(e) => void change(e.target.value === "on")}
        options={OPTIONS}
      />
      <p className="text-xs text-muted-foreground">
        {on
          ? "This bot can clone repositories, read and edit code, run git, create branches, commit and push in your own persistent code directory. For private repositories and pushes, add a GitHub account under Accounts and require it for this bot."
          : "This bot cannot run git or touch code."}
        {!bot.canEdit ? " Only the owner can change this." : ""}
      </p>
      {on && (
        <>
          <Select
            title="Commit as"
            required={false}
            value={identity}
            disabled={locked}
            onChange={(e) => void changeIdentity(e.target.value as CommitIdentity)}
            options={[
              { value: "git-config", label: "Server git config (default)" },
              { value: "bot", label: `This bot (${botAddress(bot.name)})` },
              { value: "account", label: "My account email" },
              { value: "custom", label: "Custom email" },
            ]}
          />
          {identity === "custom" && (
            <div className="flex items-end gap-2">
              <Input
                title="Commit email"
                type="email"
                required={false}
                value={email}
                disabled={locked}
                maxLength={254}
                placeholder="you@example.com"
                onChange={(e) => setEmail(e.target.value)}
              />
              <Button
                disabled={locked || !/^\S+@\S+\.\S+$/.test(email.trim())}
                onClick={() =>
                  void save(
                    { commitIdentity: "custom", commitEmail: email.trim() },
                    () => {},
                    "Commit identity saved.",
                  )
                }
              >
                Save
              </Button>
            </div>
          )}
          <p className="text-xs text-muted-foreground">{HELP[identity]}</p>
        </>
      )}
      <p role="status" className="text-xs empty:hidden">
        {status}
      </p>
    </section>
  );
}
