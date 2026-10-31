import { useState, type FormEvent } from "react";
import { Button, Input, Select } from "@/components/ui";

import { call, errorMessage, sendSealed } from "../chat/chat-client";
import { Empty, list, listItem, Panel, useList } from "../shared/ui";

type Source = {
  id: string;
  kind: "rss" | "web" | "email" | "x";
  url: string;
  label: string;
  lastStatus: "ok" | "failed" | "blocked" | null;
  lastFetchedAt: string | null;
};
type Briefing = { parts: { label: string; status: string }[]; prompt: string; gaps: string[] };

const MAIL_PRESETS = [
  {
    id: "gmail",
    name: "Gmail",
    host: "imap.gmail.com",
    help: "Turn on 2-step verification, then create an App password at myaccount.google.com/apppasswords and paste it here.",
  },
  {
    id: "outlook",
    name: "Outlook / Microsoft 365",
    host: "outlook.office365.com",
    help: "Use an app password from your Microsoft account security page.",
  },
  {
    id: "icloud",
    name: "iCloud Mail",
    host: "imap.mail.me.com",
    help: "Create an app-specific password at appleid.apple.com.",
  },
  {
    id: "yahoo",
    name: "Yahoo Mail",
    host: "imap.mail.yahoo.com",
    help: "Generate an app password in Yahoo account security.",
  },
  {
    id: "custom",
    name: "Other (IMAP)",
    host: "",
    help: "Use your provider's IMAP host and an app password or mailbox password.",
  },
] as const;

/** Sources you follow: public feeds and pages, plus your own mailbox (IMAP) and X. Used by "Read my sources" workflow steps. */
export function Sources({ onError }: { onError: (m: string) => void }) {
  const [rows, reload] = useList<Source>("/api/sources", "sources", onError);
  const [briefing, setBriefing] = useState<Briefing>();
  const [kind, setKind] = useState<"rss" | "web" | "email" | "x">("rss");
  const [preset, setPreset] = useState<(typeof MAIL_PRESETS)[number]["id"]>("gmail");
  const mail = MAIL_PRESETS.find((p) => p.id === preset)!;
  async function add(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const form = e.currentTarget;
    const f = new FormData(form);
    try {
      if (kind === "email" || kind === "x") {
        // The secret goes straight into the sealed connections store; the source keeps only a reference to it.
        const provider = kind;
        const label = String(f.get("label"));
        const { connection } = await sendSealed(
          `connection.create:${provider}`,
          { secret: String(f.get("secret")) },
          (sealed) =>
            call<{ connection: { id: string } }>("/api/connections", "POST", {
              provider,
              label: `${label} (${provider === "email" ? "mailbox" : "X"})`,
              sealed,
            }),
        );
        if (kind === "email")
          await call("/api/sources", "POST", {
            kind,
            label,
            connectionId: connection.id,
            host: preset === "custom" ? String(f.get("host")) : mail.host,
            user: String(f.get("user")),
            mailbox: String(f.get("mailbox") || "INBOX"),
          });
        else
          await call("/api/sources", "POST", {
            kind,
            label,
            connectionId: connection.id,
            mode: String(f.get("mode")),
            value: String(f.get("value")),
          });
      } else await call("/api/sources", "POST", { kind, url: f.get("url"), label: f.get("label") });
      form.reset();
      void reload();
    } catch (x) {
      onError(errorMessage(x));
    }
  }
  return (
    <Panel
      title="Sources you follow"
      label="Sources"
      description="Feeds and pages are public. Email and X use your own account; the app only reads and never sends, deletes or marks mail as read."
    >
      <form
        onSubmit={(e) => void add(e)}
        className="grid gap-2 sm:grid-cols-2"
        aria-label="Add a source"
      >
        <Select
          title="Type"
          required={false}
          value={kind}
          onChange={(e) => setKind(e.target.value as typeof kind)}
          options={[
            { value: "rss", label: "Feed (RSS/Atom)" },
            { value: "web", label: "Web page" },
            { value: "email", label: "Email (Gmail, Outlook, iCloud, any IMAP)" },
            { value: "x", label: "X (timeline or search)" },
          ]}
        />
        <Input title="Name" name="label" required maxLength={100} />
        {(kind === "rss" || kind === "web") && (
          <Input
            title="Address"
            container="sm:col-span-2"
            name="url"
            type="url"
            required
            placeholder="https://example.com/feed"
          />
        )}
        {kind === "email" && (
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
            <Input
              title="Email address"
              name="user"
              type="email"
              required
              placeholder="you@example.com"
              autoComplete="off"
            />
            <Input
              title="Mailbox or label"
              name="mailbox"
              placeholder="INBOX (or a label such as Newsletters)"
            />
            <Input
              title="App password"
              container="sm:col-span-2"
              name="secret"
              type="password"
              required
              autoComplete="new-password"
            />
            <p className="text-xs text-muted-foreground sm:col-span-2">{mail.help}</p>
          </>
        )}
        {kind === "x" && (
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
            <Input
              title="Handle or query"
              name="value"
              required
              placeholder="@handle or a search query"
            />
            <Input
              title="X API bearer token"
              container="sm:col-span-2"
              name="secret"
              type="password"
              required
              autoComplete="new-password"
            />
            <p className="text-xs text-muted-foreground sm:col-span-2">
              Create a project at developer.x.com and paste its bearer token. Reading requires an X
              API plan that allows it.
            </p>
          </>
        )}
        <Button size="sm" type="submit" className="justify-self-start">
          Add
        </Button>
      </form>
      {rows?.length === 0 && <Empty>No sources yet.</Empty>}
      <ul className={list}>
        {rows?.map((s) => (
          <li key={s.id} className={`${listItem} flex items-center justify-between gap-2`}>
            <span className="min-w-0 truncate">
              {s.label}{" "}
              <span className="text-muted-foreground">
                ·{" "}
                {s.kind === "rss"
                  ? "feed"
                  : s.kind === "web"
                    ? "page"
                    : s.kind === "email"
                      ? "mailbox"
                      : "X"}{" "}
                ·{" "}
                {s.lastStatus
                  ? s.lastStatus === "ok"
                    ? "read fine"
                    : s.lastStatus === "blocked"
                      ? "blocked address"
                      : "could not be read"
                  : "not read yet"}
              </span>
            </span>
            <Button
              size="sm"
              variant="outline"
              onClick={() =>
                void call(`/api/sources/${s.id}`, "DELETE").then(reload, (x) =>
                  onError(errorMessage(x)),
                )
              }
            >
              Remove
            </Button>
          </li>
        ))}
      </ul>
      <Button
        size="sm"
        variant="outline"
        onClick={() =>
          void call<Briefing>("/api/sources/briefing", "POST", {}).then(setBriefing, (x) =>
            onError(errorMessage(x)),
          )
        }
      >
        Preview briefing
      </Button>
      {briefing && (
        <div role="status" className="rounded bg-muted p-2 text-xs">
          <p>
            {briefing.gaps.length
              ? `Could not read: ${briefing.gaps.join(", ")}.`
              : "All sources read."}
          </p>
          <pre className="mt-1 max-h-48 overflow-auto whitespace-pre-wrap">
            {briefing.prompt.slice(0, 2000)}
          </pre>
        </div>
      )}
    </Panel>
  );
}
