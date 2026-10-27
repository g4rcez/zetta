import { Bot as BotIcon, Pencil, Plus, Sparkles, Trash2 } from "lucide-react";
import { useCallback, useEffect, useState, type FormEvent } from "react";

import { Button, Input, Select, Textarea } from "@/components/ui";
import { errorMessage, type Bot } from "../chat/chat-client";
import { Badge, ConfirmButton, Empty, list, listItem, Modal } from "../shared/ui";
import {
  claudeApi,
  parseMarkdown,
  toRules,
  type ClaudeAsset,
  type ClaudeAssetInput,
  type ClaudeConfig,
  type ClaudeSettings,
} from "./claude-api";
import { Alert } from "@g4rcez/components/alert";

const EFFORT_OPTIONS = [
  { value: "", label: "Default" },
  ...["low", "medium", "high", "xhigh", "max"].map((v) => ({ value: v, label: v })),
];

/**
 * Bot settings > Agent settings. How this one bot runs Claude Code or Hermes: what it may do with code, extra allow/deny rules, an added system
 * prompt, effort and a budget per run, plus the skills and sub-agents installed for it alone. Other bots never see them.
 */
export function ClaudeSection({ bot, notify }: { bot: Bot; notify: (m: string) => void }) {
  const [data, setData] = useState<ClaudeSettings>();
  const [error, setError] = useState<string>();
  const reload = useCallback(async () => {
    try {
      setError(undefined);
      setData(await claudeApi.get(bot.id));
    } catch (e) {
      setError(errorMessage(e));
    }
  }, [bot.id]);
  useEffect(() => {
    setData(undefined);
    void reload();
  }, [reload]);

  if (bot.harness !== "claude-code" && bot.harness !== "hermes")
    return (
      <p className="text-xs text-muted-foreground">
        These settings apply when this bot uses the Claude Code or Hermes harness. Change the
        harness under General to use them.
      </p>
    );
  return (
    <section aria-label="Agent settings" className="space-y-6 text-sm">
      {error && <Alert theme="danger">{error}</Alert>}
      {!data && !error && <Empty>Loading...</Empty>}
      {data && (
        <>
          <PermissionsForm
            key={JSON.stringify(data.config)}
            bot={bot}
            data={data}
            notify={notify}
          />
          <Assets bot={bot} data={data} onChange={reload} notify={notify} />
        </>
      )}
    </section>
  );
}

function PermissionsForm({
  bot,
  data,
  notify,
}: {
  bot: Bot;
  data: ClaudeSettings;
  notify: (m: string) => void;
}) {
  const c = data.config;
  const [preset, setPreset] = useState(c.preset);
  const [effort, setEffort] = useState(c.effort ?? "");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string>();
  const hermes = data.harness === "hermes";
  const current = data.options.presets.find((p) => p.id === preset);
  async function submit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setBusy(true);
    setError(undefined);
    const f = new FormData(e.currentTarget);
    const dollars = String(f.get("budget") ?? "").trim();
    const next: ClaudeConfig = {
      preset,
      effort: effort || null,
      allow: toRules(String(f.get("allow") ?? "")),
      deny: toRules(String(f.get("deny") ?? "")),
      appendPrompt: String(f.get("appendPrompt") ?? ""),
      maxBudgetCents: dollars ? Math.round(Number(dollars) * 100) : null,
    };
    try {
      if (next.maxBudgetCents !== null && !(next.maxBudgetCents >= 1))
        throw new Error("Enter the budget in dollars, for example 2.50.");
      await claudeApi.save(bot.id, next);
      notify("Settings saved.");
    } catch (x) {
      setError(errorMessage(x));
    } finally {
      setBusy(false);
    }
  }
  return (
    <form onSubmit={(e) => void submit(e)} aria-label="Agent permissions" className="space-y-3">
      <Select
        title="What may it do with code?"
        required={false}
        value={preset}
        onChange={(e) => setPreset(e.target.value as ClaudeConfig["preset"])}
        options={data.options.presets.map((p) => ({ value: p.id, label: p.title }))}
      />
      <p className="text-xs text-muted-foreground">
        {current?.description}{" "}
        {!data.container && (preset === "auto" || preset === "full")
          ? "This server runs commands on the host, so only files and git are allowed for now."
          : ""}
        {!bot.codeAccess
          ? " Code access is off for this bot (see Code access), so these permissions do not apply until you turn it on."
          : ""}
      </p>
      <Textarea
        title={hermes ? "Also turn on these toolsets" : "Also allow"}
        name="allow"
        defaultValue={c.allow.join("\n")}
        rows={3}
        placeholder={hermes ? "vision\nbrowser" : "WebFetch\nBash(npm test:*)"}
      />
      <p className="-mt-2 text-xs text-muted-foreground">
        One per line.{" "}
        {hermes
          ? data.container
            ? "Any toolset works, because every run is inside a container."
            : "Without containers only harmless toolsets (web, vision, skills, todo...) are turned on."
          : data.container
            ? "Any tool or command pattern works, because every run is inside a container."
            : "Without containers only plain tools (WebFetch, WebSearch...) and git commands are honoured."}
      </p>
      <Textarea
        title={hermes ? "Always turn off these toolsets" : "Never allow"}
        name="deny"
        defaultValue={c.deny.join("\n")}
        rows={3}
        placeholder={hermes ? "web\nterminal" : "Bash(rm:*)\nWebFetch"}
      />
      <p className="-mt-2 text-xs text-muted-foreground">
        Always wins over everything above, and also applies when code access is off.
      </p>
      <Textarea
        title={hermes ? "Extra instructions for Hermes" : "Extra instructions for Claude Code"}
        name="appendPrompt"
        defaultValue={c.appendPrompt}
        rows={4}
        maxLength={data.options.limits.prompt}
      />
      <div className="grid gap-3 sm:grid-cols-2">
        <Select
          title="Effort"
          required={false}
          value={effort}
          onChange={(e) => setEffort(e.target.value)}
          options={EFFORT_OPTIONS}
        />
        {hermes ? (
          <input
            type="hidden"
            name="budget"
            value={c.maxBudgetCents ? (c.maxBudgetCents / 100).toFixed(2) : ""}
          />
        ) : (
          <Input
            title="Budget per run (USD)"
            name="budget"
            inputMode="decimal"
            defaultValue={c.maxBudgetCents ? (c.maxBudgetCents / 100).toFixed(2) : ""}
            placeholder="No limit"
          />
        )}
      </div>
      {error && (
        <p role="alert" className="text-xs text-destructive">
          {error}
        </p>
      )}
      <Button type="submit" size="sm" loading={busy} disabled={busy}>
        Save settings
      </Button>
    </form>
  );
}

function Assets({
  bot,
  data,
  onChange,
  notify,
}: {
  bot: Bot;
  data: ClaudeSettings;
  onChange: () => Promise<void>;
  notify: (m: string) => void;
}) {
  const [editing, setEditing] = useState<{ kind: "skill" | "agent"; asset?: ClaudeAsset }>();
  const [error, setError] = useState<string>();
  async function act(work: () => Promise<unknown>, done?: string) {
    setError(undefined);
    try {
      await work();
      if (done) notify(done);
      await onChange();
    } catch (e) {
      setError(errorMessage(e));
    }
  }
  const toggle = (a: ClaudeAsset) =>
    act(() => claudeApi.updateAsset(bot.id, a.id, { ...a, enabled: !a.enabled }));
  return (
    <div className="space-y-4">
      {error && <Alert theme="danger">{error}</Alert>}
      {data.harness === "hermes" && (
        <p className="text-xs text-muted-foreground">
          Hermes reads these skills as part of its prompt, so keep them short. Sub-agents and
          budgets only work with Claude Code.
        </p>
      )}
      {(["skill", "agent"] as const)
        .filter((kind) => kind === "skill" || data.harness !== "hermes")
        .map((kind) => {
          const rows = data.assets.filter((a) => a.kind === kind);
          const Icon = kind === "skill" ? Sparkles : BotIcon;
          return (
            <div key={kind} className="space-y-2">
              <div className="flex items-center justify-between gap-2">
                <h4 className="font-medium">
                  {kind === "skill" ? "Skills" : "Sub-agents"} installed for {bot.name}
                </h4>
                <Button
                  size="sm"
                  variant="outline"
                  type="button"
                  onClick={() => setEditing({ kind })}
                >
                  <Plus aria-hidden className="size-3.5" /> Add {kind}
                </Button>
              </div>
              {rows.length === 0 ? (
                <Empty>
                  {kind === "skill"
                    ? "No skills yet. A skill is a how-to the bot reads when the job matches, like a release checklist."
                    : "No sub-agents yet. A sub-agent is a helper with its own instructions that the bot can hand work to, like a code reviewer."}
                </Empty>
              ) : (
                <ul className={list}>
                  {rows.map((a) => (
                    <li key={a.id} className={`${listItem} flex items-start gap-3`}>
                      <Icon aria-hidden className="mt-0.5 size-4 shrink-0 text-muted-foreground" />
                      <span className="min-w-0 flex-1">
                        <span className="flex flex-wrap items-center gap-2">
                          <span className="truncate font-medium">{a.name}</span>
                          {!a.enabled && <Badge>Off</Badge>}
                          {a.model && a.model !== "inherit" && <Badge tone="info">{a.model}</Badge>}
                        </span>
                        <span className="line-clamp-2 block text-xs text-muted-foreground">
                          {a.description}
                        </span>
                      </span>
                      <span className="flex shrink-0 flex-wrap items-center justify-end gap-1">
                        <input
                          type="checkbox"
                          className="mr-1 size-4 accent-[var(--primary)]"
                          aria-label={`${a.name} is on`}
                          checked={a.enabled}
                          onChange={() => void toggle(a)}
                        />
                        <Button
                          size="xs"
                          variant="outline"
                          type="button"
                          aria-label={`Edit ${a.name}`}
                          onClick={() => setEditing({ kind, asset: a })}
                        >
                          <Pencil aria-hidden className="size-3" />
                        </Button>
                        <ConfirmButton
                          size="xs"
                          label="Remove"
                          question={`Remove ${a.name}?`}
                          confirmLabel="Remove"
                          variant="destructive"
                          onConfirm={() =>
                            act(() => claudeApi.removeAsset(bot.id, a.id), `${a.name} removed.`)
                          }
                        />
                      </span>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          );
        })}
      <p className="text-xs text-muted-foreground">
        <Trash2 aria-hidden className="mr-1 inline size-3" />
        Installed items belong to this bot only. Up to {data.options.limits.assetsPerKind} of each.
      </p>
      {editing && (
        <AssetDialog
          bot={bot}
          data={data}
          kind={editing.kind}
          asset={editing.asset}
          onClose={() => setEditing(undefined)}
          onSaved={async () => {
            notify(`${editing.kind === "skill" ? "Skill" : "Sub-agent"} saved.`);
            await onChange();
          }}
        />
      )}
    </div>
  );
}

function AssetDialog({
  bot,
  data,
  kind,
  asset,
  onClose,
  onSaved,
}: {
  bot: Bot;
  data: ClaudeSettings;
  kind: "skill" | "agent";
  asset?: ClaudeAsset | undefined;
  onClose: () => void;
  onSaved: () => Promise<void>;
}) {
  const [v, setV] = useState({
    name: asset?.name ?? "",
    description: asset?.description ?? "",
    body: asset?.body ?? "",
    tools: (asset?.tools ?? []).join(", "),
    model: asset?.model ?? "inherit",
  });
  const [paste, setPaste] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string>();
  const set = (k: keyof typeof v) => (e: { target: { value: string } }) =>
    setV((p) => ({ ...p, [k]: e.target.value }));
  function fill() {
    const p = parseMarkdown(paste);
    setV((cur) => ({
      name: p.name ?? cur.name,
      description: p.description ?? cur.description,
      body: p.body || cur.body,
      tools: p.tools ? p.tools.join(", ") : cur.tools,
      model: p.model && data.options.models.includes(p.model) ? p.model : cur.model,
    }));
    setPaste("");
  }
  async function submit(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(undefined);
    const input: ClaudeAssetInput = {
      kind,
      name: v.name.trim(),
      description: v.description.trim(),
      body: v.body,
      tools:
        kind === "agent"
          ? v.tools
              .split(",")
              .map((t) => t.trim())
              .filter(Boolean)
          : [],
      model: kind === "agent" ? v.model : null,
      enabled: asset?.enabled ?? true,
    };
    try {
      await (asset
        ? claudeApi.updateAsset(bot.id, asset.id, input)
        : claudeApi.addAsset(bot.id, input));
      await onSaved();
      onClose();
    } catch (x) {
      setError(errorMessage(x));
    } finally {
      setBusy(false);
    }
  }
  const noun = kind === "skill" ? "skill" : "sub-agent";
  return (
    <Modal title={`${asset ? "Edit" : "Add"} ${noun} for ${bot.name}`} onClose={onClose}>
      <form
        onSubmit={(e) => void submit(e)}
        className="space-y-3"
        aria-label={`${asset ? "Edit" : "Add"} ${noun}`}
      >
        {!asset && (
          <details className="rounded-md border px-3 py-2">
            <summary className="cursor-pointer text-xs font-medium">
              Import from a {kind === "skill" ? "SKILL.md" : "agent .md"} file
            </summary>
            <div className="mt-2 space-y-2">
              <Textarea
                title="Paste the file"
                value={paste}
                onChange={(e) => setPaste(e.target.value)}
                rows={5}
              />
              <Button
                type="button"
                size="sm"
                variant="outline"
                disabled={!paste.trim()}
                onClick={fill}
              >
                Fill the form
              </Button>
              <p className="text-xs text-muted-foreground">
                Only the name, description{kind === "agent" ? ", tools, model" : ""} and
                instructions are kept. Other settings in the file (hooks, permissions) are ignored.
              </p>
            </div>
          </details>
        )}
        <Input
          title="Name"
          value={v.name}
          onChange={set("name")}
          placeholder={kind === "skill" ? "release-notes" : "code-reviewer"}
          disabled={Boolean(asset)}
          autoComplete="off"
        />
        <Textarea
          title={
            kind === "skill" ? "When should it be used?" : "When should the bot hand work to it?"
          }
          value={v.description}
          onChange={set("description")}
          rows={2}
          maxLength={data.options.limits.description}
        />
        <Textarea
          title="Instructions"
          value={v.body}
          onChange={set("body")}
          rows={6}
          maxLength={data.options.limits.body}
        />
        {kind === "agent" && (
          <div className="grid gap-3 sm:grid-cols-2">
            <Input
              title="Tools it may use"
              value={v.tools}
              onChange={set("tools")}
              placeholder="Read, Grep (empty = same as the bot)"
            />
            <Select
              title="Model"
              required={false}
              value={v.model}
              onChange={set("model")}
              options={data.options.models.map((m) => ({ value: m, label: m }))}
            />
          </div>
        )}
        {error && <Alert theme="danger">{error}</Alert>}
        <div className="flex justify-end gap-2">
          <Button type="button" variant="outline" size="sm" onClick={onClose}>
            Cancel
          </Button>
          <Button
            type="submit"
            size="sm"
            loading={busy}
            disabled={busy || !v.name.trim() || !v.description.trim() || !v.body.trim()}
          >
            {asset ? "Save" : "Install"}
          </Button>
        </div>
      </form>
    </Modal>
  );
}
