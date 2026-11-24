import { useQuery } from "@tanstack/react-query";
import {
  speechIsLocal,
  speechIsRemote,
  speechNeedsAddress,
  type SpeechProvider,
} from "@zetta/core/speech";
import { useEffect, useState, type FormEvent, type ReactNode } from "react";

import { Button, Input, Select } from "@/components/ui";
import { errorMessage } from "../chat/chat-client";
import { identityQueries } from "../identity/identity-queries";
import {
  installationApi,
  installationQueries,
  type Installation,
  type SpeechSettingsPatch,
  type SpeechTest,
} from "../onboarding/installation-api";

const PROVIDER_OPTIONS: { value: SpeechProvider; label: string }[] = [
  { value: "browser", label: "The browser's own voice (nothing is sent anywhere)" },
  { value: "local", label: "A voice on this server (no key; one download of about 100 MB)" },
  { value: "openai", label: "OpenAI" },
  { value: "elevenlabs", label: "ElevenLabs" },
  { value: "compatible", label: "Another provider (an address that works like OpenAI's)" },
  { value: "off", label: "Off (no Listen button, no spoken answers)" },
];
const PROVIDER_NAME: Record<SpeechProvider, string> = {
  off: "nobody (it is off)",
  browser: "each person's browser",
  local: "this server",
  openai: "OpenAI",
  elevenlabs: "ElevenLabs",
  compatible: "another provider",
};
const KEY_NOTE: Record<NonNullable<Installation["speechKey"]>, string> = {
  none: "No key saved.",
  set: "A key is saved. It is stored encrypted and is never shown again.",
  unavailable:
    "The saved key cannot be read any more (the administrator who saved it may have left). Enter it again.",
};
const MODEL_HINT: Partial<Record<SpeechProvider, string>> = {
  openai: "gpt-4o-mini-tts (default)",
  elevenlabs: "eleven_flash_v2_5 (default)",
  compatible: "tts-1 (default)",
  local: "onnx-community/Kokoro-82M-v1.0-ONNX (default, about 100 MB)",
};
const VOICE_HINT: Partial<Record<SpeechProvider, string>> = {
  local: "Empty: by language (pf_dora for Portuguese, ef_dora for Spanish, af_heart for English)",
  openai: "alloy (default)",
  elevenlabs: "A voice id from your ElevenLabs account",
  compatible: "alloy (default)",
};

/**
 * Where the text goes for a choice: the words the page puts next to it, so nobody turns it on by surprise. A bot's reply is sent to the
 * provider only when somebody presses Listen or starts a voice conversation.
 */
export function speechDestinationOf(provider: SpeechProvider, baseUrl: string) {
  if (!speechIsRemote(provider)) return undefined;
  if (provider === "openai") return "api.openai.com";
  if (provider === "elevenlabs") return "api.elevenlabs.io";
  try {
    return new URL(baseUrl).host || "that address";
  } catch {
    return "that address";
  }
}

export type SpeechDraft = {
  provider: SpeechProvider;
  model: string;
  voice: string;
  language: string;
  baseUrl: string;
};
// A server older than this page sends none of the fields: they read as the defaults, never as a crash.
export const speechDraftOf = (s: Installation): SpeechDraft => ({
  provider: s.speechProvider ?? "browser",
  model: s.speechModel ?? "",
  voice: s.speechVoice ?? "",
  language: s.speechLanguage ?? "",
  baseUrl: s.speechBaseUrl ?? "",
});
const sameDraft = (a: SpeechDraft, b: SpeechDraft) =>
  a.provider === b.provider &&
  a.model.trim() === b.model.trim() &&
  a.voice.trim() === b.voice.trim() &&
  a.language.trim() === b.language.trim() &&
  (speechNeedsAddress(a.provider) ? a.baseUrl.trim() === b.baseUrl.trim() : true);

function Note({ children, role }: { children: ReactNode; role?: "status" | "alert" | "note" }) {
  return (
    <p role={role} className="text-xs text-pretty text-muted-foreground">
      {children}
    </p>
  );
}

/**
 * Text to speech of the whole installation: the browser's own voice, or a provider that turns text into audio (OpenAI, ElevenLabs, or any
 * address that works like OpenAI's). Same design as speech to text: the administrator chooses, the key is write-only (sealed in the
 * browser, stored encrypted, never shown again), and a Test speaks one sentence.
 */
export function SpeechForm({
  saved,
  admin,
  onSave,
  onSaveKey,
  onRemoveKey,
  onTest,
}: {
  saved: Installation;
  admin: boolean;
  onSave: (patch: SpeechSettingsPatch) => Promise<void>;
  onSaveKey: (secret: string) => Promise<void>;
  onRemoveKey: () => Promise<void>;
  onTest: () => Promise<SpeechTest>;
}) {
  const [draft, setDraft] = useState<SpeechDraft>(speechDraftOf(saved));
  const [secret, setSecret] = useState("");
  const [busy, setBusy] = useState<"save" | "key" | "test" | undefined>();
  const [message, setMessage] = useState<{ kind: "ok" | "error"; text: string }>();
  // The draft follows what is saved when that changes (first load, a save).
  useEffect(() => setDraft(speechDraftOf(saved)), [saved]);
  const set = (patch: Partial<SpeechDraft>) => {
    setMessage(undefined);
    setDraft((d) => ({ ...d, ...patch }));
  };
  const current = speechDraftOf(saved);
  const dirty = !sameDraft(draft, current);
  const remote = speechIsRemote(draft.provider);
  const hasVoice = remote || speechIsLocal(draft.provider);
  const keyState = saved.speechKey ?? "none";
  const destination = speechDestinationOf(draft.provider, draft.baseUrl);
  const needsAddress = speechNeedsAddress(draft.provider) && !draft.baseUrl.trim();

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
          speechProvider: draft.provider,
          speechModel: hasVoice ? draft.model.trim() : "",
          speechVoice: hasVoice ? draft.voice.trim() : "",
          speechLanguage: draft.language.trim(),
          speechBaseUrl: speechNeedsAddress(draft.provider) ? draft.baseUrl.trim() : "",
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
      <section className="space-y-1" aria-label="Text to speech">
        <h3 className="text-sm font-medium">Text to speech</h3>
        <Note>
          Messages are read aloud by {PROVIDER_NAME[current.provider]}
          {speechDestinationOf(current.provider, current.baseUrl)
            ? ` (${speechDestinationOf(current.provider, current.baseUrl)})`
            : ""}
          . Ask your administrator to change this.
        </Note>
      </section>
    );

  return (
    <form onSubmit={submit} className="space-y-4" aria-label="Text to speech">
      <h3 className="text-sm font-medium">Text to speech</h3>
      <Select
        title="Who reads messages aloud"
        name="speechProvider"
        required={false}
        value={draft.provider}
        options={PROVIDER_OPTIONS}
        // A model name belongs to one kind of provider (a Hugging Face repository here, `tts-1` there): it is cleared with the choice.
        onChange={(e) => set({ provider: e.target.value as SpeechProvider, model: "" })}
      />
      {destination ? (
        <Note role="note">
          The text of a message is sent to {destination} when somebody presses Listen (and, later,
          in a voice conversation). Their rules apply to that text.
        </Note>
      ) : speechIsLocal(draft.provider) ? (
        <Note role="note">
          The voice runs inside Zetta on this server: no key, no account, and nothing leaves the
          machine. It downloads one model of about 100 MB the first time it is used (the first test
          or Listen takes longer), then works offline. It speaks English, Spanish and Brazilian
          Portuguese, and it works on a phone call, which the browser voice cannot.
        </Note>
      ) : draft.provider === "browser" ? (
        <Note>
          The text stays on the page: the browser speaks it with a voice of the person's device.
          Voices and languages depend on the device.
        </Note>
      ) : (
        <Note>Nothing is read aloud and the Listen button is hidden.</Note>
      )}
      {speechNeedsAddress(draft.provider) && (
        <Input
          title="Address of the provider"
          name="speechBaseUrl"
          inputMode="url"
          autoComplete="off"
          value={draft.baseUrl}
          placeholder="https://tts.example.com/v1"
          onChange={(e) => set({ baseUrl: e.target.value })}
        />
      )}
      {hasVoice && (
        <Input
          title="Model"
          name="speechModel"
          autoComplete="off"
          value={draft.model}
          placeholder={MODEL_HINT[draft.provider]}
          onChange={(e) => set({ model: e.target.value })}
        />
      )}
      {hasVoice && (
        <>
          <Input
            title="Voice"
            name="speechVoice"
            autoComplete="off"
            value={draft.voice}
            placeholder={VOICE_HINT[draft.provider]}
            onChange={(e) => set({ voice: e.target.value })}
          />
          <Note>
            Each bot can have a voice of its own in its settings; this one is used when it has none.
          </Note>
        </>
      )}
      {draft.provider !== "off" && (
        <>
          <Input
            title="Language of the text"
            name="speechLanguage"
            autoComplete="off"
            value={draft.language}
            placeholder="Empty: the provider works it out from the text"
            onChange={(e) => set({ language: e.target.value })}
          />
          <Note>
            A code or a name: pt, es, French… OpenAI voices are tuned for English and speak
            Portuguese and Spanish with an accent; ElevenLabs flash and multilingual models cover
            both.
          </Note>
        </>
      )}

      {remote && (
        <div className="space-y-2">
          <Input
            title="API key"
            name="speechKey"
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
              : "Speak one short sentence"
          }
          onClick={() =>
            void run("test", onTest, (r) =>
              r.ok
                ? {
                    kind: "ok",
                    text: r.message ?? "It works: the provider spoke one sentence.",
                  }
                : { kind: "error", text: r.message ?? "It did not work." },
            )
          }
        >
          {busy === "test" ? "Testing…" : "Test"}
        </Button>
        <Button type="submit" size="sm" disabled={busy !== undefined || !dirty || needsAddress}>
          {destination ? `Save: text goes to ${destination}` : "Save"}
        </Button>
      </div>
    </form>
  );
}

/** The text-to-speech setting of this installation, for Studio. */
export function SpeechSettings() {
  const { data: saved } = useQuery(installationQueries.get());
  const { data: identity } = useQuery(identityQueries.status());
  const admin = Boolean(identity?.state === "active" && identity.isAdmin);
  if (!saved) return null;
  return (
    <SpeechForm
      saved={saved}
      admin={admin}
      onSave={async (patch) => void (await installationApi.patch(patch))}
      onSaveKey={async (secret) => void (await installationApi.saveSpeechKey(secret))}
      onRemoveKey={async () => void (await installationApi.removeSpeechKey())}
      onTest={() => installationApi.testSpeech()}
    />
  );
}
