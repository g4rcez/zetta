import { useQuery } from "@tanstack/react-query";
import { SpeakerHighIcon, SpinnerGapIcon, StopIcon } from "@phosphor-icons/react";
import { useEffect, useMemo, useRef, useState } from "react";

import { Autocomplete, Button, Input } from "@/components/ui";
import { chatClient, errorMessage, type Bot } from "../chat/chat-client";
import { installationQueries } from "../onboarding/installation-api";
import { getBotVoice, setBotVoice, toggleListen, useListenState } from "./speech-player";

const DEVICE_DEFAULT = "";

/** A short sentence in the language of the voice, so the person hears it say something it was made for. */
export function sampleSentence(botName: string, language: string): string {
  const lang = language.trim().toLowerCase();
  if (lang.startsWith("pt")) return `Olá, eu sou ${botName}. É assim que a minha voz soa.`;
  if (lang.startsWith("es")) return `Hola, soy ${botName}. Así suena mi voz.`;
  return `Hello, I'm ${botName}. This is how my voice sounds.`;
}

/**
 * "Listen voice": speaks a sample with the voice as it is chosen now, saved or not, so the choice can be confirmed before it is kept. It
 * shares the Listen player: one voice at a time, and pressing it again stops it.
 */
function ListenVoiceButton({
  bot,
  voice,
  language,
  disabled,
}: {
  bot: Bot;
  /** The voice as chosen on the page. Empty: the installation's (or this device's) default. */
  voice: string;
  language: string;
  disabled?: boolean;
}) {
  const id = `voice-preview:${bot.id}`;
  const state = useListenState();
  const mine = state.id === id ? state : undefined;
  const loading = mine?.phase === "loading";
  const playing = mine?.phase === "playing";
  return (
    <div className="flex flex-wrap items-center gap-3">
      <Button
        type="button"
        variant="outline"
        disabled={disabled}
        aria-pressed={playing}
        onClick={() =>
          void toggleListen(
            id,
            sampleSentence(bot.name, language),
            voice.trim() || undefined,
            undefined,
            language.trim() || undefined,
          )
        }
      >
        {loading ? (
          <SpinnerGapIcon aria-hidden className="animate-spin" />
        ) : playing ? (
          <StopIcon aria-hidden />
        ) : (
          <SpeakerHighIcon aria-hidden />
        )}
        {loading ? "Preparing audio" : playing ? "Stop" : "Listen voice"}
      </Button>
      <p role="alert" className="text-xs text-destructive empty:hidden">
        {mine?.phase === "error" ? mine.message : null}
      </p>
    </div>
  );
}

/** The voices of this device, once the browser has loaded them (it does that late). */
function useDeviceVoices() {
  const [voices, setVoices] = useState<{ name: string; lang: string }[]>([]);
  useEffect(() => {
    if (typeof speechSynthesis === "undefined") return;
    const read = () =>
      setVoices(speechSynthesis.getVoices().map((v) => ({ name: v.name, lang: v.lang })));
    read();
    speechSynthesis.addEventListener?.("voiceschanged", read);
    return () => speechSynthesis.removeEventListener?.("voiceschanged", read);
  }, []);
  return voices;
}

/** The browser's own voices: their names differ on every device, so the choice stays on this device. */
function DeviceVoice({ bot }: { bot: Bot }) {
  const [voice, setVoice] = useState(() => getBotVoice(bot.id));
  useEffect(() => setVoice(getBotVoice(bot.id)), [bot.id]);
  const device = useDeviceVoices();
  const language = device.find((v) => v.name === voice)?.lang ?? navigator.language ?? "";
  // Stable reference: the Autocomplete re-reads its options on every change of this list. Voices of the page's language come first.
  const options = useMemo(() => {
    const base = (navigator.language ?? "").split("-")[0]?.toLowerCase() ?? "";
    const rank = (lang: string) => (base && lang.toLowerCase().startsWith(base) ? 0 : 1);
    const sorted = [...device].sort(
      (a, b) => rank(a.lang) - rank(b.lang) || a.name.localeCompare(b.name),
    );
    return [
      { value: DEVICE_DEFAULT, label: "This device's default voice" },
      ...sorted.map((v) => ({ value: v.name, label: `${v.name} (${v.lang})` })),
    ];
  }, [device]);
  return (
    <div className="space-y-3">
      <Autocomplete
        title="Voice"
        name="botVoice"
        placeholder="Search a voice or a language"
        emptyMessage="No voice matches"
        value={voice}
        options={options}
        onChange={(e) => {
          setVoice(e.target.value);
          setBotVoice(bot.id, e.target.value.trim());
        }}
      />
      <p className="text-xs text-pretty text-muted-foreground">
        Used when you press Listen on a message of {bot.name} and in voice calls. The browser's
        voices are different on every device, so this choice is kept on this device. Leave it on the
        default to use the device's own.
      </p>
      <ListenVoiceButton bot={bot} voice={voice} language={language} />
    </div>
  );
}

/**
 * A voice of a provider (OpenAI: alloy, nova...; ElevenLabs: a voice id). It is saved on the bot, on the server: a phone call has no
 * browser to remember it, and every device then hears the same voice.
 */
function ServerVoice({
  bot,
  installationVoice,
  onBotChange,
}: {
  bot: Bot;
  installationVoice: string;
  onBotChange?: ((bot: Bot) => void) | undefined;
}) {
  // A voice chosen here before it was kept on the server is offered again once, until it is saved.
  const [voice, setVoice] = useState(bot.voice || getBotVoice(bot.id));
  const [language, setLanguage] = useState(bot.voiceLanguage ?? "");
  const [status, setStatus] = useState<string>();
  const [busy, setBusy] = useState(false);
  const version = useRef(bot.version);
  useEffect(() => {
    setVoice(bot.voice || getBotVoice(bot.id));
    setLanguage(bot.voiceLanguage ?? "");
    version.current = bot.version;
  }, [bot.id, bot.version, bot.voice, bot.voiceLanguage]);
  const changed =
    voice.trim() !== (bot.voice ?? "") || language.trim() !== (bot.voiceLanguage ?? "");
  async function save() {
    setBusy(true);
    setStatus(undefined);
    try {
      const updated = await chatClient.updateBot(bot.id, version.current, {
        voice: voice.trim() || null,
        voiceLanguage: language.trim() || null,
      });
      version.current = updated.version;
      setBotVoice(bot.id, "");
      onBotChange?.(updated);
      setStatus("Voice saved.");
    } catch (e) {
      setStatus(errorMessage(e));
    }
    setBusy(false);
  }
  return (
    <form
      className="space-y-3"
      onSubmit={(e) => {
        e.preventDefault();
        void save();
      }}
    >
      <Input
        title="Voice"
        name="botVoice"
        autoComplete="off"
        maxLength={100}
        disabled={busy || !bot.canEdit}
        value={voice}
        placeholder={
          installationVoice
            ? `${installationVoice} (the installation's voice)`
            : "The provider's default voice"
        }
        onChange={(e) => setVoice(e.target.value)}
      />
      <Input
        title="Language"
        name="botVoiceLanguage"
        autoComplete="off"
        maxLength={35}
        disabled={busy || !bot.canEdit}
        value={language}
        placeholder="For example pt-BR. Empty: the language of the call"
        onChange={(e) => setLanguage(e.target.value)}
      />
      <p className="text-xs text-pretty text-muted-foreground">
        Used when you press Listen on a message of {bot.name}, in voice calls and later on the
        phone. It is saved with the bot. Leave it empty to use the voice chosen in Studio.
        {!bot.canEdit ? " Only the owner can change this." : ""}
      </p>
      <div className="flex flex-wrap items-center gap-3">
        <ListenVoiceButton bot={bot} voice={voice} language={language} disabled={busy} />
        <Button type="submit" disabled={busy || !changed || !bot.canEdit}>
          Save voice
        </Button>
        <p role="status" className="text-xs empty:hidden">
          {status}
        </p>
      </div>
    </form>
  );
}

/**
 * The "Voice" of a bot. With the browser's voice the choice is kept on this device (device voices have no names that carry over); with a
 * provider it is saved on the bot on the server, which is what a call and the Listen button use.
 */
export function BotVoiceSection({
  bot,
  onBotChange,
}: {
  bot: Bot;
  onBotChange?: ((bot: Bot) => void) | undefined;
}) {
  const { data } = useQuery(installationQueries.get());
  const provider = data?.speechProvider ?? "browser";
  if (!data) return null;
  if (provider === "off")
    return (
      <p className="text-sm text-muted-foreground">
        Text to speech is off. An administrator turns it on in Studio, and then each bot can have a
        voice here.
      </p>
    );
  return provider === "browser" ? (
    <DeviceVoice bot={bot} />
  ) : (
    <ServerVoice bot={bot} installationVoice={data.speechVoice} onBotChange={onBotChange} />
  );
}
