import { useQuery } from "@tanstack/react-query";
import { useEffect, useState, type FormEvent, type ReactNode } from "react";

import { Button, Input, Select } from "@/components/ui";
import { errorMessage } from "../chat/chat-client";
import { identityQueries } from "../identity/identity-queries";
import {
  installationApi,
  installationQueries,
  type Installation,
  type MailDnsRecord,
  type MailSettingsPatch,
  type MailTest,
} from "../onboarding/installation-api";

type Provider = NonNullable<Installation["mailProvider"]>;
const PROVIDER_OPTIONS: { value: Provider; label: string }[] = [
  { value: "off", label: "Off: bots get no address of their own" },
  { value: "resend", label: "Resend" },
];
const KEY_NOTE: Record<NonNullable<Installation["mailKey"]>, string> = {
  none: "No key saved.",
  set: "A key is saved. It is stored encrypted and is never shown again.",
  unavailable:
    "The saved key cannot be read any more (the administrator who saved it may have left). Enter it again.",
};
export const RESEND_PRICING = "https://resend.com/pricing";

export type MailDraft = { provider: Provider; domain: string };
// A server older than this page sends none of the fields: they read as "off", never as a crash.
export const draftOfMail = (s: Installation): MailDraft => ({
  provider: s.mailProvider ?? "off",
  domain: s.mailDomain ?? "",
});
const sameDraft = (a: MailDraft, b: MailDraft) =>
  a.provider === b.provider && a.domain.trim().toLowerCase() === b.domain.trim().toLowerCase();

function Note({ children, role }: { children: ReactNode; role?: "status" | "alert" | "note" }) {
  return (
    <p role={role} className="text-xs text-pretty text-muted-foreground">
      {children}
    </p>
  );
}

/** The DNS records the provider says are still to add (or already seen), one line each. */
export function DnsRecords({ records }: { records: MailDnsRecord[] }) {
  if (!records.length) return null;
  return (
    <div className="space-y-1">
      <p className="text-xs font-medium">DNS records for this domain</p>
      <ul className="space-y-1 text-xs">
        {records.map((r) => (
          <li
            key={`${r.type}:${r.name}:${r.value}`}
            className="flex flex-wrap items-baseline gap-x-2 rounded border p-2"
          >
            <span className="font-medium">{r.purpose || r.type}</span>
            <span className="text-muted-foreground">{r.type}</span>
            <code className="break-all">{r.name}</code>
            <code className="break-all">{r.value}</code>
            {r.priority !== undefined && <span>priority {r.priority}</span>}
            <span className={r.verified ? "text-muted-foreground" : "text-warn"}>
              {r.verified ? "seen" : "not seen yet"}
            </span>
          </li>
        ))}
      </ul>
    </div>
  );
}

/**
 * Bot e-mail addresses of the whole installation: every new bot gets an address on a domain the administrator owns, and mail to it passes
 * through the provider (Resend) before it is stored here. The key is write-only: it is sealed in the browser, stored encrypted, and never
 * shown again. Where nothing is set up, bots simply get no address of their own.
 */
export function BotMailForm({
  saved,
  admin,
  onSave,
  onSaveKey,
  onRemoveKey,
  onTest,
}: {
  saved: Installation;
  admin: boolean;
  onSave: (patch: MailSettingsPatch) => Promise<void>;
  onSaveKey: (secret: string) => Promise<void>;
  onRemoveKey: () => Promise<void>;
  onTest: () => Promise<MailTest>;
}) {
  const [draft, setDraft] = useState<MailDraft>(draftOfMail(saved));
  const [secret, setSecret] = useState("");
  const [busy, setBusy] = useState<"save" | "key" | "test" | undefined>();
  const [message, setMessage] = useState<{ kind: "ok" | "error"; text: string }>();
  const [records, setRecords] = useState<MailDnsRecord[]>([]);
  useEffect(() => setDraft(draftOfMail(saved)), [saved]);
  const set = (patch: Partial<MailDraft>) => {
    setMessage(undefined);
    setDraft((d) => ({ ...d, ...patch }));
  };
  const current = draftOfMail(saved);
  const dirty = !sameDraft(draft, current);
  const keyState = saved.mailKey ?? "none";
  const on = draft.provider !== "off";
  const needsDomain = on && !draft.domain.trim();

  async function run<T>(
    what: "save" | "key" | "test",
    work: () => Promise<T>,
    done?: (r: T) => { kind: "ok" | "error"; text: string },
  ) {
    setBusy(what);
    setMessage(undefined);
    try {
      const r = await work();
      if (done) setMessage(done(r));
    } catch (e) {
      setMessage({ kind: "error", text: errorMessage(e) });
    } finally {
      setBusy(undefined);
    }
  }
  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    void run(
      "save",
      () =>
        onSave({
          mailProvider: draft.provider,
          mailDomain: draft.provider === "off" ? current.domain : draft.domain.trim(),
        }),
      () => ({ kind: "ok", text: "Saved." }),
    );
  }
  function saveKey() {
    const value = secret;
    // The field is cleared at once: the page never keeps a key it sent.
    setSecret("");
    void run(
      "key",
      () => onSaveKey(value),
      () => ({
        kind: "ok",
        text: "Key saved. It is stored encrypted and will not be shown again.",
      }),
    );
  }

  if (!admin)
    return (
      <section className="space-y-1" aria-label="Bot e-mail addresses">
        <h3 className="text-sm font-medium">Bot e-mail addresses</h3>
        <Note>
          {current.provider === "off"
            ? "Bots do not get an e-mail address of their own on this server."
            : `Bots get an address on ${current.domain}. Mail to those addresses passes through ${current.provider === "resend" ? "Resend" : "the mail provider"}.`}{" "}
          Ask your administrator to change this.
        </Note>
      </section>
    );

  return (
    <form onSubmit={submit} className="space-y-4" aria-label="Bot e-mail addresses">
      <h3 className="text-sm font-medium">Bot e-mail addresses</h3>
      <Note>
        Every new bot can get an address of its own, such as helper-1a2b@your-domain. You set this
        up once here; the people who own bots type nothing. Without it bots have no address of their
        own (a mailbox connected in Mail still works).
      </Note>
      <Select
        title="Who handles bot mail"
        name="mailProvider"
        required={false}
        value={draft.provider}
        options={PROVIDER_OPTIONS}
        onChange={(e) => set({ provider: e.target.value as Provider })}
      />
      {on && (
        <>
          <Note role="note">
            Mail sent to a bot address passes through Resend, and what a bot sends goes out through
            it. Zetta keeps its own copy of every message in its database, so removing a mailbox
            deletes them. Resend counts each received and sent mail against your plan (the free plan
            has a daily limit and a few domains); read{" "}
            <a
              href={RESEND_PRICING}
              target="_blank"
              rel="noopener noreferrer"
              className="underline"
            >
              Resend&apos;s pricing
            </a>{" "}
            before you turn this on.
          </Note>
          <Input
            title="Domain for the addresses"
            name="mailDomain"
            autoComplete="off"
            value={draft.domain}
            placeholder="bots.example.com"
            onChange={(e) => set({ domain: e.target.value })}
          />
          <Note>
            Use a subdomain you do not read mail on (its MX record will point to Resend). Add the
            domain in your Resend account, then press Test to see the DNS records to add.
          </Note>
          <div className="space-y-2">
            <Input
              title="Resend API key"
              name="mailKey"
              type="password"
              autoComplete="off"
              value={secret}
              placeholder={keyState === "set" ? "A key is saved" : "re_…"}
              onChange={(e) => setSecret(e.target.value)}
            />
            <div className="flex flex-wrap items-center gap-2">
              <Button
                type="button"
                size="sm"
                variant="secondary"
                disabled={busy !== undefined || secret.length < 8}
                onClick={saveKey}
              >
                Save key
              </Button>
              {keyState === "set" && (
                <Button
                  type="button"
                  size="sm"
                  variant="ghost"
                  disabled={busy !== undefined}
                  onClick={() =>
                    void run("key", onRemoveKey, () => ({ kind: "ok", text: "Key removed." }))
                  }
                >
                  Remove key
                </Button>
              )}
              <Note>{KEY_NOTE[keyState]}</Note>
            </div>
          </div>
        </>
      )}
      <DnsRecords records={records} />
      <div className="flex flex-wrap items-center justify-end gap-3 border-t pt-4">
        {message && (
          <p
            role={message.kind === "error" ? "alert" : "status"}
            className={
              message.kind === "error"
                ? "mr-auto text-sm text-destructive"
                : "mr-auto text-sm text-muted-foreground"
            }
          >
            {message.text}
          </p>
        )}
        {current.provider !== "off" && (
          <Button
            type="button"
            size="sm"
            variant="ghost"
            disabled={busy !== undefined || dirty}
            title={
              dirty
                ? "Save the settings first: the test uses what is saved"
                : "Check the domain at the provider"
            }
            onClick={() =>
              void run("test", onTest, (r) => {
                setRecords(r.records ?? []);
                return {
                  kind: r.ok ? "ok" : "error",
                  text: r.message ?? (r.ok ? "It works." : "It did not work."),
                };
              })
            }
          >
            {busy === "test" ? "Testing…" : "Test"}
          </Button>
        )}
        <Button type="submit" size="sm" disabled={busy !== undefined || !dirty || needsDomain}>
          Save
        </Button>
      </div>
    </form>
  );
}

/** The bot-address setting of this installation, for Studio and the Chief's installation card. */
export function BotMailSettings() {
  const { data: saved } = useQuery(installationQueries.get());
  const { data: identity } = useQuery(identityQueries.status());
  const admin = Boolean(identity?.state === "active" && identity.isAdmin);
  if (!saved) return null;
  return (
    <BotMailForm
      saved={saved}
      admin={admin}
      onSave={async (patch) => void (await installationApi.patch(patch))}
      onSaveKey={async (secret) => void (await installationApi.saveMailKey(secret))}
      onRemoveKey={async () => void (await installationApi.removeMailKey())}
      onTest={() => installationApi.testMail()}
    />
  );
}
