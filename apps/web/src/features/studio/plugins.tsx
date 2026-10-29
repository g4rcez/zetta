import { ExternalLink } from "lucide-react";
import { useCallback, useEffect, useMemo, useState, type FormEvent } from "react";

import { BotAvatar } from "@/components/bot-avatar";
import { Button, Input, Textarea } from "@/components/ui";
import { errorMessage, type Bot } from "../chat/chat-client";
import { GoogleConnect } from "../plugins/google-connect";
import { PluginIcon } from "../plugins/plugin-icon";
import { RedditConnect } from "../plugins/reddit-connect";
import { TelegramConnect, TelegramInstall } from "../plugins/telegram";
import { VaultGrants } from "../plugins/vault-grants";
import { ToggleCard } from "../plugins/toggle-card";
import { WhatsappInstall } from "../plugins/whatsapp-install";
import { WhatsappPairing } from "../plugins/whatsapp-pairing";
import {
  CATEGORY_LABEL,
  pluginsApi,
  usePlugins,
  type PluginMeta,
  type PluginTest,
} from "../plugins/plugins-api";
import { ConfirmButton, Empty, Modal } from "../shared/ui";
import { Alert } from "@g4rcez/components/alert";

type Probe = PluginTest | "loading";

function StatusBadge({ probe }: { probe?: Probe }) {
  if (!probe)
    return (
      <span className="rounded bg-muted px-1.5 py-0.5 text-xs text-muted-foreground">
        Not tested
      </span>
    );
  if (probe === "loading")
    return (
      <span role="status" className="rounded bg-muted px-1.5 py-0.5 text-xs text-muted-foreground">
        Checking...
      </span>
    );
  const { state } = probe.status;
  const label =
    state === "connected" ? "Connected" : state === "needs-auth" ? "Needs sign-in" : "Error";
  return (
    <span
      title={probe.status.detail}
      className={`rounded px-1.5 py-0.5 text-xs ${state === "connected" ? "bg-primary/15 text-primary" : "bg-destructive/10 text-destructive"}`}
    >
      {label}
    </span>
  );
}

function InstallDialog({
  meta,
  bots,
  onClose,
  onDone,
}: {
  meta: PluginMeta;
  bots: Bot[];
  onClose: () => void;
  onDone: () => void;
}) {
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
      onClose();
    } catch (x) {
      setLocal(errorMessage(x));
    } finally {
      setBusy(false);
    }
  }
  return (
    <Modal title={`Install ${meta.name}`} onClose={onClose}>
      <form
        onSubmit={(e) => void submit(e)}
        className="space-y-3"
        aria-label={`Install ${meta.name}`}
      >
        <p className="text-muted-foreground">{meta.description}</p>
        {meta.transport === "stdio" && (
          <p className="text-xs text-muted-foreground">
            Runs on the Zetta server through a fixed, pre-approved command. You cannot change it.
          </p>
        )}
        {!meta.verified && <Alert theme="warn">Not fully verified. {meta.notes}</Alert>}
        {meta.verified && meta.notes && (
          <p className="text-xs text-muted-foreground">{meta.notes}</p>
        )}
        {meta.fields.map((f) =>
          f.kind === "textarea" ? (
            <Textarea
              key={f.key}
              title={f.label}
              name={f.key}
              required={!f.optional}
              placeholder={f.placeholder}
              info={f.help}
            />
          ) : (
            <Input
              key={f.key}
              title={f.label}
              name={f.key}
              required={!f.optional}
              placeholder={f.placeholder}
              info={f.help}
              type={
                f.secret || f.kind === "password" ? "password" : f.kind === "url" ? "url" : "text"
              }
              autoComplete="off"
            />
          ),
        )}
        {meta.fields.some((f) => f.secret) && (
          <p className="text-xs text-muted-foreground">
            Stored encrypted for your account only. It is never shown again.
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
        <div className="flex items-center justify-between gap-2">
          {meta.docsUrl ? (
            <a
              href={meta.docsUrl}
              target="_blank"
              rel="noreferrer noopener"
              className="inline-flex items-center gap-1 text-xs underline"
            >
              Docs <ExternalLink aria-hidden className="size-3" />
            </a>
          ) : (
            <span />
          )}
          <span className="flex gap-2">
            <Button type="button" variant="outline" size="sm" onClick={onClose}>
              Cancel
            </Button>
            <Button type="submit" size="sm" loading={busy} disabled={busy}>
              Install
            </Button>
          </span>
        </div>
      </form>
    </Modal>
  );
}

/** Edits the user's own settings of an installed plugin. Stored values are never sent back, so a blank field keeps what is saved. */
function SettingsDialog({
  meta,
  onClose,
  onDone,
}: {
  meta: PluginMeta;
  onClose: () => void;
  onDone: () => void;
}) {
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
      await pluginsApi.configure(meta.id, config);
      onDone();
      onClose();
    } catch (x) {
      setLocal(errorMessage(x));
    } finally {
      setBusy(false);
    }
  }
  return (
    <Modal title={`${meta.name} settings`} onClose={onClose}>
      <form
        onSubmit={(e) => void submit(e)}
        className="space-y-3"
        aria-label={`${meta.name} settings`}
      >
        <p className="text-xs text-muted-foreground">
          Saved values are stored encrypted for your account and never shown again. Leave a field
          blank to keep it.
          {meta.auth === "oauth"
            ? " Changing these disconnects the account; connect again afterwards."
            : ""}
        </p>
        {meta.fields.map((f) =>
          f.kind === "textarea" ? (
            <Textarea
              key={f.key}
              title={f.label}
              name={f.key}
              placeholder={f.placeholder}
              info={f.help}
            />
          ) : (
            <Input
              key={f.key}
              title={f.label}
              name={f.key}
              placeholder={f.placeholder}
              info={f.help}
              type={
                f.secret || f.kind === "password" ? "password" : f.kind === "url" ? "url" : "text"
              }
              autoComplete="off"
            />
          ),
        )}
        {local && <Alert theme="danger">{local}</Alert>}
        <div className="flex justify-end gap-2">
          <Button type="button" variant="outline" size="sm" onClick={onClose}>
            Cancel
          </Button>
          <Button type="submit" size="sm" loading={busy} disabled={busy}>
            Save
          </Button>
        </div>
      </form>
    </Modal>
  );
}

function BotsDialog({
  meta,
  bots,
  onClose,
  onError,
}: {
  meta: PluginMeta;
  bots: Bot[];
  onClose: () => void;
  onError: (m: string) => void;
}) {
  const [bound, setBound] = useState<Record<string, boolean>>();
  useEffect(() => {
    Promise.all(
      bots.map(async (b) => [b.id, (await pluginsApi.botPlugins(b.id)).includes(meta.id)] as const),
    ).then(
      (r) => setBound(Object.fromEntries(r)),
      (e) => onError(errorMessage(e)),
    );
  }, [bots, meta.id, onError]);
  async function toggle(id: string, on: boolean) {
    try {
      await pluginsApi.setBound(id, meta.id, on);
      setBound((s) => ({ ...s, [id]: on }));
    } catch (e) {
      onError(errorMessage(e));
    }
  }
  return (
    <Modal title={`Bots using ${meta.name}`} onClose={onClose}>
      <p className="text-xs text-muted-foreground">
        Choose which bots may use {meta.name}. Changes are saved as you toggle.
      </p>
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
            ].filter(Boolean);
            return (
              <li key={b.id}>
                <ToggleCard
                  leading={<BotAvatar bot={b} size={40} />}
                  title={b.name}
                  description={b.description}
                  detail={detail.join(" · ")}
                  label={`${b.name} can use ${meta.name}`}
                  checked={Boolean(bound[b.id])}
                  onChange={(on) => void toggle(b.id, on)}
                />
              </li>
            );
          })}
        </ul>
      )}
      <div className="flex items-center justify-between gap-2">
        <span className="text-xs text-muted-foreground">
          {bound
            ? `${Object.values(bound).filter(Boolean).length} of ${bots.length} bots enabled`
            : ""}
        </span>
        <Button size="sm" variant="outline" onClick={onClose}>
          Done
        </Button>
      </div>
    </Modal>
  );
}

/** Studio > Plugins: installed plugins and MCP servers (status, tools, bots, remove) and the catalog to install more. */
export function Plugins({ bots, onError }: { bots: Bot[]; onError: (m: string) => void }) {
  const { catalog, installed, reload } = usePlugins(onError);
  const [probes, setProbes] = useState<Record<string, Probe>>({});
  const [query, setQuery] = useState("");
  const [category, setCategory] = useState("all");
  const [installing, setInstalling] = useState<PluginMeta>();
  const [botsFor, setBotsFor] = useState<PluginMeta>();
  const [settingsFor, setSettingsFor] = useState<PluginMeta>();
  const [toolsFor, setToolsFor] = useState<string>();
  const [pairing, setPairing] = useState(false);
  const byId = useMemo(() => new Map((catalog ?? []).map((c) => [c.id, c])), [catalog]);
  const installedIds = useMemo(() => new Set((installed ?? []).map((i) => i.id)), [installed]);

  const probe = useCallback(async (id: string) => {
    setProbes((p) => ({ ...p, [id]: "loading" }));
    try {
      const r = await pluginsApi.test(id);
      setProbes((p) => ({ ...p, [id]: r }));
    } catch (e) {
      setProbes((p) => ({
        ...p,
        [id]: { status: { state: "error", detail: errorMessage(e) }, tools: [] },
      }));
    }
  }, []);
  // Remote and native plugins are checked automatically; local commands (npx) only when asked, since a check starts the process.
  useEffect(() => {
    for (const i of installed ?? [])
      if (byId.get(i.id)?.transport !== "stdio" && !probes[i.id]) void probe(i.id);
  }, [installed, byId, probes, probe]);

  const categories = useMemo(
    () => ["all", ...new Set((catalog ?? []).map((c) => c.category))],
    [catalog],
  );
  const shown = (catalog ?? []).filter(
    (c) =>
      (category === "all" || c.category === category) &&
      `${c.name} ${c.description} ${c.id}`.toLowerCase().includes(query.trim().toLowerCase()),
  );
  async function remove(id: string) {
    try {
      await pluginsApi.remove(id);
      setProbes((prev) => {
        prev[id] = undefined as any;
        return { ...prev };
      });
      setToolsFor(undefined);
      await reload();
    } catch (e) {
      onError(errorMessage(e));
    }
  }

  return (
    <div className="space-y-6">
      <section aria-label="Installed plugins" className="space-y-3">
        <h3 className="font-medium">Installed</h3>
        {(catalog ?? [])
          .filter((m) => m.always)
          .map((m) => (
            <div
              key={m.id}
              className="flex flex-wrap items-center gap-3 rounded-lg border bg-card p-4"
            >
              <PluginIcon id={m.id} name={m.icon} className="size-6 shrink-0" />
              <div className="min-w-0 flex-1">
                <p className="font-medium">
                  {m.name}{" "}
                  <span className="rounded bg-primary/15 px-1.5 py-0.5 text-xs text-primary">
                    Built in
                  </span>
                </p>
                <p className="text-xs text-muted-foreground">{m.notes ?? m.description}</p>
              </div>
            </div>
          ))}
        {installed === undefined ? (
          <Empty>Loading...</Empty>
        ) : installed.length === 0 ? (
          <Empty>Nothing installed yet. Pick one from the catalog below.</Empty>
        ) : (
          <ul className="space-y-2">
            {installed.map((i) => {
              const m = byId.get(i.id);
              if (!m) return null;
              const p = probes[i.id];
              return (
                <li key={i.id} className="rounded-lg border bg-card p-4">
                  <div className="flex flex-wrap items-center gap-3">
                    <PluginIcon id={i.id} name={m.icon} className="size-6 shrink-0" />
                    <div className="min-w-0 flex-1">
                      <p className="font-medium">
                        {m.name} <StatusBadge probe={p} />
                      </p>
                      <p className="truncate text-xs text-muted-foreground">{m.description}</p>
                      {p && p !== "loading" && p.status.detail && (
                        <p
                          className={`text-xs ${p.status.state === "connected" ? "text-primary" : "text-destructive"}`}
                        >
                          {p.status.detail}
                        </p>
                      )}
                    </div>
                    <div className="flex flex-wrap gap-1">
                      <Button
                        size="sm"
                        variant="outline"
                        onClick={() => {
                          void probe(i.id);
                          setToolsFor(i.id);
                        }}
                      >
                        Test connection
                      </Button>
                      {i.id === "whatsapp" && (
                        <Button size="sm" variant="outline" onClick={() => setPairing(true)}>
                          Pair
                        </Button>
                      )}
                      {m.fields.length > 0 && (
                        <Button size="sm" variant="outline" onClick={() => setSettingsFor(m)}>
                          Settings
                        </Button>
                      )}
                      <Button size="sm" variant="outline" onClick={() => setBotsFor(m)}>
                        Bots
                      </Button>
                      <ConfirmButton
                        label="Remove"
                        question={`Remove ${m.name}?`}
                        confirmLabel="Remove"
                        onConfirm={() => remove(i.id)}
                      />
                    </div>
                  </div>
                  {i.id === "telegram" && (
                    <TelegramConnect
                      probe={p === "loading" ? undefined : p}
                      onChanged={() => void probe(i.id)}
                      onError={onError}
                    />
                  )}
                  {i.id === "google" && (
                    <GoogleConnect
                      probe={p === "loading" ? undefined : p}
                      onChanged={() => void probe(i.id)}
                      onError={onError}
                    />
                  )}
                  {i.id === "reddit" && (
                    <RedditConnect
                      probe={p === "loading" ? undefined : p}
                      onChanged={() => void probe(i.id)}
                      onError={onError}
                    />
                  )}
                  {m.credentials && (
                    <VaultGrants
                      pluginId={i.id}
                      name={m.name}
                      probe={p === "loading" ? undefined : p}
                      onChanged={() => void probe(i.id)}
                      onError={onError}
                    />
                  )}
                  {toolsFor === i.id && p && p !== "loading" && p.tools.length > 0 && (
                    <details open className="mt-3 text-xs">
                      <summary className="cursor-pointer font-medium">
                        {p.tools.length} tools
                      </summary>
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
                </li>
              );
            })}
          </ul>
        )}
      </section>

      <section aria-label="Plugin catalog" className="space-y-3">
        <h3 className="font-medium">Catalog</h3>
        <div className="flex flex-wrap items-end gap-3">
          <Input
            title="Search"
            container="min-w-48 flex-1"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Sentry, GitHub, browser..."
          />
          <div role="group" aria-label="Category" className="flex flex-wrap gap-1">
            {categories.map((c) => (
              <Button
                key={c}
                size="sm"
                variant={category === c ? "default" : "outline"}
                aria-pressed={category === c}
                onClick={() => setCategory(c)}
              >
                {c === "all" ? "All" : (CATEGORY_LABEL[c] ?? c)}
              </Button>
            ))}
          </div>
        </div>
        {catalog === undefined ? (
          <Empty>Loading...</Empty>
        ) : shown.length === 0 ? (
          <Empty>No plugins match.</Empty>
        ) : (
          <ul className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
            {shown.map((m) => (
              <li key={m.id} className="flex flex-col gap-2 rounded-lg border bg-card p-4">
                <div className="flex items-center gap-2">
                  <PluginIcon id={m.id} name={m.icon} className="size-6" />
                  <span className="font-medium">{m.name}</span>
                  <span className="ml-auto rounded bg-muted px-1.5 py-0.5 text-xs text-muted-foreground">
                    {CATEGORY_LABEL[m.category] ?? m.category}
                  </span>
                </div>
                <p className="flex-1 text-xs text-muted-foreground">{m.description}</p>
                {!m.verified && (
                  <p className="text-xs text-amber-700 dark:text-amber-300">Not fully verified</p>
                )}
                <div className="flex items-center justify-between gap-2">
                  {m.docsUrl ? (
                    <a
                      href={m.docsUrl}
                      target="_blank"
                      rel="noreferrer noopener"
                      className="inline-flex items-center gap-1 text-xs underline"
                    >
                      Docs <ExternalLink aria-hidden className="size-3" />
                    </a>
                  ) : (
                    <span />
                  )}
                  {m.always ? (
                    <span className="text-xs text-muted-foreground">
                      Built in, on for every bot
                    </span>
                  ) : installedIds.has(m.id) ? (
                    <span className="text-xs text-muted-foreground">Installed</span>
                  ) : (
                    <Button size="sm" onClick={() => setInstalling(m)}>
                      Install
                    </Button>
                  )}
                </div>
              </li>
            ))}
          </ul>
        )}
      </section>

      {installing &&
        (installing.id === "telegram" ? (
          <TelegramInstall
            meta={installing}
            bots={bots}
            onClose={() => setInstalling(undefined)}
            onDone={() => void reload()}
          />
        ) : installing.id === "whatsapp" ? (
          <WhatsappInstall
            meta={installing}
            bots={bots}
            onClose={() => setInstalling(undefined)}
            onInstalled={() => {
              void reload();
              setPairing(true);
            }}
          />
        ) : (
          <InstallDialog
            meta={installing}
            bots={bots}
            onClose={() => setInstalling(undefined)}
            onDone={() => void reload()}
          />
        ))}
      {pairing && (
        <WhatsappPairing
          onClose={() => setPairing(false)}
          onPaired={() => void probe("whatsapp")}
        />
      )}
      {settingsFor && (
        <SettingsDialog
          meta={settingsFor}
          onClose={() => setSettingsFor(undefined)}
          onDone={() => void probe(settingsFor.id)}
        />
      )}
      {botsFor && (
        <BotsDialog
          meta={botsFor}
          bots={bots}
          onClose={() => setBotsFor(undefined)}
          onError={onError}
        />
      )}
    </div>
  );
}
