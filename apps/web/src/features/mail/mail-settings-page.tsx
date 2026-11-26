import { Alert } from "@g4rcez/components/alert";
import { ArrowLeftIcon } from "@phosphor-icons/react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Link, useNavigate } from "@tanstack/react-router";
import { useState, type FormEvent } from "react";

import { BotIdentity } from "@/components/bot-identity";
import { BotSelect } from "@/components/bot-select";
import { Button, Input, Radiobox } from "@/components/ui";
import { botRole } from "@zetta/core/bot-role";
import { errorMessage, type Bot } from "../chat/chat-client";
import { chatQueries } from "../chat/chat-queries";
import { ConfirmButton } from "../shared/ui";
import { mailApi, mailQueries, type Mailbox, type Sending } from "./mail-api";
import { CopyAddress } from "./bot-address-section";
import { StateBox } from "./mail-states";
import {
  draftOfMailbox,
  sameServers,
  saveFailure,
  ServerFieldset,
  serverFields,
  type SaveFailure,
  type ServerDraft,
  type ServerProblem,
} from "./mail-servers";

const NO_BOTS: Bot[] = [];
type Owner = "none" | "bot";
type Saved = { kind: "ok" | "error"; text: string };

function Result({ saved }: { saved: Saved | undefined }) {
  if (!saved) return null;
  return (
    <p
      role={saved.kind === "error" ? "alert" : "status"}
      className={
        saved.kind === "error" ? "text-sm text-destructive" : "text-sm text-muted-foreground"
      }
    >
      {saved.text}
    </p>
  );
}

/** Label, which bot owns the mailbox, and whether bots may send from it. Saved together. */
function GeneralForm({ mailbox, bots }: { mailbox: Mailbox; bots: Bot[] }) {
  const qc = useQueryClient();
  const [label, setLabel] = useState(mailbox.label);
  const [owner, setOwner] = useState<Owner>(mailbox.ownerBotId ? "bot" : "none");
  const [botId, setBotId] = useState(mailbox.ownerBotId ?? "");
  const [sending, setSending] = useState<Sending>(mailbox.sending);
  const [busy, setBusy] = useState(false);
  const [saved, setSaved] = useState<Saved>();
  const current = bots.find((b) => b.id === mailbox.ownerBotId);
  // The address of a bot belongs to that bot: there is no choice of owner, and nothing here changes it.
  const own = mailbox.kind === "provisioned";
  async function save(e: FormEvent) {
    e.preventDefault();
    if (!own && owner === "bot" && !botId)
      return setSaved({ kind: "error", text: "Pick the bot, or choose no bot." });
    setBusy(true);
    setSaved(undefined);
    try {
      await mailApi.update(mailbox.id, {
        label: label.trim(),
        ...(own ? {} : { botId: owner === "bot" ? botId : null }),
        sending,
      });
      await qc.invalidateQueries({ queryKey: ["mail", "mailboxes"] });
      setSaved({ kind: "ok", text: "Saved." });
    } catch (x) {
      setSaved({ kind: "error", text: errorMessage(x) });
    } finally {
      setBusy(false);
    }
  }
  return (
    <form aria-label="General" onSubmit={(e) => void save(e)} className="space-y-5">
      <h2 className="text-base font-medium">General</h2>
      <Input
        title="Name"
        name="label"
        maxLength={120}
        placeholder={mailbox.address}
        value={label}
        onChange={(e) => setLabel(e.target.value)}
      />
      {own && current && (
        <div className="space-y-2">
          <p className="text-sm font-medium">Who answers this mailbox</p>
          <BotIdentity bot={current} size={24} sub={botRole(current)} />
        </div>
      )}
      {!own && (
        <fieldset className="space-y-2">
          <legend className="text-sm font-medium">Who answers this mailbox</legend>
          {current && owner === "bot" && botId === current.id && (
            <BotIdentity bot={current} size={24} sub={botRole(current)} />
          )}
          <Radiobox name="owner" checked={owner === "none"} onChange={() => setOwner("none")}>
            No bot: Zetta&apos;s assistant answers
          </Radiobox>
          <Radiobox name="owner" checked={owner === "bot"} onChange={() => setOwner("bot")}>
            One of my bots
          </Radiobox>
          {owner === "bot" && (
            <BotSelect bots={bots} label="Bot" value={botId} onChange={setBotId} />
          )}
        </fieldset>
      )}
      <fieldset className="space-y-2">
        <legend className="text-sm font-medium">Sending</legend>
        <div className="flex gap-6">
          <Radiobox name="sending" checked={sending === "on"} onChange={() => setSending("on")}>
            On
          </Radiobox>
          <Radiobox name="sending" checked={sending === "off"} onChange={() => setSending("off")}>
            Off
          </Radiobox>
        </div>
        <p className="text-xs text-pretty text-muted-foreground">
          On: when you ask in the chat, the bot sends the mail; anything it wants to send on its own
          asks you first. Off: no bot can send from this address. Reading the inbox works either
          way.
        </p>
      </fieldset>
      <div className="flex flex-wrap items-center gap-3">
        <Button type="submit" disabled={busy}>
          {busy ? "Saving…" : "Save"}
        </Button>
        <Result saved={saved} />
      </div>
    </form>
  );
}

/** The servers and the password. The server checks them again before it saves; a blank password keeps the saved one. */
function ConnectionForm({ mailbox }: { mailbox: Mailbox }) {
  const qc = useQueryClient();
  const saved0 = draftOfMailbox(mailbox.servers);
  const [servers, setServers] = useState<ServerDraft>(saved0);
  const [password, setPassword] = useState("");
  const [problem, setProblem] = useState<ServerProblem>();
  const [failure, setFailure] = useState<SaveFailure>();
  const [done, setDone] = useState<Saved>();
  const [busy, setBusy] = useState(false);
  async function save(e: FormEvent) {
    e.preventDefault();
    setFailure(undefined);
    setProblem(undefined);
    setDone(undefined);
    const checked = serverFields(servers);
    if (!checked.ok) return setProblem(checked.problem);
    const changed = !sameServers(servers, saved0);
    if (!changed && !password) return setDone({ kind: "ok", text: "Nothing changed." });
    setBusy(true);
    try {
      await mailApi.update(mailbox.id, changed ? checked.fields : {}, password || undefined);
      setPassword("");
      await qc.invalidateQueries({ queryKey: ["mail"] });
      setDone({ kind: "ok", text: "Checked and saved." });
    } catch (x) {
      const f = saveFailure(x);
      if (f.field === "password") setPassword("");
      setFailure(f);
    } finally {
      setBusy(false);
    }
  }
  return (
    <form aria-label="Connection" onSubmit={(e) => void save(e)} className="space-y-5">
      <h2 className="text-base font-medium">Servers and password</h2>
      {mailbox.state === "needs_auth" && (
        <Alert theme="warn">
          The mail server did not accept the password. Enter it again below.
        </Alert>
      )}
      {mailbox.state === "error" && mailbox.lastError && (
        <Alert theme="danger">{mailbox.lastError}</Alert>
      )}
      <ServerFieldset
        draft={servers}
        onChange={(patch) => setServers((s) => ({ ...s, ...patch }))}
        {...(problem ? { problem } : {})}
        {...(failure?.field === "servers" ? { serversError: failure.message } : {})}
      />
      <Input
        title="New password"
        name="password"
        type="password"
        autoComplete="off"
        placeholder="Leave empty to keep the saved password"
        value={password}
        error={failure?.field === "password" ? failure.message : undefined}
        onChange={(e) => setPassword(e.target.value)}
      />
      {failure?.field === "form" && <Alert theme="danger">{failure.message}</Alert>}
      <div className="flex flex-wrap items-center gap-3">
        <Button type="submit" disabled={busy}>
          {busy ? "Checking…" : "Check and save"}
        </Button>
        <Result saved={done} />
      </div>
    </form>
  );
}

/**
 * Who may write to a bot's own address: the only kind of mailbox that has this field. Mail from an address on the list that the provider
 * vouches for (DMARC passes) starts a turn of the bot, which can answer that person only. Anyone else's mail is kept and the bot ignores it.
 */
function SendersForm({ mailbox }: { mailbox: Mailbox }) {
  const qc = useQueryClient();
  const saved0 = mailbox.allowedSenders.join(", ");
  const [text, setText] = useState(saved0);
  const [busy, setBusy] = useState(false);
  const [saved, setSaved] = useState<Saved>();
  async function save(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setSaved(undefined);
    try {
      const list = text
        .split(/[\s,;]+/)
        .map((s) => s.trim())
        .filter(Boolean);
      await mailApi.update(mailbox.id, { allowedSenders: list });
      await qc.invalidateQueries({ queryKey: ["mail", "mailboxes"] });
      setSaved({ kind: "ok", text: "Saved." });
    } catch (x) {
      setSaved({ kind: "error", text: errorMessage(x) });
    } finally {
      setBusy(false);
    }
  }
  return (
    <form aria-label="Who may write to it" onSubmit={(e) => void save(e)} className="space-y-4">
      <h2 className="text-base font-medium">Who may write to it</h2>
      <Input
        title="Allowed senders"
        name="allowedSenders"
        autoComplete="off"
        placeholder="ana@example.com, @example.org"
        value={text}
        onChange={(e) => setText(e.target.value)}
      />
      <p className="text-xs text-pretty text-muted-foreground">
        Addresses or @domains, separated by commas. The bot answers mail from them (and only to
        them) when the mail provider confirms the sender. Anyone else&apos;s mail is kept in the
        inbox and the bot does not answer it. With none, the bot answers nobody.
      </p>
      <div className="flex flex-wrap items-center gap-3">
        <Button type="submit" disabled={busy}>
          {busy ? "Saving…" : "Save"}
        </Button>
        <Result saved={saved} />
      </div>
    </form>
  );
}

/** What a bot's own address has instead of servers and a password: the installation runs it, so there is nothing to enter. */
function AddressConnection({ mailbox }: { mailbox: Mailbox }) {
  return (
    <section aria-label="Connection" className="space-y-3">
      <h2 className="text-base font-medium">Address</h2>
      <CopyAddress address={mailbox.address} />
      <p className="text-sm text-pretty text-muted-foreground">
        This address was made for the bot by this server. There are no servers or password to enter.
        Mail sent to it is stored in Zetta&apos;s database, and renaming the bot keeps the address.
      </p>
      {mailbox.state === "retired" && (
        <Alert theme="warn">
          The bot was deleted, so this address is retired: new mail to it is dropped and nothing can
          be sent from it. What was stored stays here until you remove the mailbox.
        </Alert>
      )}
    </section>
  );
}

/** The kinds of mailbox that are an account connected in a plugin, and what each calls its provider and its mail. */
const ACCOUNT_KINDS = {
  google: { name: "Google", mail: "Gmail" },
  microsoft: { name: "Microsoft", mail: "Outlook" },
} as const;
const accountKind = (m: Mailbox) =>
  m.kind === "google" || m.kind === "microsoft" ? m.kind : undefined;

/** What an account mailbox (Google, Microsoft) has instead of servers and a password: the sign-in lives in the plugin. */
function AccountConnection({
  mailbox,
  kind,
}: {
  mailbox: Mailbox;
  kind: keyof typeof ACCOUNT_KINDS;
}) {
  const name = ACCOUNT_KINDS[kind].name;
  return (
    <section aria-label="Connection" className="space-y-4">
      <h2 className="text-base font-medium">Connection</h2>
      <p className="text-sm text-pretty text-muted-foreground">
        This mailbox is read through your {name} account {mailbox.address}. Zetta keeps no password
        and no mail server for it: the sign-in and its permissions are managed in the {name} plugin.
      </p>
      {mailbox.state === "needs_auth" && (
        <Alert theme="warn">
          {mailbox.lastError ?? `${name} access needs to be signed in again.`}
        </Alert>
      )}
      {mailbox.state === "error" && mailbox.lastError && (
        <Alert theme="danger">{mailbox.lastError}</Alert>
      )}
      <Link
        to="/plugins/$pluginId"
        params={{ pluginId: kind }}
        className="inline-flex h-8 items-center rounded-md border border-field px-3 text-sm font-medium focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring"
      >
        Open the {name} plugin
      </Link>
    </section>
  );
}

function RemoveSection({ mailbox }: { mailbox: Mailbox }) {
  const qc = useQueryClient();
  const account = accountKind(mailbox);
  const names = account ? ACCOUNT_KINDS[account] : undefined;
  const own = mailbox.kind === "provisioned";
  const navigate = useNavigate();
  const [error, setError] = useState<string>();
  async function remove() {
    setError(undefined);
    try {
      await mailApi.remove(mailbox.id);
      await qc.invalidateQueries({ queryKey: ["mail", "mailboxes"] });
      await navigate({ to: "/mail" });
    } catch (x) {
      setError(errorMessage(x));
    }
  }
  return (
    <section aria-label="Remove" className="space-y-3">
      <h2 className="text-base font-medium">
        {names ? "Hide this mailbox" : "Remove this mailbox"}
      </h2>
      <p className="text-sm text-pretty text-muted-foreground">
        {own
          ? "Every message stored for this address is deleted for good, and the address is retired: it is never given to anyone again."
          : names
            ? `Zetta stops showing this mailbox and its bots stop reading it. Your ${names.name} account stays connected in the ${names.name} plugin (disconnect it there) and mail on ${names.mail} is not touched. To bring the mailbox back, connect a mailbox with this address again.`
            : "Zetta forgets the mailbox and its saved password. Mail on the provider is not touched."}
      </p>
      <ConfirmButton
        label={names ? "Hide mailbox" : "Remove mailbox"}
        question={
          own
            ? `Remove ${mailbox.address}? Every message stored for it is deleted and the address is never given out again.`
            : names
              ? `Hide ${mailbox.address} in Zetta? The ${names.name} account stays connected and mail on ${names.mail} is not touched.`
              : `Remove ${mailbox.address} from Zetta? Mail on the provider is not touched.`
        }
        confirmLabel={names ? "Hide" : "Remove"}
        variant="destructive"
        onConfirm={remove}
      />
      {error && (
        <p role="alert" className="text-sm text-destructive">
          {error}
        </p>
      )}
    </section>
  );
}

export function MailSettingsPage({ mailboxId }: { mailboxId: string }) {
  const boxes = useQuery(mailQueries.mailboxes());
  const bots = useQuery(chatQueries.bots()).data ?? NO_BOTS;
  const mailbox = boxes.data?.find((m) => m.id === mailboxId);
  let body;
  if (boxes.isPending)
    body = (
      <p role="status" className="text-sm text-muted-foreground">
        Loading…
      </p>
    );
  else if (boxes.isError) body = <Alert theme="danger">{errorMessage(boxes.error)}</Alert>;
  else if (!mailbox)
    body = <StateBox title="This mailbox is not here">It may have been removed.</StateBox>;
  else
    body = (
      <>
        <GeneralForm key={`${mailbox.id}:general`} mailbox={mailbox} bots={bots} />
        <hr className="border-border" />
        {mailbox.kind === "provisioned" && (
          <>
            <SendersForm key={`${mailbox.id}:senders`} mailbox={mailbox} />
            <hr className="border-border" />
          </>
        )}
        {mailbox.kind === "provisioned" ? (
          <AddressConnection key={`${mailbox.id}:connection`} mailbox={mailbox} />
        ) : accountKind(mailbox) ? (
          <AccountConnection
            key={`${mailbox.id}:connection`}
            mailbox={mailbox}
            kind={accountKind(mailbox)!}
          />
        ) : (
          <ConnectionForm key={`${mailbox.id}:connection`} mailbox={mailbox} />
        )}
        <hr className="border-border" />
        <RemoveSection mailbox={mailbox} />
      </>
    );
  return (
    <div className="h-full overflow-y-auto">
      <div className="mx-auto flex w-full max-w-2xl flex-col gap-6 p-4 md:p-8">
        <Link
          to="/mail/$mailboxId"
          params={{ mailboxId }}
          className="inline-flex w-fit items-center gap-1 text-sm text-muted-foreground hover:text-foreground"
        >
          <ArrowLeftIcon aria-hidden="true" className="size-4" />
          Inbox
        </Link>
        <header>
          <h1 className="text-2xl text-balance">Mailbox settings</h1>
          {mailbox && <p className="text-sm text-muted-foreground">{mailbox.address}</p>}
        </header>
        {body}
      </div>
    </div>
  );
}
