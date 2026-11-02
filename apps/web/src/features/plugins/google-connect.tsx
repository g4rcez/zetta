import {
  CalendarIcon,
  CheckCircleIcon,
  EnvelopeIcon,
  FileTextIcon,
  HardDriveIcon,
  ShieldCheckIcon,
  TableIcon,
  WarningIcon,
  type Icon,
} from "@phosphor-icons/react";
import { useEffect, useState } from "react";

import { Button } from "@/components/ui";
import { errorMessage } from "../chat/chat-client";
import { usePluginApi, type PluginTest } from "./plugins-api";
import { Alert } from "@g4rcez/components/alert";

/** Native checkbox: the label stays beside the box and wraps under its own text, never under the box. */
export function Check({
  checked,
  disabled,
  onChange,
  children,
}: {
  checked: boolean;
  disabled?: boolean;
  onChange: (on: boolean) => void;
  children: React.ReactNode;
}) {
  return (
    <label
      className={`flex items-start gap-2 text-sm leading-snug ${disabled ? "opacity-50" : "cursor-pointer"}`}
    >
      <input
        type="checkbox"
        className="mt-0.5 size-4 shrink-0"
        checked={checked}
        disabled={disabled}
        onChange={(e) => onChange(e.target.checked)}
      />
      <span className="min-w-0">{children}</span>
    </label>
  );
}

/** Google brand glyph (the four-colour "G"). */
export function GoogleLogo({ className = "size-5" }: { className?: string }) {
  return (
    <svg aria-hidden viewBox="0 0 48 48" className={className}>
      <path
        fill="#EA4335"
        d="M24 9.5c3.5 0 6.6 1.2 9.1 3.6l6.8-6.8C35.8 2.4 30.3 0 24 0 14.6 0 6.5 5.4 2.6 13.2l7.9 6.1C12.4 13.6 17.7 9.5 24 9.5z"
      />
      <path
        fill="#4285F4"
        d="M46.5 24.5c0-1.6-.1-3.1-.4-4.5H24v9h12.7c-.6 3-2.3 5.5-4.8 7.2l7.6 5.9c4.4-4.1 7-10.1 7-17.6z"
      />
      <path
        fill="#FBBC05"
        d="M10.5 28.7a14.5 14.5 0 0 1 0-9.4l-7.9-6.1a24 24 0 0 0 0 21.6l7.9-6.1z"
      />
      <path
        fill="#34A853"
        d="M24 48c6.5 0 11.9-2.1 15.9-5.8l-7.6-5.9c-2.1 1.4-4.9 2.3-8.3 2.3-6.3 0-11.6-4.1-13.5-9.8l-7.9 6.1C6.5 42.6 14.6 48 24 48z"
      />
    </svg>
  );
}
/** `api` is the Google Cloud API the service needs enabled in the user's own project (mirrors plugins/google/oauth.ts). */
const GROUPS: Record<string, { icon: Icon; color: string; hint: string; api: string }> = {
  Gmail: {
    icon: EnvelopeIcon,
    color: "text-[#EA4335]",
    hint: "Search and draft mail",
    api: "gmail.googleapis.com",
  },
  Calendar: {
    icon: CalendarIcon,
    color: "text-[#4285F4]",
    hint: "Check and schedule events",
    api: "calendar-json.googleapis.com",
  },
  Drive: {
    icon: HardDriveIcon,
    color: "text-[#34A853]",
    hint: "Read documents and files",
    api: "drive.googleapis.com",
  },
  Docs: {
    icon: FileTextIcon,
    color: "text-[#4285F4]",
    hint: "Read and write documents",
    api: "docs.googleapis.com",
  },
  Sheets: {
    icon: TableIcon,
    color: "text-[#0F9D58]",
    hint: "Read and write spreadsheets",
    api: "sheets.googleapis.com",
  },
};
const GROUP_NAMES = Object.keys(GROUPS);

/** Mirrors the server's scope ids (plugins/google/oauth.ts). Nothing is requested until the user ticks it. */
const SCOPES: { id: string; label: string; group: string }[] = [
  { id: "gmail.readonly", group: "Gmail", label: "Read messages" },
  {
    id: "gmail.compose",
    group: "Gmail",
    label: "Create drafts (you review and send them yourself)",
  },
  { id: "gmail.send", group: "Gmail", label: "Send email" },
  { id: "calendar.events.readonly", group: "Calendar", label: "Read events" },
  { id: "calendar.events", group: "Calendar", label: "Create and edit events" },
  { id: "drive.readonly", group: "Drive", label: "Read all files" },
  { id: "drive.file", group: "Drive", label: "Only files created or opened with Zetta" },
  { id: "documents.readonly", group: "Docs", label: "Read documents" },
  { id: "documents", group: "Docs", label: "Create and edit documents" },
  { id: "spreadsheets.readonly", group: "Sheets", label: "Read spreadsheets" },
  { id: "spreadsheets", group: "Sheets", label: "Create and edit spreadsheets" },
];
const REASON: Record<string, string> = {
  ACCESS_DENIED: "Google access was declined.",
  INVALID_STATE: "That sign-in link expired. Try again.",
  STATE_EXPIRED: "That sign-in took too long. Try again.",
  EXCHANGE_FAILED: "Google rejected the sign-in. Try again.",
  NO_REFRESH_TOKEN:
    "Google did not grant offline access. Remove Zetta from your Google account permissions and try again.",
  NO_EMAIL: "Google did not say which account signed in. Try again.",
  TOO_MANY_ACCOUNTS:
    "That is the most Google accounts that can be connected. Disconnect one first.",
  NOT_CONFIGURED: "Add your Google OAuth client ID and secret in Settings first.",
};

/** One connected Google account, as the server reports it (never tokens). */
type GoogleAccountInfo = {
  email: string;
  state: "connected" | "needs-auth";
  scopes: string[];
  allowSend: boolean;
};
/** A connection from before accounts existed has no known email; the server calls it "unknown". */
const nameOf = (email: string) => (email === "unknown" ? "Your Google account" : email);

/** The permission checkboxes, grouped by Google service. Owns no state. */
function Permissions({
  scopes,
  allowSend,
  onScopes,
  onAllowSend,
}: {
  scopes: Set<string>;
  allowSend: boolean;
  onScopes: (s: Set<string>) => void;
  onAllowSend: (on: boolean) => void;
}) {
  const toggle = (id: string, on: boolean) => {
    const n = new Set(scopes);
    if (on) n.add(id);
    else n.delete(id);
    onScopes(n);
    if (id === "gmail.send" && !on) onAllowSend(false);
  };
  return (
    <>
      <p className="text-xs text-muted-foreground">
        Each service also needs its API switched on in your Google Cloud project (a link is in each
        box). If a bot reports “API is not enabled”, enable that API and try again.
      </p>
      <div className="grid items-start gap-3 sm:grid-cols-2 lg:grid-cols-3">
        {GROUP_NAMES.map((g) => {
          const G = GROUPS[g]!;
          return (
            <fieldset key={g} className="min-w-0 space-y-2.5 rounded-lg border bg-muted/20 p-3">
              <legend className="sr-only">{g}</legend>
              <div className="flex items-center gap-2" aria-hidden>
                <G.icon className={`size-4 shrink-0 ${G.color}`} />
                <div className="min-w-0">
                  <p className="text-xs font-medium leading-none">{g}</p>
                  <p className="mt-1 truncate text-xs text-muted-foreground">{G.hint}</p>
                </div>
              </div>
              {SCOPES.filter((s) => s.group === g).map((s) => (
                <Check key={s.id} checked={scopes.has(s.id)} onChange={(on) => toggle(s.id, on)}>
                  {s.label}
                </Check>
              ))}
              <a
                href={`https://console.cloud.google.com/apis/library/${G.api}`}
                target="_blank"
                rel="noopener noreferrer"
                className="block text-xs text-muted-foreground underline"
              >
                Enable the {g} API
              </a>
            </fieldset>
          );
        })}
      </div>
      <Check checked={allowSend} disabled={!scopes.has("gmail.send")} onChange={onAllowSend}>
        Allow bots to send email without asking (off by default; drafts are safer)
      </Check>
    </>
  );
}

/** One account: its email, what it may do, and its own permissions and disconnect. */
function AccountCard({
  account,
  busy,
  onUpdate,
  onDisconnect,
}: {
  account: GoogleAccountInfo;
  busy: boolean;
  onUpdate: (email: string, scopes: Set<string>, allowSend: boolean) => void;
  onDisconnect: (email: string) => void;
}) {
  const [scopes, setScopes] = useState(new Set(account.scopes));
  const [allowSend, setAllowSend] = useState(account.allowSend);
  useEffect(() => {
    setScopes(new Set(account.scopes));
    setAllowSend(account.allowSend);
  }, [account.scopes.join(" "), account.allowSend]);
  const ok = account.state === "connected";
  const services = GROUP_NAMES.filter((g) =>
    SCOPES.some((s) => s.group === g && account.scopes.includes(s.id)),
  );
  return (
    <section
      className="space-y-2 rounded-lg border p-3"
      aria-label={`Google account ${nameOf(account.email)}`}
    >
      <div className="flex flex-wrap items-center gap-2">
        {ok ? (
          <CheckCircleIcon aria-hidden className="size-4 shrink-0 text-primary" />
        ) : (
          <WarningIcon aria-hidden className="size-4 shrink-0 text-destructive" />
        )}
        <strong className="min-w-0 break-all text-sm">{nameOf(account.email)}</strong>
        <span className="text-xs text-muted-foreground">
          {ok ? services.join(", ") || "No permissions" : "Reconnect needed"}
        </span>
        <Button
          size="sm"
          variant="outline"
          className="ml-auto"
          onClick={() => onDisconnect(account.email)}
          disabled={busy}
        >
          Disconnect
        </Button>
      </div>
      <details>
        <summary className="cursor-pointer text-xs text-muted-foreground">
          {ok ? "Change permissions" : "Choose permissions to reconnect"}
        </summary>
        <div className="mt-2 space-y-3">
          <Permissions
            scopes={scopes}
            allowSend={allowSend}
            onScopes={setScopes}
            onAllowSend={setAllowSend}
          />
          <Button
            size="sm"
            onClick={() => onUpdate(account.email, scopes, allowSend)}
            loading={busy}
            disabled={busy || (!ok && scopes.size === 0)}
          >
            {ok ? (
              <>
                <ShieldCheckIcon aria-hidden className="size-4" />
                Update permissions
              </>
            ) : (
              <>
                <GoogleLogo className="size-4" />
                Reconnect
              </>
            )}
          </Button>
        </div>
      </details>
    </section>
  );
}

/**
 * Studio > Plugins > Google: the connected Google accounts (each with its own permissions), and a picker to add another one.
 * Sign-in goes through Google's consent screen; tokens never reach the browser.
 */
export function GoogleConnect({
  probe,
  onChanged,
  onError,
  initialScopes,
  newTab = false,
}: {
  probe?: PluginTest;
  onChanged: () => void;
  onError: (m: string) => void;
  /** Permissions ticked before the account is connected (the chat setup card passes the ones the bot needs). */
  initialScopes?: string[];
  /** Open Google's consent screen in a new tab, so the page that asked (a chat) stays where it is. */
  newTab?: boolean;
}) {
  const pluginsApi = usePluginApi();
  const accounts =
    (probe?.status.info as { accounts?: GoogleAccountInfo[] } | undefined)?.accounts ?? [];
  const [scopes, setScopes] = useState<Set<string>>(new Set(initialScopes));
  const [allowSend, setAllowSend] = useState(false);
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState<string>();
  useEffect(() => {
    // result of the redirect from the server callback: only a flag, never a token
    const q = new URLSearchParams(window.location.search);
    if (q.get("plugin") !== "google") return;
    const ok = q.get("status") === "ok";
    const reason = q.get("reason");
    setNotice(
      ok ? "Google connected." : (REASON[reason ?? ""] ?? "Google could not be connected."),
    );
    window.history.replaceState(null, "", window.location.pathname);
  }, []);
  /** Starts Google's consent for a new account, or for `account` when it is given. */
  async function connect(picked: Set<string>, send: boolean, account?: string) {
    setBusy(true);
    setNotice(undefined);
    try {
      const r = await pluginsApi.connect("google", {
        scopes: [...picked],
        allowSend: send,
        ...(account && { account }),
      });
      if (r.authorizeUrl) {
        if (newTab) {
          window.open(r.authorizeUrl, "_blank", "noopener,noreferrer");
          setNotice("Finish signing in on the Google tab. This page updates by itself.");
        } else window.location.assign(r.authorizeUrl);
        return;
      }
      setNotice("Saved.");
      onChanged();
    } catch (e) {
      onError(errorMessage(e));
    } finally {
      setBusy(false);
    }
  }
  async function disconnect(account: string) {
    setBusy(true);
    try {
      await pluginsApi.disconnect("google", { account });
      onChanged();
    } catch (e) {
      onError(errorMessage(e));
    } finally {
      setBusy(false);
    }
  }
  const picker = (
    <div className="space-y-3">
      <Permissions
        scopes={scopes}
        allowSend={allowSend}
        onScopes={setScopes}
        onAllowSend={setAllowSend}
      />
      <Button
        size="sm"
        onClick={() => void connect(scopes, allowSend)}
        loading={busy}
        disabled={busy || scopes.size === 0}
      >
        <GoogleLogo className="size-4" />
        {accounts.length ? "Connect another account" : "Connect with Google"}
      </Button>
    </div>
  );
  return (
    <div className="mt-3 space-y-3 border-t pt-3 text-sm" aria-label="Google connection">
      <p className="text-xs text-muted-foreground">
        {probe?.status.state === "error"
          ? probe.status.detail
          : accounts.length
            ? "Bots can use any of these accounts. Pick the account in your request when you have several."
            : "Not connected. Choose what bots may do, then connect."}
      </p>
      {notice && (
        <Alert theme={notice === "Google connected." ? "success" : "info"}>{notice}</Alert>
      )}
      {accounts.map((a) => (
        <AccountCard
          key={a.email}
          account={a}
          busy={busy}
          onUpdate={(email, picked, send) => void connect(picked, send, email)}
          onDisconnect={(email) => void disconnect(email)}
        />
      ))}
      {accounts.length ? (
        <details>
          <summary className="cursor-pointer text-xs text-muted-foreground">
            Add another Google account
          </summary>
          <div className="mt-2">{picker}</div>
        </details>
      ) : (
        picker
      )}
    </div>
  );
}
