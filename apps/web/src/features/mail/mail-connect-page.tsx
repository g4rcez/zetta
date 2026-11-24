import { Alert } from "@g4rcez/components/alert";
import { ArrowLeftIcon } from "@phosphor-icons/react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Link, useNavigate } from "@tanstack/react-router";
import { useState, type FormEvent } from "react";

import { AdvancedSection } from "@/components/advanced-section";
import { Button, Input } from "@/components/ui";
import { errorMessage } from "../chat/chat-client";
import { mailApi, mailQueries, type Detection, type Mailbox } from "./mail-api";
import {
  draftFromDetection,
  EMPTY_SERVERS,
  saveFailure,
  ServerFieldset,
  serverFields,
  type SaveFailure,
  type ServerDraft,
  type ServerProblem,
} from "./mail-servers";

/** Tells what the detected provider needs, with the link where an app password is made. */
export function Guidance({ detection }: { detection: Detection }) {
  if (detection.status === "invalid") return null;
  return (
    <div role="status" className="space-y-1 rounded-md bg-muted px-3 py-2 text-sm">
      <p className="text-pretty">{detection.message}</p>
      {detection.next?.type === "mailbox" && (
        <p>
          <Link
            to="/mail/$mailboxId"
            params={{ mailboxId: detection.next.mailboxId }}
            className="text-primary underline underline-offset-2"
          >
            Open the inbox
          </Link>
        </p>
      )}
      {detection.next?.type === "plugin" && (
        <p>
          <Link
            to="/plugins/$pluginId"
            params={{ pluginId: detection.next.pluginId }}
            className="text-primary underline underline-offset-2"
          >
            Set up Microsoft
          </Link>
        </p>
      )}
      {detection.appPasswordUrl && (
        <p>
          <a
            href={detection.appPasswordUrl}
            target="_blank"
            rel="noopener noreferrer"
            className="text-primary underline underline-offset-2"
          >
            Create an app password
          </a>
        </p>
      )}
      {detection.confidence === "unchecked" && (
        <p className="text-xs text-muted-foreground">
          These server names could not be confirmed with the provider. Check them before you
          connect.
        </p>
      )}
    </div>
  );
}

/** The words that differ between the account kinds; the rest of the hint is the same. */
const ACCOUNT_HINT = {
  google: {
    name: "Google",
    connection: "your Google connection",
    plugin: "Google plugin",
    permission: "Gmail: read messages",
    show: (address: string) => mailApi.showGoogle(address),
    fallback: "Or use an app password below: it works without the Google plugin.",
  },
  microsoft: {
    name: "Microsoft",
    connection: "your Microsoft connection",
    plugin: "Microsoft plugin",
    permission: "Mail: read messages",
    show: (address: string) => mailApi.showMicrosoft(address),
    // Microsoft no longer takes a password over IMAP, so there is no other way to offer.
    fallback: "",
  },
} as const;

/**
 * What to do with a Gmail or an Outlook or Microsoft 365 address: an account that is already connected in its plugin is a mailbox here by
 * itself (no password), and one that is not is connected once in the plugin. For Gmail the app-password form below stays as the other way.
 */
function AccountHint({
  kind,
  address,
  existing,
  onShown,
}: {
  kind: keyof typeof ACCOUNT_HINT;
  address: string;
  existing: Pick<Mailbox, "id"> | undefined;
  onShown: (id: string) => void;
}) {
  const w = ACCOUNT_HINT[kind];
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState<string>();
  async function show() {
    setBusy(true);
    setProblem(undefined);
    try {
      onShown((await w.show(address)).id);
    } catch (e) {
      setProblem(errorMessage(e));
    } finally {
      setBusy(false);
    }
  }
  if (existing)
    return (
      <div role="status" className="space-y-2 rounded-md bg-muted px-3 py-2 text-sm">
        <p className="text-pretty">
          This address is already here: Zetta reads it through {w.connection}, with no password.
        </p>
        <Link
          to="/mail/$mailboxId"
          params={{ mailboxId: existing.id }}
          className="text-primary underline underline-offset-2"
        >
          Open the inbox
        </Link>
      </div>
    );
  return (
    <div role="status" className="space-y-2 rounded-md bg-muted px-3 py-2 text-sm">
      <p className="text-pretty">
        Connect your {w.name} account once in the {w.plugin} (tick &quot;{w.permission}&quot;) and
        this mailbox appears here by itself, with no password.
      </p>
      <div className="flex flex-wrap items-center gap-3">
        <Link
          to="/plugins/$pluginId"
          params={{ pluginId: kind }}
          className="text-primary underline underline-offset-2"
        >
          Set up {w.name}
        </Link>
        <Button
          type="button"
          size="sm"
          variant="outline"
          disabled={busy}
          onClick={() => void show()}
        >
          {busy ? "Looking…" : "Already connected? Show it here"}
        </Button>
      </div>
      {problem && (
        <p role="alert" className="text-destructive">
          {problem}
        </p>
      )}
      {w.fallback && <p className="text-xs text-muted-foreground">{w.fallback}</p>}
    </div>
  );
}

/** Connect a mailbox: the address first, then the servers are filled in for it, then the password (sealed before it is sent). */
export function MailConnectPage() {
  const navigate = useNavigate();
  const qc = useQueryClient();
  const [address, setAddress] = useState("");
  const [label, setLabel] = useState("");
  const [password, setPassword] = useState("");
  const [servers, setServers] = useState<ServerDraft>(EMPTY_SERVERS);
  const [touched, setTouched] = useState(false);
  const [detection, setDetection] = useState<Detection>();
  const [detected, setDetected] = useState("");
  const [addressError, setAddressError] = useState<string>();
  const [problem, setProblem] = useState<ServerProblem>();
  const [failure, setFailure] = useState<SaveFailure>();
  const [busy, setBusy] = useState<"detect" | "connect">();
  const boxes = useQuery(mailQueries.mailboxes());

  async function detect() {
    const a = address.trim();
    if (!a || a === detected) return;
    setDetected(a);
    setBusy("detect");
    setAddressError(undefined);
    try {
      const found = await mailApi.detect(a);
      setDetection(found);
      if (found.status !== "microsoft" && !touched)
        setServers((s) => draftFromDetection(found, a, s));
    } catch (e) {
      setDetection(undefined);
      setAddressError(errorMessage(e));
    } finally {
      setBusy(undefined);
    }
  }
  function edit(patch: Partial<ServerDraft>) {
    setTouched(true);
    setServers((s) => ({ ...s, ...patch }));
  }
  async function submit(e: FormEvent) {
    e.preventDefault();
    setFailure(undefined);
    setProblem(undefined);
    if (!address.trim()) return setAddressError("Enter the e-mail address.");
    if (!password) return setFailure({ field: "password", message: "Enter the password." });
    const checked = serverFields(servers);
    if (!checked.ok) return setProblem(checked.problem);
    setBusy("connect");
    try {
      const made = await mailApi.connect({
        address: address.trim(),
        ...(label.trim() ? { label: label.trim() } : {}),
        password,
        ...checked.fields,
      });
      setPassword("");
      await qc.invalidateQueries({ queryKey: ["mail", "mailboxes"] });
      await navigate({ to: "/mail/$mailboxId", params: { mailboxId: made.id } });
    } catch (x) {
      const f = saveFailure(x);
      // A refused password is cleared: it is typed again. A server that could not be reached keeps it.
      if (f.field === "password") setPassword("");
      setFailure(f);
    } finally {
      setBusy(undefined);
    }
  }

  // A Microsoft address has no password form: Microsoft turned that off, so it is read through the Microsoft plugin.
  const blocked = detection?.status === "microsoft";
  const accountKind =
    detected === address.trim() &&
    (detection?.status === "google" || detection?.status === "microsoft")
      ? detection.status
      : undefined;
  const viaAccount = accountKind
    ? (boxes.data?.find(
        (m) => m.kind === accountKind && m.address.toLowerCase() === address.trim().toLowerCase(),
      ) ?? (detection?.next?.type === "mailbox" ? { id: detection.next.mailboxId } : undefined))
    : undefined;
  const advancedNeeded =
    failure?.field === "servers" ||
    Boolean(problem) ||
    (detection !== undefined &&
      detection.status !== "microsoft" &&
      (detection.status === "unknown" || !detection.imap || !detection.smtp));
  return (
    <div className="h-full overflow-y-auto">
      <form
        aria-label="Connect a mailbox"
        onSubmit={(e) => void submit(e)}
        className="mx-auto flex w-full max-w-2xl flex-col gap-5 p-4 md:p-8"
      >
        <Link
          to="/mail"
          className="inline-flex w-fit items-center gap-1 text-sm text-muted-foreground hover:text-foreground"
        >
          <ArrowLeftIcon aria-hidden="true" className="size-4" />
          Mail
        </Link>
        <header>
          <h1 className="text-2xl text-balance">Connect a mailbox</h1>
          <p className="text-sm text-pretty text-muted-foreground">
            Zetta reads this mailbox: nothing is moved, deleted or marked as read. A mail a bot
            sends for you is also saved in your Sent folder.
          </p>
        </header>
        <Input
          title="E-mail address"
          name="address"
          type="email"
          autoComplete="off"
          placeholder="you@example.com"
          value={address}
          error={addressError}
          onChange={(e) => setAddress(e.target.value)}
          onBlur={() => void detect()}
        />
        {busy === "detect" && (
          <p role="status" className="text-sm text-muted-foreground">
            Looking up the mail servers…
          </p>
        )}
        {accountKind && (
          <AccountHint
            kind={accountKind}
            address={address.trim()}
            existing={viaAccount}
            onShown={(id) => {
              void qc.invalidateQueries({ queryKey: ["mail", "mailboxes"] });
              void navigate({ to: "/mail/$mailboxId", params: { mailboxId: id } });
            }}
          />
        )}
        {detection && !viaAccount && !blocked && <Guidance detection={detection} />}
        {!blocked && !viaAccount && (
          <>
            <Input
              title="Name (optional)"
              name="label"
              maxLength={120}
              placeholder={address.trim() || "Work"}
              value={label}
              onChange={(e) => setLabel(e.target.value)}
            />
            <Input
              title="Password"
              name="password"
              type="password"
              autoComplete="off"
              value={password}
              error={failure?.field === "password" ? failure.message : undefined}
              onChange={(e) => setPassword(e.target.value)}
            />
            <AdvancedSection title="Advanced: mail servers" defaultOpen={advancedNeeded}>
              <div className="p-3 pt-0">
                <ServerFieldset
                  draft={servers}
                  onChange={edit}
                  {...(problem ? { problem } : {})}
                  {...(failure?.field === "servers" ? { serversError: failure.message } : {})}
                />
              </div>
            </AdvancedSection>
            {failure?.field === "form" && <Alert theme="danger">{failure.message}</Alert>}
            <div className="flex flex-wrap items-center gap-3">
              <Button type="submit" disabled={busy !== undefined}>
                {busy === "connect" ? "Checking the mailbox…" : "Connect"}
              </Button>
              <p className="text-xs text-muted-foreground">
                The servers and the password are checked before anything is saved.
              </p>
            </div>
          </>
        )}
      </form>
    </div>
  );
}
