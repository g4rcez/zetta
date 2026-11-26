import { useQuery } from "@tanstack/react-query";
import {
  type AccountEngine,
  isAccountEngine,
  type SharedAccount,
} from "@zetta/core/engine-accounts";
import { Link } from "@tanstack/react-router";
import { useEffect, useState } from "react";

import { Button, Select } from "@/components/ui";
import { toast } from "@/lib/notify";

import { harnessOptions, modelOptions } from "../chat/bot-presets";
import { errorMessage } from "../chat/chat-client";
import {
  engineAccountsApi,
  engineAccountsQueries,
  type BotEngineChoice as Choice,
  type EngineAccount,
} from "./engine-accounts-api";

/** "Follow the bot": the engine and model its owner set. The Select adds an empty first option of its own, so this one has a value. */
const BOTS_OWN = "bot";
/** "My default account for this engine". */
const MY_DEFAULT = "default";
const engineChoices = harnessOptions.filter((o) => isAccountEngine(o.value));

type FormProps = { choice: Choice; accounts: EngineAccount[] };
function ChoiceForm({ choice, accounts }: FormProps) {
  const [engine, setEngine] = useState<string>(choice.harness ?? BOTS_OWN);
  const [model, setModel] = useState(choice.model ?? "");
  const [account, setAccount] = useState(choice.accountId ?? MY_DEFAULT);
  const [shared, setShared] = useState<SharedAccount>(choice.sharedAccount);
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    setEngine(choice.harness ?? BOTS_OWN);
    setModel(choice.model ?? "");
    setAccount(choice.accountId ?? MY_DEFAULT);
    setShared(choice.sharedAccount);
  }, [choice]);

  // The engine in use: the person's own choice, or the bot's.
  const used = engine === BOTS_OWN ? choice.default.harness : engine;
  const mine = accounts.filter((a) => a.engine === used && a.state === "active");
  const models = engine === BOTS_OWN ? [] : modelOptions(engine, null);
  const dirty =
    engine !== (choice.harness ?? BOTS_OWN) ||
    model !== (choice.model ?? "") ||
    account !== (choice.accountId ?? MY_DEFAULT) ||
    shared !== choice.sharedAccount;

  async function save() {
    setBusy(true);
    try {
      await engineAccountsApi.saveChoice(choice.botId, {
        harness: engine === BOTS_OWN ? null : (engine as AccountEngine),
        model: engine === BOTS_OWN || !model ? null : model,
        accountId: account === MY_DEFAULT || !mine.some((a) => a.id === account) ? null : account,
      });
      if (choice.owner && shared !== choice.sharedAccount)
        await engineAccountsApi.saveShared(choice.botId, shared);
      toast.success("Saved.");
    } catch (e) {
      toast.error(errorMessage(e));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="space-y-3">
      {!choice.owner && (
        <Select
          title="Engine"
          required={false}
          value={engine}
          onChange={(e) => {
            setEngine(e.target.value);
            setModel("");
            setAccount(MY_DEFAULT);
          }}
          options={[
            { value: BOTS_OWN, label: `The bot's own (${choice.default.harness})` },
            ...engineChoices,
          ]}
        />
      )}
      {!choice.owner && models.length > 1 && (
        <Select
          title="Model"
          required={false}
          value={model}
          onChange={(e) => setModel(e.target.value)}
          options={models}
        />
      )}
      <Select
        title="Account"
        required={false}
        value={mine.some((a) => a.id === account) ? account : MY_DEFAULT}
        onChange={(e) => setAccount(e.target.value)}
        options={[
          {
            value: MY_DEFAULT,
            label: mine.length ? "My account in use for this engine" : "No account of mine yet",
          },
          ...mine.map((a) => ({ value: a.id, label: a.label })),
        ]}
      />
      {mine.length === 0 && (
        <p className="text-xs text-pretty text-muted-foreground">
          You have no account for {used}.{" "}
          <Link to="/studio/$tab" params={{ tab: "accounts" }} className="underline">
            Connect one in Studio &gt; Accounts
          </Link>
          .
        </p>
      )}
      {choice.owner && (
        <div className="space-y-1">
          <Select
            title="In a room, this bot runs on"
            required={false}
            value={shared}
            onChange={(e) => setShared(e.target.value as SharedAccount)}
            options={[
              { value: "asker", label: "The account of whoever opened the room" },
              { value: "owner_in_rooms", label: "My account, for everyone in the room" },
            ]}
          />
          <p className="text-xs text-pretty text-muted-foreground">
            {shared === "owner_in_rooms"
              ? "People in a room with this bot need no account of their own for it. Their messages count against your limit."
              : "In a room the bot runs on the account of the person the room belongs to."}
          </p>
        </div>
      )}
      <Button type="button" size="sm" disabled={busy || !dirty} onClick={() => void save()}>
        Save
      </Button>
    </div>
  );
}

/**
 * The engine and account one person runs one bot on. The bot's owner sets its engine in the general settings and chooses here which
 * of their accounts runs it, and who pays in a room. Anyone else may run it on another engine, model and account of their own.
 */
export function BotEngineChoice({ botId }: { botId: string }) {
  const choice = useQuery(engineAccountsQueries.choice(botId));
  const list = useQuery(engineAccountsQueries.list());
  if (!choice.data || !list.data) return null;
  if (choice.data.ownerPays)
    return (
      <p className="text-xs text-pretty text-muted-foreground">
        This bot was shared with you as your Chief. It runs on its owner's engine and account, so
        you need no account of your own for it.
      </p>
    );
  return (
    <section aria-label="Engine and account for you" className="space-y-3">
      <header>
        <h3 className="text-sm font-medium">
          {choice.data.owner ? "Your account for this bot" : "Engine and account for you"}
        </h3>
        <p className="text-xs text-pretty text-muted-foreground">
          {choice.data.owner
            ? "Which of your accounts runs this bot, and whose account pays when it answers in a room."
            : "This bot is someone else's. You can run it on your own engine, model and account; its owner's choice is what you get otherwise."}
        </p>
      </header>
      <ChoiceForm choice={choice.data} accounts={list.data.accounts} />
    </section>
  );
}
