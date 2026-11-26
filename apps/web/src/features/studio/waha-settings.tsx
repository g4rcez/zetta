import { useQuery } from "@tanstack/react-query";
import { DEFAULT_WAHA_URL } from "@zetta/core/waha";
import { useEffect, useState, type FormEvent, type ReactNode } from "react";

import { Button, Input } from "@/components/ui";
import { errorMessage } from "../chat/chat-client";
import { identityQueries } from "../identity/identity-queries";
import {
  installationApi,
  installationQueries,
  type Installation,
  type WahaTest,
} from "../onboarding/installation-api";
import { settingsApi, settingsQueries } from "./settings-api";
import { isRootIdentity } from "@/lib/identity-client";

const KEY_NOTE: Record<NonNullable<Installation["wahaKey"]>, string> = {
  none: "No key saved. Without one, Zetta calls the server with no key.",
  set: "A key is saved. It is stored encrypted and is never shown again.",
  unavailable:
    "The saved key cannot be read any more (the administrator who saved it may have left). Enter it again.",
};

function Note({ children, role }: { children: ReactNode; role?: "status" | "alert" | "note" }) {
  return (
    <p role={role} className="text-xs text-pretty text-muted-foreground">
      {children}
    </p>
  );
}

/**
 * The WhatsApp server (WAHA) every person shares who uses WhatsApp without a server of their own. The address is the setting `wahaUrl`
 * (empty: the built-in address); the key is write-only: sealed in the browser, stored encrypted, never shown again. A person's own server,
 * typed in their plugin settings, always wins and never receives this key.
 */
export function WahaForm({
  address,
  keyState,
  admin,
  onSaveAddress,
  onSaveKey,
  onRemoveKey,
  onTest,
}: {
  /** The saved address; empty means the built-in one. */
  address: string;
  keyState: NonNullable<Installation["wahaKey"]>;
  admin: boolean;
  onSaveAddress: (address: string) => Promise<void>;
  onSaveKey: (secret: string) => Promise<void>;
  onRemoveKey: () => Promise<void>;
  onTest: () => Promise<WahaTest>;
}) {
  const [draft, setDraft] = useState(address);
  const [secret, setSecret] = useState("");
  const [busy, setBusy] = useState<"save" | "key" | "test" | undefined>();
  const [message, setMessage] = useState<{ kind: "ok" | "error"; text: string }>();
  useEffect(() => setDraft(address), [address]);
  const dirty = draft.trim() !== address.trim();

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
      () => onSaveAddress(draft.trim()),
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
      <section className="space-y-1" aria-label="WhatsApp server (WAHA)">
        <h3 className="text-sm font-medium">WhatsApp server (WAHA)</h3>
        <Note>
          People who use WhatsApp without a server of their own share the server your administrator
          set up. Ask your administrator to change it.
        </Note>
      </section>
    );

  return (
    <form onSubmit={submit} className="space-y-4" aria-label="WhatsApp server (WAHA)">
      <h3 className="text-sm font-medium">WhatsApp server (WAHA)</h3>
      <Note>
        The WAHA server that everyone shares who uses WhatsApp here without a server of their own:
        they only scan a code. The key you save below is shared by all of them, so use a key made
        for this. A person who types their own server in the plugin settings uses that server and
        their own key; this key is never sent there.
      </Note>
      <Input
        title="Server address"
        name="wahaUrl"
        autoComplete="off"
        value={draft}
        placeholder={DEFAULT_WAHA_URL}
        onChange={(e) => {
          setMessage(undefined);
          setDraft(e.target.value);
        }}
      />
      <Note>
        Leave it empty to use the WAHA container Zetta starts next to itself ({DEFAULT_WAHA_URL}).
      </Note>
      <div className="space-y-2">
        <Input
          title="Server key (X-Api-Key)"
          name="wahaKey"
          type="password"
          autoComplete="off"
          value={secret}
          placeholder={keyState === "set" ? "A key is saved" : "The key of the WAHA server"}
          onChange={(e) => setSecret(e.target.value)}
        />
        <div className="flex flex-wrap items-center gap-2">
          <Button
            type="button"
            size="sm"
            variant="secondary"
            disabled={busy !== undefined || secret.length < 1}
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
        <Button
          type="button"
          size="sm"
          variant="ghost"
          disabled={busy !== undefined || dirty}
          title={
            dirty
              ? "Save the address first: the test uses what is saved"
              : "Ask the server for its sessions, with the saved address and key"
          }
          onClick={() =>
            void run("test", onTest, (r) => ({
              kind: r.ok ? "ok" : "error",
              text: r.message ?? (r.ok ? "It works." : "It did not work."),
            }))
          }
        >
          {busy === "test" ? "Testing…" : "Test"}
        </Button>
        <Button type="submit" size="sm" disabled={busy !== undefined || !dirty}>
          Save
        </Button>
      </div>
    </form>
  );
}

/** The shared WhatsApp server of this installation, for Studio. */
export function WahaSettings() {
  const { data: saved } = useQuery(installationQueries.get());
  const { data: identity } = useQuery(identityQueries.status());
  const admin = isRootIdentity(identity);
  const { data: list } = useQuery({ ...settingsQueries.list(), enabled: admin });
  if (!saved) return null;
  const address = list?.settings.find((s) => s.key === "wahaUrl");
  const stored = address?.source === "default" ? "" : String(address?.value ?? "");
  return (
    <WahaForm
      address={stored}
      keyState={saved.wahaKey ?? "none"}
      admin={admin}
      onSaveAddress={async (value) =>
        void (value ? await settingsApi.save("wahaUrl", value) : await settingsApi.reset("wahaUrl"))
      }
      onSaveKey={async (secret) => void (await installationApi.saveWahaKey(secret))}
      onRemoveKey={async () => void (await installationApi.removeWahaKey())}
      onTest={() => installationApi.testWaha()}
    />
  );
}
