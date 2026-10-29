import { useEffect, useState, type FormEvent, type ReactNode } from "react";
import { Drawer } from "@/components/drawer";
import { Button, Input, Select, Textarea } from "@/components/ui";

import { BotAvatarPicker } from "./bot-avatar-picker";
import { BotAccounts } from "./bot-accounts";
import { BotDecision } from "./bot-decision";
import { BotHooks } from "./bot-hooks";
import { harnessOptions, isAllowedModel, modelOptions } from "./bot-presets";
import { registeredBotSections, type BotSection } from "./bot-sections";
import "../bot-database/register"; // every bot has a database, so its tab is always part of the settings
import "../claude/register"; // per-bot Claude Code permissions, skills and sub-agents
import {
  chatClient,
  errorMessage,
  type Bot,
  type BotAvatarValue,
  type BotPatch,
  type Workspace,
} from "./chat-client";

const UNGROUPED = "__ungrouped";

type Common = {
  bot: Bot;
  bots: Bot[];
  spaces: Workspace[];
  onBotChange: (b: Bot) => void;
  notify: (m: string) => void;
};

/** Saves a subset of fields; each tab owns its own form so switching tabs never loses another tab's draft. */
function useSave(bot: Bot, onBotChange: (b: Bot) => void, notify: (m: string) => void) {
  const [error, setError] = useState<string>();
  const [saving, setSaving] = useState(false);
  async function save(patch: BotPatch) {
    setError(undefined);
    setSaving(true);
    try {
      onBotChange(await chatClient.updateBot(bot.id, bot.version, patch));
      notify("Saved. Chat with the bot again to confirm it is ready.");
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setSaving(false);
    }
  }
  return { error, setError, saving, save };
}

function Card({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section aria-label={title} className="space-y-3 rounded-lg border bg-card p-4">
      <h3 className="font-medium">{title}</h3>
      {children}
    </section>
  );
}

function GeneralTab({ bot, spaces, onBotChange, notify }: Common) {
  const { error, setError, saving, save } = useSave(bot, onBotChange, notify);
  const [harness, setHarness] = useState(bot.harness);
  const [model, setModel] = useState(bot.model ?? "");
  useEffect(() => {
    setHarness(bot.harness);
    setModel(bot.model ?? "");
  }, [bot.id, bot.version]);
  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const data = new FormData(event.currentTarget);
    void save({
      name: String(data.get("name") ?? "").trim() || bot.name,
      description: String(data.get("description") ?? ""),
      harness: String(data.get("harness") ?? "fixture"),
      model: String(data.get("model") ?? "").trim() || null,
    });
  }
  return (
    <Card title="General">
      <form key={`${bot.id}-${bot.version}`} onSubmit={submit} className="space-y-3">
        <Input title="Name" name="name" defaultValue={bot.name} maxLength={80} required />
        <Input
          title="Description"
          name="description"
          defaultValue={bot.description}
          maxLength={2048}
          placeholder="What is this bot good at?"
        />
        <Select
          title="Harness"
          required={false}
          name="harness"
          value={harness}
          onChange={(e) => {
            setHarness(e.target.value);
            if (!isAllowedModel(e.target.value, model)) setModel("");
          }}
          options={harnessOptions}
        />
        {harness !== "fixture" && (
          <Select
            title="Model"
            required={false}
            name="model"
            value={model}
            onChange={(e) => setModel(e.target.value)}
            options={modelOptions(harness, bot.harness === harness ? bot.model : null)}
          />
        )}
        <Button type="submit" size="sm" disabled={saving}>
          Save general settings
        </Button>
        {error && (
          <p role="alert" className="text-xs text-destructive">
            {error}
          </p>
        )}
      </form>
      {spaces.length > 0 && (
        <Select
          title="Workspace"
          required={false}
          value={bot.workspaceId ?? UNGROUPED}
          onChange={(e) =>
            void chatClient
              .moveBot(bot.id, e.target.value === UNGROUPED ? null : e.target.value)
              .then(
                (b) => onBotChange({ ...bot, workspaceId: b.workspaceId }),
                (x) => setError(errorMessage(x)),
              )
          }
          options={[
            { value: UNGROUPED, label: "Ungrouped" },
            ...spaces.map((w) => ({ value: w.id, label: w.name })),
          ]}
        />
      )}
    </Card>
  );
}

function AvatarTab({ bot, onBotChange, notify }: Common) {
  const { error, saving, save } = useSave(bot, onBotChange, notify);
  const [draft, setDraft] = useState<BotAvatarValue | null>(bot.avatar ?? null);
  return (
    <Card title="Picture">
      <BotAvatarPicker botId={bot.id} kind={bot.kind} value={draft} onChange={setDraft} />
      <Button
        type="button"
        size="sm"
        disabled={saving || JSON.stringify(draft) === JSON.stringify(bot.avatar ?? null)}
        onClick={() => void save({ avatar: draft })}
      >
        Save picture
      </Button>
      {error && (
        <p role="alert" className="text-xs text-destructive">
          {error}
        </p>
      )}
    </Card>
  );
}

function PersonalityTab({ bot, onBotChange, notify }: Common) {
  const { error, saving, save } = useSave(bot, onBotChange, notify);
  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const data = new FormData(event.currentTarget);
    void save({
      personality: String(data.get("personality") ?? ""),
      instructions: String(data.get("instructions") ?? ""),
    });
  }
  return (
    <Card title="Personality">
      <form key={`${bot.id}-${bot.version}`} onSubmit={submit} className="space-y-3">
        <Textarea
          title="Personality"
          name="personality"
          defaultValue={bot.personality}
          rows={5}
          maxLength={4096}
        />
        <Textarea
          title="Instructions"
          name="instructions"
          defaultValue={bot.instructions}
          rows={9}
          maxLength={16384}
        />
        <Button type="submit" size="sm" disabled={saving}>
          Save personality
        </Button>
        {error && (
          <p role="alert" className="text-xs text-destructive">
            {error}
          </p>
        )}
      </form>
    </Card>
  );
}

/** Stacked body body of the settings drawer. Non-owners only see the accounts they need to connect. */
export function BotSettings(props: Common & { extraSections?: BotSection[] }) {
  const { bot, bots, onBotChange, notify } = props;
  const extras = [...registeredBotSections(), ...(props.extraSections ?? [])];
  if (!bot.canEdit)
    return (
      <div className="text-sm">
        <BotAccounts bot={bot} onBotChange={onBotChange} />
      </div>
    );
  return (
    <div className="min-w-0 text-sm">
      <div className="space-y-4">
        <GeneralTab {...props} />
        <AvatarTab key={`${bot.id}-${bot.version}`} {...props} />
        <PersonalityTab {...props} />
        <BotAccounts bot={bot} onBotChange={onBotChange} />
        <BotHooks bot={bot} />
        <BotDecision bot={bot} bots={bots} />
        {extras.map((s) => (
          <Card key={s.id} title={s.title}>
            {s.render({ bot, bots, onBotChange, notify })}
          </Card>
        ))}
      </div>
    </div>
  );
}

export function BotSettingsDrawer({
  open,
  onClose,
  extraSections,
  ...rest
}: Common & { open: boolean; onClose: () => void; extraSections?: BotSection[] }) {
  return (
    <Drawer
      open={open}
      onClose={onClose}
      title={rest.bot.canEdit ? `${rest.bot.name} settings` : `Accounts for ${rest.bot.name}`}
      description="Configure this bot"
    >
      <BotSettings {...rest} {...(extraSections ? { extraSections } : {})} />
    </Drawer>
  );
}
