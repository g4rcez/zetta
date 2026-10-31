import { Alert } from "@g4rcez/components/alert";
import { ArrowSquareOutIcon, CheckCircleIcon } from "@phosphor-icons/react";
import { Link } from "@tanstack/react-router";
import { useCallback, useEffect, useMemo, useRef, useState, type FormEvent } from "react";

import { Button } from "@/components/ui";
import { ComposioConnect } from "../plugins/composio-connect";
import { GoogleConnect } from "../plugins/google-connect";
import { PluginIcon } from "../plugins/plugin-icon";
import { FieldInput, StatusBadge } from "../plugins/plugin-parts";
import {
  PluginScopeProvider,
  pluginsApiFor,
  type InstalledPlugin,
  type PluginMeta,
  type PluginTest,
} from "../plugins/plugins-api";
import { RedditConnect } from "../plugins/reddit-connect";
import { TelegramConnect } from "../plugins/telegram";
import { VaultGrants } from "../plugins/vault-grants";
import { WhatsappPairing } from "../plugins/whatsapp-pairing";
import { errorMessage } from "./chat-client";
import { useSetupActions } from "./setup-actions";
import { linkParts, type SetupCardData } from "./setup-card-data";

const POLL_MS = 3000;

type Live = {
  meta: PluginMeta;
  installed: InstalledPlugin | undefined;
  /** Undefined until the plugin is installed. */
  probe: PluginTest | undefined;
  bound: boolean;
};

/** A guide step with its web addresses drawn as links (they leave the app, so they open in a new tab). */
function Step({ text }: { text: string }) {
  return (
    <li>
      {linkParts(text).map((p, i) =>
        p.href ? (
          <a
            key={i}
            href={p.href}
            target="_blank"
            rel="noopener noreferrer"
            className="break-all underline"
          >
            {p.text}
          </a>
        ) : (
          <span key={i}>{p.text}</span>
        ),
      )}
    </li>
  );
}

/**
 * The fields of a plugin, typed by the person and sent straight to the server. They never pass through the chat or the model.
 * `install` creates the plugin for this bot; `edit` replaces saved values (a blank field keeps the stored one).
 */
function Fields({
  meta,
  mode,
  data,
  onDone,
}: {
  meta: PluginMeta;
  mode: "install" | "edit";
  data: SetupCardData;
  onDone: () => void;
}) {
  const api = useMemo(() => pluginsApiFor(data.scope), [data.scope]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string>();
  // An OAuth plugin cannot connect without its client keys, so the card asks for them even though the schema allows blanks.
  const fields = useMemo(
    () =>
      meta.fields.map((f) =>
        meta.auth === "oauth" && f.kind !== "select" ? { ...f, optional: false } : f,
      ),
    [meta],
  );
  async function submit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const f = new FormData(e.currentTarget);
    const config: Record<string, string> = {};
    for (const field of meta.fields) config[field.key] = String(f.get(field.key) ?? "").trim();
    setBusy(true);
    setError(undefined);
    try {
      if (mode === "install") await api.install(meta.id, config, [data.botId]);
      else await api.configure(meta.id, config);
      onDone();
    } catch (x) {
      setError(errorMessage(x));
    } finally {
      setBusy(false);
    }
  }
  return (
    <form onSubmit={(e) => void submit(e)} className="space-y-3" aria-label={`${meta.name} keys`}>
      {fields.map((f) => (
        <FieldInput key={f.key} field={f} editing={mode === "edit"} />
      ))}
      {fields.some((f) => f.secret) && (
        <p className="text-xs text-muted-foreground">
          Stored encrypted for {data.scope === "team" ? "the workspace" : "your account only"} and
          never shown again. It does not go through the chat.
        </p>
      )}
      {error && <Alert theme="danger">{error}</Alert>}
      <div className="flex justify-end">
        <Button type="submit" size="sm" loading={busy} disabled={busy}>
          {mode === "install" ? "Install" : "Save"}
        </Button>
      </div>
    </form>
  );
}

/**
 * A setup the bot asked for: shows where the plugin stands (always read live from the server, never from the reply), walks the person
 * through keys, sign-in and pairing, switches the plugin on for the bot, and then tells the bot in the chat that it is done.
 */
export function SetupCard({ data }: { data: SetupCardData }) {
  const actions = useSetupActions();
  const api = useMemo(() => pluginsApiFor(data.scope), [data.scope]);
  const [live, setLive] = useState<Live>();
  const [error, setError] = useState<string>();
  const [pairing, setPairing] = useState(false);
  const [binding, setBinding] = useState(false);
  // Set once the card saw the plugin not ready. Only then does reaching "ready" mean the person just finished it, so an old card never talks again.
  const worked = useRef(false);
  const said = useRef(false);

  const load = useCallback(async () => {
    try {
      const [catalog, installedList, configs] = await Promise.all([
        api.catalog(),
        api.installed(),
        api.botPlugins(data.botId),
      ]);
      const meta = catalog.find((c) => c.id === data.plugin);
      if (!meta) throw new Error(`There is no plugin named ${data.plugin}.`);
      const sharing = data.scope === "team" ? "team" : "private";
      const installed = installedList.find((i) => i.id === meta.id && i.sharing === sharing);
      const probe = installed ? await api.test(meta.id) : undefined;
      setLive({
        meta,
        installed,
        probe,
        bound: configs.configs.some((c) => c.id === meta.id && c.scope === data.scope),
      });
      setError(undefined);
    } catch (e) {
      setError(errorMessage(e));
    }
  }, [api, data.botId, data.plugin, data.scope]);

  useEffect(() => {
    void load();
  }, [load]);

  const state = live?.probe?.status.state;
  const ready = Boolean(live && live.installed && state === "connected" && live.bound);

  // The sign-in happens in another tab or a dialog: look again while the person is away, and as soon as they come back.
  const waiting = Boolean(
    live?.installed && (state === "needs-auth" || (state === "connected" && !live?.bound)),
  );
  useEffect(() => {
    if (!waiting) return;
    const tick = () => {
      if (document.visibilityState === "visible") void load();
    };
    const t = setInterval(tick, POLL_MS);
    document.addEventListener("visibilitychange", tick);
    return () => {
      clearInterval(t);
      document.removeEventListener("visibilitychange", tick);
    };
  }, [waiting, load]);

  useEffect(() => {
    if (!live) return;
    if (!ready) {
      worked.current = true;
      return;
    }
    if (worked.current && !said.current && actions) {
      said.current = true;
      actions.say(`${live.meta.name} is set up and connected to this bot.`);
    }
  }, [live, ready, actions]);

  async function bind() {
    if (!live) return;
    setBinding(true);
    try {
      await api.setBound(data.botId, live.meta.id, true);
      await load();
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setBinding(false);
    }
  }

  if (!live)
    return (
      <div className="rounded-lg border p-3 text-sm text-muted-foreground" role="status">
        {error ? <Alert theme="danger">{error}</Alert> : "Loading the setup..."}
      </div>
    );
  const { meta, installed, probe } = live;
  const onChanged = () => void load();

  return (
    <PluginScopeProvider value={data.scope}>
      <section
        aria-label={`Set up ${meta.name}`}
        className="my-1 space-y-3 rounded-lg border bg-card p-3 text-sm"
      >
        <header className="flex items-center gap-2">
          <PluginIcon id={meta.id} name={meta.icon} className="size-7 shrink-0" />
          <h3 className="min-w-0 flex-1 font-medium">
            Set up {meta.name}
            {data.scope === "team" ? " for the team" : ""}
          </h3>
          <StatusBadge probe={probe} />
        </header>
        {error && <Alert theme="danger">{error}</Alert>}
        {ready ? (
          <p className="flex items-center gap-1.5 text-primary">
            <CheckCircleIcon aria-hidden className="size-4" />
            {meta.name} is connected and this bot can use it.
          </p>
        ) : (
          <>
            {meta.guide.length > 0 ? (
              <ol className="list-decimal space-y-1 pl-5 text-xs text-muted-foreground">
                {meta.guide.map((g, i) => (
                  <Step key={i} text={g} />
                ))}
              </ol>
            ) : (
              meta.notes && <p className="text-xs text-muted-foreground">{meta.notes}</p>
            )}
            {!installed ? (
              meta.fields.length > 0 ? (
                <Fields meta={meta} mode="install" data={data} onDone={onChanged} />
              ) : (
                <InstallOnly meta={meta} data={data} onDone={onChanged} />
              )
            ) : (
              <>
                {probe?.status.detail && state !== "connected" && (
                  <p className="text-destructive">{probe.status.detail}</p>
                )}
                {state === "needs-auth" && meta.id === "google" && (
                  <GoogleConnect
                    probe={probe}
                    onChanged={onChanged}
                    onError={setError}
                    newTab
                    {...(data.scopes && { initialScopes: data.scopes })}
                  />
                )}
                {state === "needs-auth" && meta.id === "reddit" && (
                  <RedditConnect probe={probe} onChanged={onChanged} onError={setError} />
                )}
                {state === "needs-auth" && meta.id === "composio" && (
                  <ComposioConnect probe={probe} onChanged={onChanged} onError={setError} />
                )}
                {meta.id === "telegram" && state !== "error" && (
                  <TelegramConnect probe={probe} onChanged={onChanged} onError={setError} />
                )}
                {state === "needs-auth" && meta.id === "whatsapp" && (
                  <Button size="sm" onClick={() => setPairing(true)}>
                    Show the QR code
                  </Button>
                )}
                {meta.credentials && (
                  <VaultGrants
                    pluginId={meta.id}
                    name={meta.name}
                    probe={probe}
                    onChanged={onChanged}
                    onError={setError}
                  />
                )}
                {state === "connected" && !live.bound && (
                  <Button
                    size="sm"
                    onClick={() => void bind()}
                    loading={binding}
                    disabled={binding}
                  >
                    Let this bot use {meta.name}
                  </Button>
                )}
                {meta.fields.length > 0 && (
                  <details className="text-xs">
                    <summary className="cursor-pointer text-muted-foreground">
                      {state === "error" ? "Fix the saved keys" : "Change the saved keys"}
                    </summary>
                    <div className="mt-2">
                      <Fields meta={meta} mode="edit" data={data} onDone={onChanged} />
                    </div>
                  </details>
                )}
              </>
            )}
          </>
        )}
        <footer className="flex flex-wrap items-center gap-3 text-xs text-muted-foreground">
          <Link to="/plugins/$pluginId" params={{ pluginId: meta.id }} className="underline">
            Open all {meta.name} settings
          </Link>
          {meta.docsUrl && (
            <a
              href={meta.docsUrl}
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex items-center gap-1 underline"
            >
              Docs <ArrowSquareOutIcon aria-hidden className="size-3" />
            </a>
          )}
        </footer>
        {pairing && (
          <WhatsappPairing onClose={() => setPairing(false)} onPaired={() => void load()} />
        )}
      </section>
    </PluginScopeProvider>
  );
}

/** Plugins with no keys (a fixed command or an open endpoint): one button installs it for this bot. */
function InstallOnly({
  meta,
  data,
  onDone,
}: {
  meta: PluginMeta;
  data: SetupCardData;
  onDone: () => void;
}) {
  const api = useMemo(() => pluginsApiFor(data.scope), [data.scope]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string>();
  async function go() {
    setBusy(true);
    setError(undefined);
    try {
      await api.install(meta.id, {}, [data.botId]);
      onDone();
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setBusy(false);
    }
  }
  return (
    <div className="space-y-2">
      {error && <Alert theme="danger">{error}</Alert>}
      <Button size="sm" onClick={() => void go()} loading={busy} disabled={busy}>
        Install {meta.name} for this bot
      </Button>
    </div>
  );
}
