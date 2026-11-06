import type { HomeCatalog, HomeEntity } from "./homeassistant-catalog";

/** Pure rules of the fast path: which actions an entity offers, the service data of an action, and how a reply reads. */

export type HomeAction = {
  key: string;
  service: string;
  /** The reply phrase (see PHRASES). Value actions use "set_to". */
  phrase: string;
  data?: Record<string, unknown>;
  /** A value the sentence must carry. */
  value?: {
    field: string;
    kind: "percent" | "temperature" | "option";
    options?: string[];
    min?: number;
    max?: number;
  };
};
export const QUERY: HomeAction = {
  key: "state",
  service: "",
  phrase: "state",
};

const has = (e: HomeEntity, bit: number) => (e.features & bit) !== 0;
const list = (v: unknown) => (Array.isArray(v) ? (v as string[]) : []);
const num = (v: unknown, fallback: number) => (typeof v === "number" ? v : fallback);

const onOff = (): HomeAction[] => [
  { key: "turn_on", service: "turn_on", phrase: "turn_on" },
  { key: "turn_off", service: "turn_off", phrase: "turn_off" },
];
const toggle = (): HomeAction => ({
  key: "toggle",
  service: "toggle",
  phrase: "toggle",
});

/** The actions an entity offers, from its domain, its feature bits and the services Home Assistant lists. Always ends with the state query. */
export function actionsFor(e: HomeEntity, services: HomeCatalog["services"]): HomeAction[] {
  const out: HomeAction[] = [];
  const a = e.attrs;
  switch (e.domain) {
    case "light": {
      out.push(...onOff(), toggle());
      if (list(a.supported_color_modes).some((m) => m !== "onoff"))
        out.push({
          key: "set_brightness",
          service: "turn_on",
          phrase: "set_to",
          value: { field: "brightness_pct", kind: "percent" },
        });
      break;
    }
    case "switch":
    case "input_boolean":
      out.push(...onOff(), toggle());
      break;
    case "fan":
      out.push(...onOff(), toggle());
      if (has(e, 1))
        out.push({
          key: "set_speed",
          service: "set_percentage",
          phrase: "set_to",
          value: { field: "percentage", kind: "percent" },
        });
      break;
    case "media_player": {
      if (has(e, 128)) out.push({ key: "turn_on", service: "turn_on", phrase: "turn_on" });
      if (has(e, 256)) out.push({ key: "turn_off", service: "turn_off", phrase: "turn_off" });
      if (has(e, 4))
        out.push({
          key: "set_volume",
          service: "volume_set",
          phrase: "set_to",
          value: { field: "volume_level", kind: "percent" },
        });
      if (has(e, 4) || has(e, 1024))
        out.push(
          {
            key: "volume_up",
            service: "volume_up",
            phrase: "volume_up",
          },
          {
            key: "volume_down",
            service: "volume_down",
            phrase: "volume_down",
          },
        );
      if (has(e, 8))
        out.push(
          {
            key: "mute",
            service: "volume_mute",
            phrase: "mute",
            data: { is_volume_muted: true },
          },
          {
            key: "unmute",
            service: "volume_mute",
            phrase: "unmute",
            data: { is_volume_muted: false },
          },
        );
      if (has(e, 16384)) out.push({ key: "play", service: "media_play", phrase: "play" });
      if (has(e, 1)) out.push({ key: "pause", service: "media_pause", phrase: "pause" });
      if (has(e, 2048) && list(a.source_list).length)
        out.push({
          key: "select_source",
          service: "select_source",
          phrase: "set_to",
          value: { field: "source", kind: "option", options: list(a.source_list) },
        });
      break;
    }
    case "scene":
    case "script":
      out.push({ key: "activate", service: "turn_on", phrase: "activate" });
      break;
    case "climate": {
      if (has(e, 256)) out.push({ key: "turn_on", service: "turn_on", phrase: "turn_on" });
      if (has(e, 128)) out.push({ key: "turn_off", service: "turn_off", phrase: "turn_off" });
      if (has(e, 1))
        out.push({
          key: "set_temperature",
          service: "set_temperature",
          phrase: "set_to",
          value: {
            field: "temperature",
            kind: "temperature",
            min: num(a.min_temp, 7),
            max: num(a.max_temp, 35),
          },
        });
      if (list(a.hvac_modes).length)
        out.push({
          key: "set_mode",
          service: "set_hvac_mode",
          phrase: "set_to",
          value: { field: "hvac_mode", kind: "option", options: list(a.hvac_modes) },
        });
      break;
    }
    case "cover": {
      if (has(e, 1)) out.push({ key: "open", service: "open_cover", phrase: "open" });
      if (has(e, 2)) out.push({ key: "close", service: "close_cover", phrase: "close" });
      if (has(e, 8)) out.push({ key: "stop", service: "stop_cover", phrase: "stop" });
      if (has(e, 4))
        out.push({
          key: "set_position",
          service: "set_cover_position",
          phrase: "set_to",
          value: { field: "position", kind: "percent" },
        });
      break;
    }
    case "lock":
      out.push(
        { key: "lock", service: "lock", phrase: "lock" },
        { key: "unlock", service: "unlock", phrase: "unlock" },
      );
      break;
  }
  const offered = services[e.domain];
  return [...out.filter((x) => !offered || offered.includes(x.service)), QUERY];
}

/** Service data for an action, or undefined when the needed value is missing, of the wrong kind, or out of range. */
export function dataFor(action: HomeAction, value?: number | string) {
  const v = action.value;
  if (!v) return { data: action.data ?? {}, shown: "" };
  if (v.kind === "option")
    return typeof value === "string" && v.options?.includes(value)
      ? { data: { [v.field]: value }, shown: value }
      : undefined;
  if (typeof value !== "number") return undefined;
  if (v.kind === "temperature")
    return value >= v.min! && value <= v.max!
      ? { data: { [v.field]: value }, shown: String(value) }
      : undefined;
  if (value < 0 || value > 100) return undefined;
  // Home Assistant takes the volume as 0..1, and the rest as 0..100.
  return {
    data: { [v.field]: action.service === "volume_set" ? value / 100 : value },
    shown: `${value}%`,
  };
}

export const REPLY_LANGUAGES = ["en", "pt", "es"] as const;
type Lang = (typeof REPLY_LANGUAGES)[number];
const PHRASES: Record<Lang, Record<string, string>> = {
  en: {
    turn_on: "turned on",
    turn_off: "turned off",
    toggle: "switched",
    activate: "done",
    open: "opening",
    close: "closing",
    stop: "stopped",
    lock: "locked",
    unlock: "unlocked",
    play: "playing",
    pause: "paused",
    mute: "muted",
    unmute: "sound on",
    volume_up: "volume up",
    volume_down: "volume down",
    set_to: "set to",
    failed: "Home Assistant could not do that",
    on: "on",
    off: "off",
    open_state: "open",
    closed: "closed",
    locked: "locked",
    unlocked: "unlocked",
  },
  pt: {
    turn_on: "ligado",
    turn_off: "desligado",
    toggle: "alternado",
    activate: "feito",
    open: "abrindo",
    close: "fechando",
    stop: "parado",
    lock: "trancado",
    unlock: "destrancado",
    play: "tocando",
    pause: "pausado",
    mute: "sem som",
    unmute: "com som",
    volume_up: "volume mais alto",
    volume_down: "volume mais baixo",
    set_to: "ajustado para",
    failed: "O Home Assistant não conseguiu fazer isso",
    on: "ligado",
    off: "desligado",
    open_state: "aberto",
    closed: "fechado",
    locked: "trancado",
    unlocked: "destrancado",
  },
  es: {
    turn_on: "encendido",
    turn_off: "apagado",
    toggle: "cambiado",
    activate: "hecho",
    open: "abriendo",
    close: "cerrando",
    stop: "detenido",
    lock: "bloqueado",
    unlock: "desbloqueado",
    play: "reproduciendo",
    pause: "en pausa",
    mute: "sin sonido",
    unmute: "con sonido",
    volume_up: "volumen más alto",
    volume_down: "volumen más bajo",
    set_to: "ajustado a",
    failed: "Home Assistant no pudo hacerlo",
    on: "encendido",
    off: "apagado",
    open_state: "abierto",
    closed: "cerrado",
    locked: "bloqueado",
    unlocked: "desbloqueado",
  },
};
const STATE_KEY: Record<string, string> = {
  on: "on",
  off: "off",
  open: "open_state",
  closed: "closed",
  locked: "locked",
  unlocked: "unlocked",
};

/** The reply language for a BCP-47 tag: en, pt or es. Any other language reads English. */
export const replyLang = (tag: string | undefined): Lang => {
  const p = (tag ?? "en").split("-")[0] as Lang;
  return REPLY_LANGUAGES.includes(p) ? p : "en";
};

/** The words of a reply, short on purpose: "Kitchen light: turned off." */
export function say(lang: Lang, key: string) {
  return PHRASES[lang][key] ?? PHRASES.en[key] ?? key;
}
export function reply(lang: Lang, name: string, action: HomeAction, shown: string) {
  const phrase = say(lang, action.phrase);
  return `${name}: ${shown ? `${phrase} ${shown}` : phrase}.`;
}
export function stateReply(lang: Lang, name: string, state: string, unit?: string) {
  const key = STATE_KEY[state];
  return `${name}: ${key ? say(lang, key) : state}${unit ? ` ${unit}` : ""}.`;
}
