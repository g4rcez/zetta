import {
  ArrowLeftIcon,
  ArrowSquareOutIcon,
  UserIcon,
  UsersThreeIcon,
  type Icon,
} from "@phosphor-icons/react";
import { Alert } from "@g4rcez/components/alert";
import { Link, useNavigate } from "@tanstack/react-router";
import { useEffect, useMemo, useState, type FormEvent } from "react";

import { BotAvatar } from "@/components/bot-avatar";
import { Button } from "@/components/ui";
import { chatClient, errorMessage, type Bot } from "../chat/chat-client";
import { ConfirmButton, Empty, Loading, Panel } from "../shared/ui";
import { ComposioConnect } from "./composio-connect";
import { GoogleConnect } from "./google-connect";
import { FieldInput, probeKey, StatusBadge, useProbes, type Probe } from "./plugin-parts";
import { PluginIcon } from "./plugin-icon";
import {
  CATEGORY_LABEL,
  PluginScopeProvider,
  pluginsApiFor,
  usePluginApi,
  usePlugins,
  usePluginScope,
  type PluginMeta,
  type PluginScope,
} from "./plugins-api";
import { RedditConnect } from "./reddit-connect";
import { TelegramConnect, TelegramInstall } from "./telegram";
import { ToggleCard } from "./toggle-card";
import { VaultGrants } from "./vault-grants";
import { WhatsappInstall } from "./whatsapp-install";
import { WhatsappPairing } from "./whatsapp-pairing";

const settingsText = (meta: PluginMeta, scope: PluginScope) =>
  `Saved values are stored encrypted for ${scope === "team" ? "the whole workspace" : "your account"} and never shown again. Leave a field blank to keep it.${meta.auth === "oauth" ? " Changing these disconnects the account; connect again afterwards." : ""}`;

/** Generic install form: the plugin's fields and the bots that may use it. */
function InstallForm({
  meta,
  bots,
  onCancel,
  onDone,
}: {
  meta: PluginMeta;
  bots: Bot[];
  onCancel: () => void;
  onDone: () => void;
}) {
  const pluginsApi = usePluginApi();
  const scope = usePluginScope();
  const [chosen, setChosen] = useState<Set<string>>(new Set());
  const [busy, setBusy] = useState(false);
  const [local, setLocal] = useState<string>();
  async function submit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const f = new FormData(e.currentTarget);
    const config: Record<string, string> = {};
    for (const field of meta.fields) config[field.key] = String(f.get(field.key) ?? "").trim();
    setBusy(true);
    setLocal(undefined);
    try {
      await pluginsApi.install(meta.id, config, [...chosen]);
      onDone();
    } catch (x) {
      setLocal(errorMessage(x));
    } finally {
      setBusy(false);
    }
  }
  return (
    <Panel
      title={`Install ${meta.name}${scope === "team" ? " for the team" : ""}`}
      {...(scope === "team"
        ? {
            description: `One configuration for the whole workspace: every member's bots can use it with every tool, through this one account.`,
          }
        : {})}
    >
      <form
        onSubmit={(e) => void submit(e)}
        className="space-y-3 text-sm"
        aria-label={`Install ${meta.name}`}
      >
        {meta.transport === "stdio" && (
          <p className="text-xs text-muted-foreground">
            Runs on the Zetta server through a fixed, pre-approved command. You cannot change it.
          </p>
        )}
        {!meta.verified && <Alert theme="warn">Not fully verified. {meta.notes}</Alert>}
        {meta.verified && meta.notes && (
          <p className="text-xs text-muted-foreground">{meta.notes}</p>
        )}
        {meta.fields.map((f) => (
          <FieldInput key={f.key} field={f} />
        ))}
        {meta.fields.some((f) => f.secret) && (
          <p className="text-xs text-muted-foreground">
            Stored encrypted for {scope === "team" ? "the workspace" : "your account only"}. It is
            never shown again.
          </p>
        )}
        {bots.length > 0 && (
          <fieldset className="space-y-2">
            <legend className="mb-1 text-xs font-medium">Let these bots use it (optional)</legend>
            {bots.map((b) => (
              <ToggleCard
                key={b.id}
                leading={<BotAvatar bot={b} size={40} />}
                title={b.name}
                description={b.description}
                label={`${b.name} can use ${meta.name}`}
                checked={chosen.has(b.id)}
                onChange={(on) =>
                  setChosen((s) => {
                    const n = new Set(s);
                    if (on) n.add(b.id);
                    else n.delete(b.id);
                    return n;
                  })
                }
              />
            ))}
          </fieldset>
        )}
        {local && <Alert theme="danger">{local}</Alert>}
        <div className="flex justify-end gap-2">
          <Button type="button" variant="outline" size="sm" onClick={onCancel}>
            Cancel
          </Button>
          <Button type="submit" size="sm" loading={busy} disabled={busy}>
            Install
          </Button>
        </div>
      </form>
    </Panel>
  );
}

/** Edits the user's own settings. Stored values are never sent back, so a blank field keeps what is saved. */
function SettingsForm({ meta, onSaved }: { meta: PluginMeta; onSaved: () => void }) {
  const pluginsApi = usePluginApi();
  const scope = usePluginScope();
  const [busy, setBusy] = useState(false);
  const [local, setLocal] = useState<string>();
  const [saved, setSaved] = useState(false);
  async function submit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const form = e.currentTarget;
    const f = new FormData(form);
    const config: Record<string, string> = {};
    for (const field of meta.fields) config[field.key] = String(f.get(field.key) ?? "").trim();
    setBusy(true);
    setLocal(undefined);
    setSaved(false);
    try {
      await pluginsApi.configure(meta.id, config);
      form.reset();
      setSaved(true);
      onSaved();
    } catch (x) {
      setLocal(errorMessage(x));
    } finally {
      setBusy(false);
    }
  }
  return (
    <Panel title="Settings" description={settingsText(meta, scope)}>
      <form
        onSubmit={(e) => void submit(e)}
        className="space-y-3 text-sm"
        aria-label={`${meta.name} settings`}
      >
        {meta.fields.map((f) => (
          <FieldInput key={f.key} field={f} editing />
        ))}
        {local && <Alert theme="danger">{local}</Alert>}
        {saved && <Alert theme="success">Saved.</Alert>}
        <div className="flex justify-end">
          <Button type="submit" size="sm" loading={busy} disabled={busy}>
            Save
          </Button>
        </div>
      </form>
    </Panel>
  );
}

/** Which bots may use this configuration of the plugin. Changes are saved as you toggle. */
function BotsSection({
  meta,
  bots,
  onError,
}: {
  meta: PluginMeta;
  bots: Bot[];
  onError: (m: string) => void;
}) {
  const pluginsApi = usePluginApi();
  const scope = usePluginScope();
  // Per bot: whether this configuration is on, and whether the other one is on too (then the bot asks which to use).
  const [bound, setBound] = useState<Record<string, { on: boolean; other: boolean }>>();
  useEffect(() => {
    Promise.all(
      bots.map(async (b) => {
        const { configs } = await pluginsApi.botPlugins(b.id);
        const mine = configs.filter((c) => c.id === meta.id);
        return [
          b.id,
          {
            on: mine.some((c) => c.scope === scope),
            other: mine.some((c) => c.scope !== scope),
          },
        ] as const;
      }),
    ).then(
      (r) => setBound(Object.fromEntries(r)),
      (e) => onError(errorMessage(e)),
    );
  }, [bots, meta.id, scope, pluginsApi, onError]);
  async function toggle(id: string, on: boolean) {
    try {
      await pluginsApi.setBound(id, meta.id, on);
      setBound((s) => ({ ...s, [id]: { on, other: s?.[id]?.other ?? false } }));
    } catch (e) {
      onError(errorMessage(e));
    }
  }
  return (
    <Panel
      title="Bots"
      description={`Choose which of your bots may use ${scope === "team" ? "the team's" : "your own"} ${meta.name}. Changes are saved as you toggle.`}
    >
      {!bound ? (
        <Empty>Loading...</Empty>
      ) : bots.length === 0 ? (
        <Empty>You have no bots yet.</Empty>
      ) : (
        <ul className="space-y-2">
          {bots.map((b) => {
            const detail = [
              b.kind === "chief" ? "Chief" : "Specialist",
              b.visibility === "team" ? "Team" : "Private",
              b.model,
              bound[b.id]?.on && bound[b.id]?.other
                ? `Also uses ${scope === "team" ? "your own" : "the team's"} ${meta.name}: it asks which one to use`
                : undefined,
            ].filter(Boolean);
            return (
              <li key={b.id}>
                <ToggleCard
                  leading={<BotAvatar bot={b} size={40} />}
                  title={b.name}
                  description={b.description}
                  detail={detail.join(" · ")}
                  label={`${b.name} can use ${meta.name}`}
                  checked={Boolean(bound[b.id]?.on)}
                  onChange={(on) => void toggle(b.id, on)}
                />
              </li>
            );
          })}
        </ul>
      )}
    </Panel>
  );
}

/** What is already set up: connection status, the plugin's own connect flow, sharing and the tools it gives bots. */
function ConnectionSection({
  meta,
  canManage,
  probe,
  onTest,
  onPair,
  onError,
}: {
  meta: PluginMeta;
  /** The user's own configuration, or the team's when they are the administrator. Members only see the team's status. */
  canManage: boolean;
  probe?: Probe | undefined;
  onTest: () => void;
  onPair: () => void;
  onError: (m: string) => void;
}) {
  const p = probe === "loading" ? undefined : probe;
  return (
    <Panel
      title="Connection"
      action={
        <span className="flex items-center gap-2">
          <StatusBadge probe={probe} />
          <Button size="sm" variant="outline" onClick={onTest}>
            Test connection
          </Button>
          {meta.id === "whatsapp" && canManage && (
            <Button size="sm" variant="outline" onClick={onPair}>
              Pair
            </Button>
          )}
        </span>
      }
    >
      <div className="space-y-3 text-sm">
        {p?.status.detail && (
          <p className={p.status.state === "connected" ? "text-primary" : "text-destructive"}>
            {p.status.detail}
          </p>
        )}
        {canManage && meta.id === "telegram" && (
          <TelegramConnect probe={p} onChanged={onTest} onError={onError} />
        )}
        {canManage && meta.id === "google" && (
          <GoogleConnect probe={p} onChanged={onTest} onError={onError} />
        )}
        {canManage && meta.id === "reddit" && (
          <RedditConnect probe={p} onChanged={onTest} onError={onError} />
        )}
        {canManage && meta.id === "composio" && (
          <ComposioConnect probe={p} onChanged={onTest} onError={onError} />
        )}
        {canManage && meta.credentials && (
          <VaultGrants
            pluginId={meta.id}
            name={meta.name}
            probe={p}
            onChanged={onTest}
            onError={onError}
          />
        )}
        {p && p.tools.length > 0 && (
          <details open className="text-xs">
            <summary className="cursor-pointer font-medium">{p.tools.length} tools</summary>
            <ul className="mt-1 max-h-48 space-y-0.5 overflow-auto">
              {p.tools.map((t) => (
                <li key={t.name}>
                  <code>{t.name}</code>{" "}
                  <span className="text-muted-foreground">{t.description}</span>
                </li>
              ))}
            </ul>
          </details>
        )}
      </div>
    </Panel>
  );
}

/** Individual / Shared switch: the plugin can be set up for you alone or once for the whole workspace. */
function ScopeSwitch({
  scope,
  onChange,
  haveMine,
  haveTeam,
}: {
  scope: PluginScope;
  onChange: (s: PluginScope) => void;
  haveMine: boolean;
  haveTeam: boolean;
}) {
  const options: { value: PluginScope; label: string; have: boolean; hint: string; icon: Icon }[] =
    [
      {
        value: "mine",
        label: "Individual",
        have: haveMine,
        icon: UserIcon,
        hint: "Your own account. Only you and your bots can use it.",
      },
      {
        value: "team",
        label: "Shared",
        have: haveTeam,
        icon: UsersThreeIcon,
        hint: "One configuration set up by the administrator, used by every member's bots.",
      },
    ];
  return (
    <div role="group" aria-label="Configuration" className="grid gap-2 sm:grid-cols-2">
      {options.map((o) => {
        const active = scope === o.value;
        return (
          <button
            key={o.value}
            type="button"
            aria-pressed={active}
            onClick={() => onChange(o.value)}
            className={`flex items-start gap-3 rounded-lg border p-3 text-left transition-colors ${active ? "border-primary bg-primary/10" : "border-border hover:bg-muted/50"}`}
          >
            <o.icon
              size={24}
              weight={active ? "fill" : "regular"}
              className={active ? "text-primary" : "text-muted-foreground"}
            />
            <span className="min-w-0 flex-1 space-y-0.5">
              <span className="flex items-center gap-2 font-medium">
                {o.label}
                {o.have && (
                  <span className="rounded bg-success/15 px-1 text-xs font-normal text-success">
                    Set up
                  </span>
                )}
              </span>
              <span className="block text-xs text-muted-foreground">{o.hint}</span>
            </span>
          </button>
        );
      })}
    </div>
  );
}

/** One plugin: install it, or (once installed) check, configure and remove it, for yourself (Individual) or for the workspace (Shared). */
export function PluginPage({ pluginId, isAdmin }: { pluginId: string; isAdmin: boolean }) {
  const navigate = useNavigate();
  const [error, setError] = useState<string>();
  const [bots, setBots] = useState<Bot[]>([]);
  const [pairing, setPairing] = useState(false);
  const [picked, setPicked] = useState<PluginScope>();
  const { catalog, installed, reload } = usePlugins(setError);
  const { probes, probe, forget } = useProbes();
  useEffect(() => {
    chatClient
      .bots()
      .then(setBots)
      .catch((e) => setError(errorMessage(e)));
  }, []);
  const meta = catalog?.find((c) => c.id === pluginId);
  const mine = installed?.find((i) => i.id === pluginId && i.sharing === "private");
  const team = installed?.find((i) => i.id === pluginId && i.sharing === "team");
  // Opens on the configuration that exists: yours first, then the team's.
  const scope: PluginScope = picked ?? (!mine && team ? "team" : "mine");
  const current = scope === "team" ? team : mine;
  const canManage = scope === "mine" || isAdmin;
  const api = useMemo(() => pluginsApiFor(scope), [scope]);
  // Remote and native plugins are checked on arrival; local commands (npx) only when asked, since a check starts the process.
  useEffect(() => {
    if (current && meta?.transport !== "stdio" && !probes[probeKey(pluginId, scope)])
      void probe(pluginId, scope);
  }, [current, meta, probes, pluginId, scope, probe]);

  const toList = () => void navigate({ to: "/studio/$tab", params: { tab: "plugins" } });
  async function remove() {
    try {
      await api.remove(pluginId);
      forget(pluginId, scope);
      await reload();
      if (!(scope === "mine" ? team : mine)) toList();
    } catch (e) {
      setError(errorMessage(e));
    }
  }

  return (
    <div className="h-full overflow-y-auto">
      <div className="mx-auto w-full max-w-3xl space-y-5 p-4 md:p-8">
        <Link
          to="/studio/$tab"
          params={{ tab: "plugins" }}
          className="inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground"
        >
          <ArrowLeftIcon aria-hidden className="size-4" /> All plugins
        </Link>
        {error && <Alert theme="danger">{error}</Alert>}
        {catalog === undefined || installed === undefined ? (
          <Loading />
        ) : !meta ? (
          <Empty>No plugin named “{pluginId}”.</Empty>
        ) : (
          <PluginScopeProvider value={scope}>
            <header className="flex items-start gap-3 border-b pb-5">
              <PluginIcon id={meta.id} name={meta.icon} className="size-10 shrink-0" />
              <div className="min-w-0 flex-1">
                <h1 className="flex flex-wrap items-center gap-2 text-2xl text-balance">
                  {meta.name}
                  <span className="rounded bg-muted px-1.5 py-0.5 text-xs font-normal text-muted-foreground">
                    {CATEGORY_LABEL[meta.category] ?? meta.category}
                  </span>
                  {meta.always && (
                    <span className="rounded bg-primary/15 px-1.5 py-0.5 text-xs font-normal text-primary">
                      Built in
                    </span>
                  )}
                </h1>
                <p className="text-sm text-pretty text-muted-foreground">{meta.description}</p>
                {meta.docsUrl && (
                  <a
                    href={meta.docsUrl}
                    target="_blank"
                    rel="noreferrer noopener"
                    className="mt-1 inline-flex items-center gap-1 text-xs underline"
                  >
                    Docs <ArrowSquareOutIcon aria-hidden className="size-3" />
                  </a>
                )}
              </div>
            </header>
            {meta.always ? (
              <p className="text-sm text-muted-foreground">
                {meta.notes ?? "Built in, on for every bot."}
              </p>
            ) : (
              <>
                <ScopeSwitch
                  scope={scope}
                  onChange={setPicked}
                  haveMine={Boolean(mine)}
                  haveTeam={Boolean(team)}
                />
                {!current ? (
                  !canManage ? (
                    <Empty>The administrator has not set up {meta.name} for the team yet.</Empty>
                  ) : meta.id === "telegram" ? (
                    <TelegramInstall
                      meta={meta}
                      bots={bots}
                      onClose={toList}
                      onDone={() => void reload()}
                    />
                  ) : meta.id === "whatsapp" ? (
                    <WhatsappInstall
                      meta={meta}
                      bots={bots}
                      onClose={toList}
                      onInstalled={() => {
                        void reload();
                        setPairing(true);
                      }}
                    />
                  ) : (
                    <InstallForm
                      meta={meta}
                      bots={bots}
                      onCancel={toList}
                      onDone={() => void reload()}
                    />
                  )
                ) : (
                  <>
                    {scope === "team" && !canManage && (
                      <p className="text-xs text-muted-foreground">
                        Set up by the administrator for the whole workspace. Your bots can use it
                        with every tool; only the administrator can change it.
                      </p>
                    )}
                    <ConnectionSection
                      meta={meta}
                      canManage={canManage}
                      probe={probes[probeKey(pluginId, scope)]}
                      onTest={() => void probe(pluginId, scope)}
                      onPair={() => setPairing(true)}
                      onError={setError}
                    />
                    {canManage && meta.fields.length > 0 && (
                      <SettingsForm meta={meta} onSaved={() => void probe(pluginId, scope)} />
                    )}
                    <BotsSection meta={meta} bots={bots} onError={setError} />
                    {canManage && (
                      <Panel
                        title="Remove"
                        description={
                          scope === "team"
                            ? `Disconnects ${meta.name} from every member's bots and deletes the team's saved settings.`
                            : `Disconnects ${meta.name} from every bot and deletes its saved settings.`
                        }
                      >
                        <ConfirmButton
                          label="Remove"
                          question={`Remove ${scope === "team" ? "the team's " : ""}${meta.name}?`}
                          confirmLabel="Remove"
                          onConfirm={remove}
                        />
                      </Panel>
                    )}
                  </>
                )}
              </>
            )}
          </PluginScopeProvider>
        )}
      </div>
      {pairing && (
        <WhatsappPairing
          onClose={() => setPairing(false)}
          onPaired={() => void probe("whatsapp", scope)}
        />
      )}
    </div>
  );
}
