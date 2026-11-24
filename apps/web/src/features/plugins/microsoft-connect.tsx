import { CheckCircleIcon, WarningIcon } from "@phosphor-icons/react";
import { Alert } from "@g4rcez/components/alert";
import { useEffect, useState } from "react";

import { Button, Input } from "@/components/ui";
import { errorCode, errorMessage } from "../chat/chat-client";
import { Check } from "./google-connect";
import { usePluginApi, type PluginTest } from "./plugins-api";

/** The permissions Zetta may ask for, as the server names them (plugins/microsoft/oauth.ts). Nothing that changes or deletes mail. */
const SCOPES = [
  { id: "Mail.Read", label: "Read mail" },
  { id: "Mail.Send", label: "Send mail (a mailbox still needs its sending switch on)" },
] as const;
const REASON: Record<string, string> = {
  ACCESS_DENIED: "Microsoft access was declined.",
  INVALID_STATE: "That sign-in link expired. Try again.",
  STATE_EXPIRED: "That sign-in took too long. Try again.",
  EXCHANGE_FAILED: "Microsoft rejected the sign-in. Try again.",
  NO_REFRESH_TOKEN:
    "Microsoft did not grant offline access. Remove the app from your Microsoft account permissions and try again.",
  NO_EMAIL: "Microsoft did not say which account signed in. Try again.",
  TOO_MANY_ACCOUNTS: "That is the most accounts that can be connected. Disconnect one first.",
  NOT_CONFIGURED: "Add your app registration's client ID in Settings first.",
  PASTE_INVALID:
    "That is not the address the sign-in ended on. Copy the whole address from the browser bar of the page that did not load.",
};

type MicrosoftAccountInfo = {
  email: string;
  state: "connected" | "needs-auth";
  scopes: string[];
};

/** A public client's redirect cannot load: the person copies that page's address and pastes it here. */
function MicrosoftPasteStep({
  busy,
  onSubmit,
  onCancel,
}: {
  busy: boolean;
  onSubmit: (address: string) => void;
  onCancel: () => void;
}) {
  const [address, setAddress] = useState("");
  return (
    <form
      className="space-y-2 rounded-md border p-3"
      aria-label="Finish Microsoft sign-in"
      onSubmit={(e) => {
        e.preventDefault();
        onSubmit(address);
      }}
    >
      <p className="text-xs text-muted-foreground">
        Finish the sign-in on the Microsoft tab. It ends on a page that does not load (localhost):
        copy that page&apos;s whole address from the browser bar and paste it here.
      </p>
      <Input
        name="address"
        type="url"
        value={address}
        onChange={(e) => setAddress(e.target.value)}
        placeholder="http://localhost:53682/?code=…&state=…"
        autoComplete="off"
        spellCheck={false}
        required
      />
      <div className="flex gap-2">
        <Button size="sm" type="submit" loading={busy} disabled={busy || !address.trim()}>
          Finish
        </Button>
        <Button size="sm" type="button" variant="ghost" onClick={onCancel} disabled={busy}>
          Cancel
        </Button>
      </div>
    </form>
  );
}

/** One connected account: its email, what it may do, and a disconnect. */
function MicrosoftAccountCard({
  account,
  busy,
  onDisconnect,
}: {
  account: MicrosoftAccountInfo;
  busy: boolean;
  onDisconnect: (email: string) => void;
}) {
  const ok = account.state === "connected";
  return (
    <section
      className="flex flex-wrap items-center gap-2 rounded-lg border p-3"
      aria-label={`Microsoft account ${account.email}`}
    >
      {ok ? (
        <CheckCircleIcon aria-hidden className="size-4 shrink-0 text-primary" />
      ) : (
        <WarningIcon aria-hidden className="size-4 shrink-0 text-destructive" />
      )}
      <strong className="min-w-0 break-all text-sm">{account.email}</strong>
      <span className="text-xs text-muted-foreground">
        {ok
          ? SCOPES.filter((s) => account.scopes.includes(s.id))
              .map((s) => s.label.split(" (")[0])
              .join(", ") || "No permissions"
          : "Reconnect needed"}
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
    </section>
  );
}

/**
 * Studio > Plugins > Microsoft: the connected accounts, and the permissions to ask for when adding one. Sign-in goes through Microsoft's
 * consent screen; tokens never reach the browser. The accounts become mailboxes by themselves (Mail).
 */
export function MicrosoftConnect({
  probe,
  onChanged,
  onError,
}: {
  probe?: PluginTest;
  onChanged: () => void;
  onError: (m: string) => void;
}) {
  const pluginsApi = usePluginApi();
  const info = probe?.status.info as
    | { accounts?: MicrosoftAccountInfo[]; signIn?: { completion?: string } }
    | undefined;
  const accounts = info?.accounts ?? [];
  const [scopes, setScopes] = useState<Set<string>>(new Set(["Mail.Read"]));
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState<string>();
  const [step, setStep] = useState<"idle" | "paste" | "dismissed">("idle");
  const pasting =
    step === "paste" || (step !== "dismissed" && info?.signIn?.completion === "paste");
  useEffect(() => {
    // A web client's redirect comes back to this page with only a flag, never a token.
    const q = new URLSearchParams(window.location.search);
    if (q.get("plugin") !== "microsoft") return;
    const reason = q.get("reason");
    setNotice(
      q.get("status") === "ok"
        ? "Microsoft connected."
        : (REASON[reason ?? ""] ?? "Microsoft could not be connected."),
    );
    window.history.replaceState(null, "", window.location.pathname);
  }, []);

  async function connect() {
    setBusy(true);
    setNotice(undefined);
    try {
      const r = await pluginsApi.connect("microsoft", { scopes: [...scopes] });
      if (r.authorizeUrl) {
        if (r.data?.completion === "paste") {
          window.open(r.authorizeUrl, "_blank", "noopener,noreferrer");
          setStep("paste");
        } else window.location.assign(r.authorizeUrl);
      }
    } catch (e) {
      onError(errorMessage(e));
    } finally {
      setBusy(false);
    }
  }
  async function complete(address: string) {
    setBusy(true);
    try {
      await pluginsApi.complete("microsoft", address);
      setStep("idle");
      setNotice("Microsoft connected.");
      onChanged();
    } catch (e) {
      setNotice(REASON[errorCode(e) ?? ""] ?? errorMessage(e));
    } finally {
      setBusy(false);
    }
  }
  async function disconnect(account: string) {
    setBusy(true);
    try {
      await pluginsApi.disconnect("microsoft", { account });
      onChanged();
    } catch (e) {
      onError(errorMessage(e));
    } finally {
      setBusy(false);
    }
  }
  const toggle = (id: string, on: boolean) => {
    const n = new Set(scopes);
    if (on) n.add(id);
    else n.delete(id);
    setScopes(n);
  };
  return (
    <div className="mt-3 space-y-3 border-t pt-3 text-sm" aria-label="Microsoft connection">
      <p className="text-xs text-muted-foreground">
        {probe?.status.state === "error"
          ? probe.status.detail
          : accounts.length
            ? "Each account is a mailbox in Mail by itself. Zetta never asks to change or delete mail."
            : "Not connected. Choose what Zetta may do, then sign in with Microsoft."}
      </p>
      {notice && (
        <Alert theme={notice === "Microsoft connected." ? "success" : "info"}>{notice}</Alert>
      )}
      {pasting && (
        <MicrosoftPasteStep
          busy={busy}
          onSubmit={(address) => void complete(address)}
          onCancel={() => setStep("dismissed")}
        />
      )}
      {accounts.map((a) => (
        <MicrosoftAccountCard
          key={a.email}
          account={a}
          busy={busy}
          onDisconnect={(email) => void disconnect(email)}
        />
      ))}
      <fieldset className="space-y-2 rounded-lg border bg-muted/20 p-3">
        <legend className="px-1 text-xs font-medium">Permissions for the account you add</legend>
        {SCOPES.map((s) => (
          <Check key={s.id} checked={scopes.has(s.id)} onChange={(on) => toggle(s.id, on)}>
            {s.label}
          </Check>
        ))}
      </fieldset>
      <Button
        size="sm"
        onClick={() => void connect()}
        loading={busy}
        disabled={busy || !scopes.size}
      >
        {accounts.length ? "Connect another account" : "Sign in with Microsoft"}
      </Button>
    </div>
  );
}
