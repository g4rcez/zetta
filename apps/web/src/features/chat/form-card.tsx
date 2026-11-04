import { Alert } from "@g4rcez/components/alert";
import { CheckCircleIcon } from "@phosphor-icons/react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useState, type FormEvent, type ReactNode } from "react";

import { BotIdentity, useBotIdentity } from "@/components/bot-identity";
import { Button, Input, Select } from "@/components/ui";
import { databaseApi } from "../bot-database/database-api";
import {
  installationApi,
  installationQueries,
  type Installation,
  type NetworkMode,
} from "../onboarding/installation-api";
import { InvitationManager } from "../identity/invitation-manager";
import { LayaSwitch } from "../studio/laya-switch";
import { MAIL_PRESETS } from "../studio/sources";
import { call, sendSealed } from "./chat-client";
import { errorMessage } from "./chat-client";
import type { FormCardData } from "./form-card-data";

type Phase = "ready" | "busy" | "done" | "dismissed";

/**
 * A form the chief opened because the model must not see what goes in it (a secret, a sign-in, a typed confirmation). The server built
 * the card; the person fills it in and it calls the same API as the settings page, with their own session.
 */
export function FormCard({ data }: { data: FormCardData }) {
  const bot = useBotIdentity(data.botId ?? "", data.botName ?? "");
  const [phase, setPhase] = useState<Phase>("ready");
  if (phase === "dismissed") return null;
  const form = FORM[data.form];
  return (
    <section
      aria-label={form.title(data)}
      className="my-1 space-y-3 rounded-lg border bg-card p-3 text-sm"
    >
      <header className="flex items-center gap-2">
        <h3 className="min-w-0 flex-1 font-medium">{form.title(data)}</h3>
        {data.botId && <BotIdentity bot={bot} size={20} sub="asks" className="w-auto flex-none" />}
      </header>
      {phase === "done" ? (
        <p className="flex items-center gap-1.5 text-xs text-muted-foreground">
          <CheckCircleIcon aria-hidden weight="fill" className="size-4 text-success" />
          {form.done(data)}
        </p>
      ) : (
        form.body({
          data,
          busy: phase === "busy",
          setBusy: (b) => setPhase(b ? "busy" : "ready"),
          onDone: () => setPhase("done"),
          onCancel: () => setPhase("dismissed"),
        })
      )}
    </section>
  );
}

type Props = {
  data: FormCardData;
  busy: boolean;
  setBusy: (busy: boolean) => void;
  onDone: () => void;
  onCancel: () => void;
};
const FORM: Record<
  FormCardData["form"],
  {
    title: (d: FormCardData) => string;
    done: (d: FormCardData) => string;
    body: (p: Props) => ReactNode;
  }
> = {
  invite: {
    title: () => "Invite someone",
    done: () => "Done.",
    body: () => <InvitationManager />,
  },
  installation: {
    title: () => "Installation settings",
    done: () => "Saved.",
    body: (p) => <InstallationForm {...p} />,
  },
  source_login: {
    title: (d) => `Add an ${d.prefill.kind === "x" ? "X" : "email"} source`,
    done: () => "Added. The login is stored encrypted and will not be shown again.",
    body: (p) => <SourceLoginForm {...p} />,
  },
  connection: {
    title: (d) => `Add a ${d.prefill.provider ?? ""} key`,
    done: () => "Saved. The key is stored encrypted and will not be shown again.",
    body: (p) => <ConnectionForm {...p} />,
  },
  bot_database_reset: {
    title: (d) => `Erase ${d.botName ?? "the bot"}'s database?`,
    done: (d) => `Erased. ${d.botName ?? "The bot"} starts again from an empty database.`,
    body: (p) => <ResetDatabaseForm {...p} />,
  },
};

function ResetDatabaseForm({ data, busy, setBusy, onDone, onCancel }: Props) {
  const slug = data.prefill.slug ?? "";
  const [typed, setTyped] = useState("");
  const [error, setError] = useState<string>();
  async function submit(e: FormEvent) {
    e.preventDefault();
    if (!data.botId) return;
    setBusy(true);
    setError(undefined);
    try {
      await databaseApi.reset(data.botId, typed);
      onDone();
    } catch (x) {
      setError(errorMessage(x));
      setBusy(false);
    }
  }
  return (
    <form onSubmit={(e) => void submit(e)} className="space-y-3" aria-label="Start over">
      <p>
        Everything {data.botName} saved (tables, lists, preferences, notes) is deleted for good.{" "}
        {data.botName} keeps working and starts again from an empty database.
      </p>
      <Input
        title={`Type ${slug} to confirm`}
        value={typed}
        onChange={(e) => setTyped(e.target.value)}
        autoComplete="off"
        placeholder={slug}
      />
      {error && <Alert theme="danger">{error}</Alert>}
      <div className="flex justify-end gap-2">
        <Button type="button" variant="outline" size="sm" onClick={onCancel} disabled={busy}>
          Not now
        </Button>
        <Button
          type="submit"
          variant="destructive"
          size="sm"
          loading={busy}
          disabled={busy || !slug || typed.trim() !== slug}
        >
          Erase everything
        </Button>
      </div>
    </form>
  );
}

const PROVIDERS = ["anthropic", "openai", "google", "openrouter", "github"] as const;
function ConnectionForm({ data, busy, setBusy, onDone, onCancel }: Props) {
  const provider = PROVIDERS.find((p) => p === data.prefill.provider) ?? "openai";
  const [label, setLabel] = useState(data.prefill.label ?? provider);
  const [secret, setSecret] = useState("");
  const [error, setError] = useState<string>();
  const qc = useQueryClient();
  async function submit(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(undefined);
    try {
      await sendSealed(`connection.create:${provider}`, { secret }, (sealed) =>
        call("/api/connections", "POST", { provider, label: label.trim(), sealed }),
      );
      void qc.invalidateQueries({ queryKey: ["connections"] });
      onDone();
    } catch (x) {
      setError(errorMessage(x));
      setBusy(false);
    } finally {
      setSecret(""); // the key field is always cleared
    }
  }
  return (
    <form
      onSubmit={(e) => void submit(e)}
      className="space-y-3"
      aria-label={`Add a ${provider} key`}
    >
      <p className="text-muted-foreground">
        Paste the key here. It is sealed in your browser, so the chat and the bots never see it.
      </p>
      <Input title="Name" value={label} onChange={(e) => setLabel(e.target.value)} />
      <Input
        title={`${provider} key`}
        type="password"
        value={secret}
        onChange={(e) => setSecret(e.target.value)}
        autoComplete="off"
      />
      {error && <Alert theme="danger">{error}</Alert>}
      <div className="flex justify-end gap-2">
        <Button type="button" variant="outline" size="sm" onClick={onCancel} disabled={busy}>
          Not now
        </Button>
        <Button
          type="submit"
          size="sm"
          loading={busy}
          disabled={busy || secret.length < 8 || !label.trim()}
        >
          Save key
        </Button>
      </div>
    </form>
  );
}

function InstallationForm({ onCancel }: Props) {
  const [error, setError] = useState<string>();
  return (
    <div className="space-y-4">
      <LayaSwitch onError={setError} />
      <NetworkMode onError={setError} />
      {error && <Alert theme="danger">{error}</Alert>}
      <div className="flex justify-end">
        <Button type="button" variant="outline" size="sm" onClick={onCancel}>
          Close
        </Button>
      </div>
    </div>
  );
}

/** Who can reach this server. The server reads it once at boot, so a change needs a restart; the card says so. */
function NetworkMode({ onError }: { onError: (m: string) => void }) {
  const saved = useQuery(installationQueries.get()).data;
  return saved ? <NetworkForm saved={saved} onError={onError} /> : null;
}

/** The draft starts from the saved value and is never replaced by a refetch while the person types. */
function NetworkForm({ saved, onError }: { saved: Installation; onError: (m: string) => void }) {
  const [mode, setMode] = useState<NetworkMode>(saved.networkMode);
  const [publicUrl, setPublicUrl] = useState(saved.publicUrl ?? "");
  const [busy, setBusy] = useState(false);
  const restart = saved.restartRequired;
  const dirty =
    mode !== saved.networkMode ||
    (mode === "network" && publicUrl.trim() !== (saved.publicUrl ?? ""));
  async function save() {
    setBusy(true);
    try {
      // `patch` stores the saved installation in the cache.
      await installationApi.patch({
        networkMode: mode,
        publicUrl: mode === "network" ? publicUrl.trim() : null,
      });
    } catch (e) {
      onError(errorMessage(e));
    } finally {
      setBusy(false);
    }
  }
  return (
    <section className="space-y-2" aria-label="Network">
      <h4 className="font-medium">Network</h4>
      <Select
        title="Who can open Zetta"
        required={false}
        value={mode}
        onChange={(e) => setMode(e.target.value as NetworkMode)}
        options={[
          { value: "local", label: "Only this computer" },
          { value: "network", label: "Other computers on the network" },
        ]}
      />
      {mode === "network" && (
        <>
          <Input
            title="Public address (https)"
            type="url"
            value={publicUrl}
            onChange={(e) => setPublicUrl(e.target.value)}
            placeholder="https://zetta.example.com"
          />
          <p className="text-xs text-muted-foreground">
            Anyone who can reach this address can see the sign-in page. Code access for bots stays
            off unless the server runs bots in Docker.
          </p>
        </>
      )}
      {restart && <Alert theme="warn">Restart the Zetta server to apply the network choice.</Alert>}
      <Button
        type="button"
        size="sm"
        loading={busy}
        disabled={busy || !dirty || (mode === "network" && !publicUrl.trim())}
        onClick={() => void save()}
      >
        Save network
      </Button>
    </section>
  );
}

/** An email (IMAP) or X source: the login is sealed into a connection first, and the source keeps only a reference to it. */
function SourceLoginForm({ data, busy, setBusy, onDone, onCancel }: Props) {
  const kind = data.prefill.kind === "x" ? "x" : "email";
  const [preset, setPreset] = useState<(typeof MAIL_PRESETS)[number]["id"]>("gmail");
  const mail = MAIL_PRESETS.find((p) => p.id === preset)!;
  const [error, setError] = useState<string>();
  const qc = useQueryClient();
  async function submit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const f = new FormData(e.currentTarget);
    setBusy(true);
    setError(undefined);
    try {
      const label = String(f.get("label")).trim();
      const { connection } = await sendSealed(
        `connection.create:${kind}`,
        { secret: String(f.get("secret")) },
        (sealed) =>
          call<{ connection: { id: string } }>("/api/connections", "POST", {
            provider: kind,
            label: `${label} (${kind === "email" ? "mailbox" : "X"})`,
            sealed,
          }),
      );
      void qc.invalidateQueries({ queryKey: ["connections"] });
      await call(
        "/api/sources",
        "POST",
        kind === "email"
          ? {
              kind,
              label,
              connectionId: connection.id,
              host: preset === "custom" ? String(f.get("host")) : mail.host,
              user: String(f.get("user")),
              mailbox: String(f.get("mailbox") || "INBOX"),
            }
          : {
              kind,
              label,
              connectionId: connection.id,
              mode: String(f.get("mode")),
              value: String(f.get("value")),
            },
      );
      onDone();
    } catch (x) {
      setError(errorMessage(x));
      setBusy(false);
    }
  }
  return (
    <form onSubmit={(e) => void submit(e)} className="space-y-3" aria-label="Add a source">
      <Input title="Name" name="label" required maxLength={100} defaultValue={data.prefill.label} />
      {kind === "email" ? (
        <>
          <Select
            title="Mail provider"
            required={false}
            value={preset}
            onChange={(e) => setPreset(e.target.value as typeof preset)}
            options={MAIL_PRESETS.map((p) => ({ value: p.id, label: p.name }))}
          />
          {preset === "custom" ? (
            <Input title="IMAP host" name="host" required placeholder="imap.example.com" />
          ) : (
            <Input title="IMAP host" value={mail.host} readOnly />
          )}
          <Input title="Email address" name="user" type="email" required autoComplete="off" />
          <Input title="Mailbox or label" name="mailbox" placeholder="INBOX" />
          <Input
            title="App password"
            name="secret"
            type="password"
            required
            autoComplete="new-password"
          />
          <p className="text-xs text-muted-foreground">{mail.help}</p>
        </>
      ) : (
        <>
          <Select
            title="What to follow"
            required={false}
            name="mode"
            options={[
              { value: "user", label: "A user's posts" },
              { value: "search", label: "A search query" },
            ]}
          />
          <Input title="Handle or query" name="value" required placeholder="@handle or a query" />
          <Input
            title="X API bearer token"
            name="secret"
            type="password"
            required
            autoComplete="new-password"
          />
        </>
      )}
      {error && <Alert theme="danger">{error}</Alert>}
      <div className="flex justify-end gap-2">
        <Button type="button" variant="outline" size="sm" onClick={onCancel} disabled={busy}>
          Not now
        </Button>
        <Button type="submit" size="sm" loading={busy} disabled={busy}>
          Add
        </Button>
      </div>
    </form>
  );
}
