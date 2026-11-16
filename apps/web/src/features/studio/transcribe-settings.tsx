import { useQuery } from "@tanstack/react-query";
import { useEffect, useState, type FormEvent, type ReactNode } from "react";

import { Button, Input, Select } from "@/components/ui";
import { errorMessage } from "../chat/chat-client";
import { identityQueries } from "../identity/identity-queries";
import {
  installationApi,
  installationQueries,
  type Installation,
  type TranscribeProvider,
  type TranscribeSettingsPatch,
  type TranscribeTest,
} from "../onboarding/installation-api";

const PROVIDER_OPTIONS: { value: TranscribeProvider; label: string }[] = [
  { value: "local", label: "This server (a Whisper model, nothing leaves the machine)" },
  { value: "openai", label: "OpenAI" },
  { value: "compatible", label: "Another provider (an address that works like OpenAI's)" },
];
const PROVIDER_NAME: Record<TranscribeProvider, string> = {
  local: "this server",
  openai: "OpenAI",
  compatible: "another provider",
};
const KEY_NOTE: Record<Installation["transcribeKey"], string> = {
  none: "No key saved.",
  set: "A key is saved. It is stored encrypted and is never shown again.",
  operator: "No key saved here: the key the operator set on the server is used.",
  unavailable:
    "The saved key cannot be read any more (the administrator who saved it may have left). Enter it again.",
};

/** Where recordings go for a choice: the words the page puts next to it, so nobody turns it on by surprise. */
export function destinationOf(provider: TranscribeProvider, baseUrl: string) {
  if (provider === "local") return undefined;
  if (provider === "openai") return "api.openai.com";
  try {
    return new URL(baseUrl).host || "that address";
  } catch {
    return "that address";
  }
}

export type TranscribeDraft = {
  provider: TranscribeProvider;
  model: string;
  language: string;
  baseUrl: string;
};
// A server older than this page sends none of the fields: they read as the defaults, never as a crash.
export const draftOfSettings = (s: Installation): TranscribeDraft => ({
  provider: s.transcribeProvider ?? "local",
  model: s.transcribeModel ?? "",
  language: s.transcribeLanguage ?? "",
  baseUrl: s.transcribeBaseUrl ?? "",
});
const sameDraft = (a: TranscribeDraft, b: TranscribeDraft) =>
  a.provider === b.provider &&
  a.model.trim() === b.model.trim() &&
  a.language.trim() === b.language.trim() &&
  (a.provider === "compatible" ? a.baseUrl.trim() === b.baseUrl.trim() : true);

function Note({ children, role }: { children: ReactNode; role?: "status" | "alert" | "note" }) {
  return (
    <p role={role} className="text-xs text-pretty text-muted-foreground">
      {children}
    </p>
  );
}

/**
 * Speech to text of the whole installation: the model that runs inside the server, or a provider that takes the recording (OpenAI, or any
 * address that works like it). Voice notes from outside people use the same choice, so it is the administrator's. The key is write-only:
 * it is sealed in the browser, stored encrypted, and never shown again.
 */
export function TranscribeForm({
  saved,
  admin,
  onSave,
  onSaveKey,
  onRemoveKey,
  onTest,
}: {
  saved: Installation;
  admin: boolean;
  onSave: (patch: TranscribeSettingsPatch) => Promise<void>;
  onSaveKey: (secret: string) => Promise<void>;
  onRemoveKey: () => Promise<void>;
  onTest: () => Promise<TranscribeTest>;
}) {
  const [draft, setDraft] = useState<TranscribeDraft>(draftOfSettings(saved));
  const [secret, setSecret] = useState("");
  const [busy, setBusy] = useState<"save" | "key" | "test" | undefined>();
  const [message, setMessage] = useState<{ kind: "ok" | "error"; text: string }>();
  // The draft follows what is saved when that changes (first load, a save).
  useEffect(() => setDraft(draftOfSettings(saved)), [saved]);
  const set = (patch: Partial<TranscribeDraft>) => {
    setMessage(undefined);
    setDraft((d) => ({ ...d, ...patch }));
  };
  const dirty = !sameDraft(draft, draftOfSettings(saved));
  const remote = draft.provider !== "local";
  const current = draftOfSettings(saved);
  const keyState = saved.transcribeKey ?? "none";
  const savedRemote = current.provider !== "local";
  const destination = destinationOf(draft.provider, draft.baseUrl);
  const needsAddress = draft.provider === "compatible" && !draft.baseUrl.trim();

  async function run<T>(
    what: "save" | "key" | "test",
    work: () => Promise<T>,
    done?: (r: T) => string | { kind: "ok" | "error"; text: string },
  ) {
    setBusy(what);
    setMessage(undefined);
    try {
      const r = await work();
      if (done) {
        const said = done(r);
        setMessage(typeof said === "string" ? { kind: "ok", text: said } : said);
      }
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
          transcribeProvider: draft.provider,
          transcribeModel: draft.model.trim(),
          transcribeLanguage: draft.language.trim(),
          transcribeBaseUrl: draft.provider === "compatible" ? draft.baseUrl.trim() : "",
        }),
      () => "Saved.",
    );
  }
  function saveKey() {
    const value = secret;
    // The field is cleared at once: the page never keeps a key it sent.
    setSecret("");
    void run(
      "key",
      () => onSaveKey(value),
      () => "Key saved. It is stored encrypted and will not be shown again.",
    );
  }

  if (!admin)
    return (
      <section className="space-y-1" aria-label="Speech to text">
        <h3 className="text-sm font-medium">Speech to text</h3>
        <Note>
          Recordings are turned into text by {PROVIDER_NAME[current.provider]}
          {destinationOf(current.provider, current.baseUrl)
            ? ` (${destinationOf(current.provider, current.baseUrl)})`
            : ""}
          . Ask your administrator to change this.
        </Note>
      </section>
    );

  return (
    <form onSubmit={submit} className="space-y-4" aria-label="Speech to text">
      <h3 className="text-sm font-medium">Speech to text</h3>
      <Select
        title="Who turns recordings into text"
        name="transcribeProvider"
        required={false}
        value={draft.provider}
        options={PROVIDER_OPTIONS}
        onChange={(e) => set({ provider: e.target.value as TranscribeProvider })}
      />
      {destination ? (
        <Note role="note">
          Recordings from the microphone and voice notes from outside people are sent to{" "}
          {destination}. Their rules apply to that audio.
        </Note>
      ) : (
        <Note>
          Recordings stay on this server. The model is downloaded once (about 250 MB) and runs on
          this machine, so a small server may be slow.
        </Note>
      )}
      {draft.provider === "compatible" && (
        <Input
          title="Address of the provider"
          name="transcribeBaseUrl"
          inputMode="url"
          autoComplete="off"
          value={draft.baseUrl}
          placeholder="https://api.example.com/v1"
          onChange={(e) => set({ baseUrl: e.target.value })}
        />
      )}
      {remote && (
        <Input
          title="Model"
          name="transcribeModel"
          autoComplete="off"
          value={draft.model}
          placeholder={draft.provider === "openai" ? "whisper-1 (default)" : "whisper-1"}
          onChange={(e) => set({ model: e.target.value })}
        />
      )}
      <Input
        title="Language of the recordings"
        name="transcribeLanguage"
        autoComplete="off"
        value={draft.language}
        placeholder="Empty: the language of each person's browser"
        onChange={(e) => set({ language: e.target.value })}
      />
      <Note>
        A code or a name: pt, es, French… The microphone uses the person's browser language; this
        one serves voice notes, which have none. Whisper assumes English when it is not told.
      </Note>

      {remote && (
        <div className="space-y-2">
          <Input
            title="API key"
            name="transcribeKey"
            type="password"
            autoComplete="off"
            value={secret}
            placeholder={keyState === "set" ? "A key is saved" : "sk-…"}
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
                onClick={() => void run("key", onRemoveKey, () => "Key removed.")}
              >
                Remove key
              </Button>
            )}
            <Note>{KEY_NOTE[keyState]}</Note>
          </div>
        </div>
      )}

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
              ? "Save the settings first: the test uses what is saved"
              : "Try it with one second of silence"
          }
          onClick={() =>
            void run("test", onTest, (r) =>
              r.ok
                ? {
                    kind: "ok",
                    text: `It works${savedRemote ? ": the provider answered" : ": the model ran"}.`,
                  }
                : { kind: "error", text: r.message ?? "It did not work." },
            )
          }
        >
          {busy === "test" ? "Testing…" : "Test"}
        </Button>
        <Button type="submit" size="sm" disabled={busy !== undefined || !dirty || needsAddress}>
          {destination ? `Save: recordings go to ${destination}` : "Save"}
        </Button>
      </div>
    </form>
  );
}

/** The speech-to-text setting of this installation, for Studio and the Chief's installation card. */
export function TranscribeSettings() {
  const { data: saved } = useQuery(installationQueries.get());
  const { data: identity } = useQuery(identityQueries.status());
  const admin = Boolean(identity?.state === "active" && identity.isAdmin);
  if (!saved) return null;
  return (
    <TranscribeForm
      saved={saved}
      admin={admin}
      onSave={async (patch) => void (await installationApi.patch(patch))}
      onSaveKey={async (secret) => void (await installationApi.saveTranscribeKey(secret))}
      onRemoveKey={async () => void (await installationApi.removeTranscribeKey())}
      onTest={() => installationApi.testTranscribe()}
    />
  );
}
