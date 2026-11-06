import { actionsFor, dataFor, type HomeAction } from "./homeassistant-actions";
import type { HomeCatalog, HomeEntity } from "./homeassistant-catalog";
import { fuzzy, target, type Target } from "./homeassistant-fuzzy";

/**
 * A rule-based parser for short smart-home commands in English and Brazilian Portuguese: "Acenda a luz Neo40W", "set the TV volume to 30",
 * "is the office light on?". No model, no network: it runs in microseconds on the cached catalog. It finds the intent, the value and the
 * device (fzf-style, see homeassistant-fuzzy.ts), and it ABSTAINS (returns undefined) whenever it is not sure: negation, two commands,
 * words it cannot explain, an unknown or ambiguous device, an action the device does not have. A miss is slow, never wrong.
 */
type Lang = "en" | "pt";
type Intent =
  | "on"
  | "off"
  | "toggle"
  | "set"
  | "up"
  | "down"
  | "open"
  | "close"
  | "stop"
  | "lock"
  | "unlock"
  | "mute"
  | "unmute"
  | "play"
  | "pause";
export type HomeCommand = {
  entity: HomeEntity;
  action: HomeAction;
  data: Record<string, unknown>;
  shown: string;
  lang: Lang;
};

/** "..." lets up to four other words stand between two words of a pattern ("turn the light on"); those words are kept. */
const INTENTS: [Lang, Intent, string[]][] = [
  [
    "en",
    "on",
    [
      "turn ... on",
      "switch ... on",
      "power ... on",
      "light up",
      "enable",
      "activate",
      "run",
      "start",
    ],
  ],
  [
    "en",
    "off",
    ["turn ... off", "switch ... off", "power ... off", "shut ... off", "shut down", "disable"],
  ],
  ["en", "toggle", ["toggle", "flip"]],
  [
    "en",
    "set",
    [
      "set",
      "change",
      "dim",
      "brighten",
      "adjust",
      "increase ... brightness",
      "decrease ... brightness",
    ],
  ],
  ["en", "up", ["volume up", "turn ... up", "louder", "raise ... volume", "increase ... volume"]],
  [
    "en",
    "down",
    ["volume down", "turn ... down", "quieter", "lower ... volume", "decrease ... volume"],
  ],
  ["en", "open", ["open"]],
  ["en", "close", ["close"]],
  ["en", "stop", ["stop"]],
  ["en", "lock", ["lock"]],
  ["en", "unlock", ["unlock"]],
  ["en", "mute", ["mute"]],
  ["en", "unmute", ["unmute"]],
  ["en", "play", ["play", "resume"]],
  ["en", "pause", ["pause"]],
  [
    "pt",
    "on",
    [
      "ligue",
      "ligar",
      "liga",
      "acenda",
      "acender",
      "acende",
      "ative",
      "ativar",
      "ativa",
      "habilite",
    ],
  ],
  [
    "pt",
    "off",
    [
      "desligue",
      "desligar",
      "desliga",
      "apague",
      "apagar",
      "apaga",
      "desative",
      "desativar",
      "desativa",
    ],
  ],
  ["pt", "toggle", ["alterne", "alternar", "inverta"]],
  [
    "pt",
    "set",
    [
      "ajuste",
      "ajustar",
      "deixe",
      "deixar",
      "coloque",
      "colocar",
      "ponha",
      "defina",
      "definir",
      "mude",
      "mudar",
      "regule",
      "aumente ... brilho",
      "diminua ... brilho",
      "aumentar ... brilho",
      "diminuir ... brilho",
    ],
  ],
  [
    "pt",
    "up",
    ["aumente ... volume", "aumentar ... volume", "suba ... volume", "volume mais alto"],
  ],
  [
    "pt",
    "down",
    [
      "diminua ... volume",
      "diminuir ... volume",
      "abaixe ... volume",
      "baixe ... volume",
      "volume mais baixo",
    ],
  ],
  ["pt", "open", ["abra", "abrir", "abre"]],
  ["pt", "close", ["feche", "fechar", "fecha"]],
  ["pt", "stop", ["pare", "parar"]],
  ["pt", "lock", ["tranque", "trancar", "tranca"]],
  ["pt", "unlock", ["destranque", "destrancar"]],
  ["pt", "mute", ["silencie", "silenciar"]],
  ["pt", "unmute", ["desmute", "desmutar"]],
  ["pt", "play", ["toque", "tocar", "reproduza", "reproduzir"]],
  ["pt", "pause", ["pausar"]],
];

/** Words that carry nothing for the device: dropped. */
const FILLERS: Record<Lang, string[]> = {
  en: [
    "the",
    "a",
    "an",
    "my",
    "our",
    "please",
    "hey",
    "hi",
    "can",
    "could",
    "would",
    "will",
    "you",
    "to",
    "in",
    "at",
    "of",
    "for",
  ],
  pt: [
    "o",
    "a",
    "os",
    "as",
    "um",
    "uma",
    "do",
    "da",
    "dos",
    "das",
    "de",
    "no",
    "na",
    "nos",
    "nas",
    "em",
    "ao",
    "para",
    "pra",
    "por",
    "favor",
    "pode",
    "poderia",
    "voce",
    "vc",
    "meu",
    "minha",
  ],
};
/** What the person asks about: dropped, and "volume 30" must not read the property as a device. */
const PROPERTIES: Record<Lang, string[]> = {
  en: [
    "volume",
    "brightness",
    "level",
    "speed",
    "temperature",
    "position",
    "source",
    "input",
    "mode",
    "channel",
    "state",
    "status",
  ],
  pt: [
    "volume",
    "brilho",
    "intensidade",
    "nivel",
    "velocidade",
    "temperatura",
    "posicao",
    "fonte",
    "entrada",
    "modo",
    "canal",
    "estado",
  ],
};
/** A question has one of these. Dropped. */
const INTERROGATIVES: Record<Lang, string[]> = {
  en: ["is", "are", "what", "whats", "how", "which", "tell", "me"],
  pt: [
    "esta",
    "estao",
    "qual",
    "quais",
    "quanto",
    "quantos",
    "quantas",
    "como",
    "ta",
    "diga",
    "me",
  ],
};
/** How a device answers a question ("is the light on?"): dropped in questions only. */
const STATES: Record<Lang, string[]> = {
  en: [
    "on",
    "off",
    "open",
    "closed",
    "locked",
    "unlocked",
    "playing",
    "paused",
    "muted",
    "running",
  ],
  pt: [
    "ligado",
    "ligada",
    "ligados",
    "ligadas",
    "desligado",
    "desligada",
    "acesa",
    "aceso",
    "apagada",
    "apagado",
    "aberta",
    "aberto",
    "fechada",
    "fechado",
    "trancada",
    "trancado",
    "destrancada",
    "destrancado",
    "tocando",
    "pausada",
    "pausado",
  ],
};
const UNITS = new Set([
  "por",
  "%",
  "percent",
  "percentage",
  "cento",
  "porcento",
  "graus",
  "grau",
  "degrees",
  "degree",
  "°",
  "celsius",
]);
const TEMPERATURE_UNITS = new Set(["graus", "grau", "degrees", "degree", "°", "celsius"]);
const NEGATIONS = new Set([
  "nao",
  "nunca",
  "sem",
  "nem",
  "dont",
  "don't",
  "never",
  "without",
  "not",
  "cant",
  "cannot",
]);

/** A noun for a kind of device narrows the search to its domains. */
const NOUNS: [Lang, string[], string[]][] = [
  ["en", ["light", "lights", "lamp", "lamps", "bulb", "bulbs"], ["light", "switch"]],
  ["en", ["fan", "fans"], ["fan"]],
  ["en", ["tv", "television", "speaker"], ["media_player"]],
  [
    "en",
    ["blind", "blinds", "shade", "shades", "curtain", "curtains", "shutter", "shutters", "garage"],
    ["cover"],
  ],
  ["en", ["scene"], ["scene"]],
  ["en", ["plug", "outlet"], ["switch"]],
  ["en", ["thermostat"], ["climate"]],
  ["pt", ["luz", "luzes", "lampada", "lampadas", "abajur", "lustre"], ["light", "switch"]],
  ["pt", ["ventilador", "ventiladores"], ["fan"]],
  ["pt", ["televisao", "televisor", "caixa de som"], ["media_player"]],
  ["pt", ["persiana", "persianas", "cortina", "cortinas", "portao", "garagem"], ["cover"]],
  ["pt", ["fechadura"], ["lock"]],
  ["pt", ["cena"], ["scene"]],
  ["pt", ["tomada"], ["switch"]],
  ["pt", ["termostato", "ar condicionado"], ["climate"]],
  ["pt", ["tv"], ["media_player"]],
];

/** Which language(s) own a word, to read the language of the sentence (and reply in it). Words in both count for neither. */
const VOCABULARY = new Map<string, Set<Lang>>();
const learn = (lang: Lang, phrase: string) => {
  for (const w of phrase.split(" "))
    if (w !== "...") VOCABULARY.set(w, (VOCABULARY.get(w) ?? new Set()).add(lang));
};
for (const [lang, , list] of INTENTS) for (const p of list) learn(lang, p);
for (const group of [FILLERS, PROPERTIES, INTERROGATIVES, STATES])
  for (const lang of ["en", "pt"] as const) for (const w of group[lang]) learn(lang, w);
for (const [lang, list] of NOUNS) for (const p of list) learn(lang, p);

const PATTERNS = INTENTS.flatMap(([, intent, list]) =>
  list.map((p) => ({ intent, words: p.split(" ") })),
).sort(
  (a, b) => b.words.filter((w) => w !== "...").length - a.words.filter((w) => w !== "...").length,
);
const NOUN_PATTERNS = NOUNS.flatMap(([, list, domains]) =>
  list.map((p) => ({ words: p.split(" "), domains })),
).sort((a, b) => b.words.length - a.words.length);
const FILLER_SET = new Set([...FILLERS.en, ...FILLERS.pt, ...PROPERTIES.en, ...PROPERTIES.pt]);
const INTERROGATIVE_SET = new Set([...INTERROGATIVES.en, ...INTERROGATIVES.pt]);
const STATE_SET = new Set([...STATES.en, ...STATES.pt]);
/** "me" and "tell" are polite, not a question on their own. */
const QUESTION_WORDS = [...INTERROGATIVE_SET].filter(
  (w) => w !== "me" && w !== "tell" && w !== "diga",
);

const SEGMENTER = new Intl.Segmenter("en", { granularity: "word" });
const tokenize = (text: string) =>
  [
    ...SEGMENTER.segment(
      text
        .normalize("NFD")
        .replace(/\p{M}/gu, "")
        .replace(/[’‘]/g, "'")
        .toLowerCase(),
    ),
  ]
    .filter((s) => s.isWordLike || s.segment === "%" || s.segment === "°")
    .map((s) => s.segment);
const NUMBER = /^\d+(?:[.,]\d+)?$/;

/** Where `pattern` matches from `start`, as token indexes, or undefined. Used words are skipped over, never matched. */
function matchAt(pattern: string[], tokens: string[], used: boolean[], start: number) {
  const hit: number[] = [];
  let at = start;
  for (let k = 0; k < pattern.length; k++) {
    if (pattern[k] === "...") {
      let found = -1;
      for (let d = 0; d <= 4 && at + d < tokens.length; d++)
        if (tokens[at + d] === pattern[k + 1] && !used[at + d]) {
          found = at + d;
          break;
        }
      if (found < 0) return undefined;
      at = found;
      continue;
    }
    if (tokens[at] !== pattern[k] || used[at]) return undefined;
    hit.push(at++);
  }
  return hit;
}

/** The actions an intent may mean on an entity. */
const WANTED: Record<Exclude<Intent, "set">, string[]> = {
  on: ["turn_on", "activate"],
  off: ["turn_off"],
  toggle: ["toggle"],
  up: ["volume_up"],
  down: ["volume_down"],
  open: ["open"],
  close: ["close"],
  stop: ["stop"],
  lock: ["lock"],
  unlock: ["unlock"],
  mute: ["mute"],
  unmute: ["unmute"],
  play: ["play"],
  pause: ["pause"],
};

const MIN_SCORE = 0.6;
/** The runner-up must score clearly lower, else the device is ambiguous. */
const MARGIN = 0.85;
const MAX_RUNS = 2;

type Prepared = { name: Target; words: string[]; area?: Target; areaWords: string[] };
const prepared = new WeakMap<HomeEntity, Prepared>();
const wordsOf = (s: string) =>
  s
    .normalize("NFD")
    .replace(/\p{M}/gu, "")
    .toLowerCase()
    .split(/[^\p{L}\p{N}]+/u)
    .filter(Boolean);
function prepare(e: HomeEntity): Prepared {
  let p = prepared.get(e);
  if (!p) {
    p = {
      name: target(e.name),
      words: wordsOf(e.name),
      area: e.area ? target(e.area) : undefined,
      areaWords: e.area ? wordsOf(e.area) : [],
    };
    prepared.set(e, p);
  }
  return p;
}
const good = (r: ReturnType<typeof fuzzy>) => (r && r.runs <= MAX_RUNS ? r.score : 0);
/** A short word must be a whole word of the name; a longer one may be an fzf-style part of it. */
const tokenScore = (token: string, t: Target, words: string[]) =>
  token.length < 3 ? (words.includes(token) ? 1 : 0) : good(fuzzy(token, t));

/** How well the device phrase names an entity (0..1): as one piece of its name, or word by word across its name and its area. */
function scoreEntity(e: HomeEntity, phrase: string[]) {
  const p = prepare(e);
  const whole = good(fuzzy(phrase.join(""), p.name));
  let total = 0;
  for (const token of phrase) {
    const n = tokenScore(token, p.name, p.words);
    const a = p.area ? tokenScore(token, p.area, p.areaWords) : 0;
    if (n === 0 && a === 0) return whole;
    total += Math.max(n, a);
  }
  return Math.max(whole, total / phrase.length);
}

/** The one entity the phrase names and `accept` can act on, or undefined (none, or two that are close). */
function resolve(
  pool: HomeEntity[],
  phrase: string[],
  narrowed: boolean,
  accept: (e: HomeEntity) => HomeAction | undefined,
) {
  if (phrase.length === 0) {
    // "turn on the TV": no name, but a kind of device, and only one of them.
    const only = narrowed
      ? pool.flatMap((e) => {
          const a = accept(e);
          return a ? [{ e, a }] : [];
        })
      : [];
    return only.length === 1 ? only[0] : undefined;
  }
  const ranked: { e: HomeEntity; a: HomeAction; score: number }[] = [];
  for (const e of pool) {
    const score = scoreEntity(e, phrase);
    if (score < MIN_SCORE) continue;
    const a = accept(e);
    if (a) ranked.push({ e, a, score });
  }
  ranked.sort((x, y) => y.score - x.score);
  const best = ranked[0];
  return best && !(ranked[1] && ranked[1].score > best.score * MARGIN) ? best : undefined;
}

export function parseHomeCommand(
  text: string,
  catalog: HomeCatalog,
  languages: readonly string[] = [],
): HomeCommand | undefined {
  if (text.length > 200 || /[\n`{}]|https?:/i.test(text)) return undefined;
  const tokens = tokenize(text);
  if (tokens.length < 2 || tokens.length > 12 || tokens.some((t) => NEGATIONS.has(t)))
    return undefined;
  const used = tokens.map(() => false);

  // 1. The intent: exactly one command, or a question.
  const commands: Intent[] = [];
  for (const { intent, words } of PATTERNS)
    for (let i = 0; i < tokens.length; i++) {
      const hit = matchAt(words, tokens, used, i);
      if (!hit) continue;
      for (const k of hit) used[k] = true;
      commands.push(intent);
    }
  const asking = tokens.some((t) => QUESTION_WORDS.includes(t));
  if (commands.length > 1 || (commands.length === 1 && asking)) return undefined;
  const intent: Intent | "query" | undefined =
    commands[0] ?? (asking || text.includes("?") ? "query" : undefined);
  if (!intent) return undefined;

  // 2. Words that carry nothing, then the kind of device.
  tokens.forEach((t, i) => {
    if (
      !used[i] &&
      (FILLER_SET.has(t) || (intent === "query" && (INTERROGATIVE_SET.has(t) || STATE_SET.has(t))))
    )
      used[i] = true;
  });
  const domains = new Set<string>();
  for (const { words, domains: d } of NOUN_PATTERNS)
    for (let i = 0; i < tokens.length; i++) {
      const hit = matchAt(words, tokens, used, i);
      if (!hit) continue;
      for (const k of hit) used[k] = true;
      for (const x of d) domains.add(x);
    }
  const narrowed = domains.size > 0;
  const pool = narrowed ? catalog.entities.filter((e) => domains.has(e.domain)) : catalog.entities;

  const left = () => tokens.filter((_, i) => !used[i]);
  const lang = readLanguage(text, tokens, languages);

  // 3. What an entity may do, and (for a "set") the option of a device written in the sentence.
  const actionsOf = (e: HomeEntity) => actionsFor(e, catalog.services);
  const finish = (
    e: HomeEntity,
    action: HomeAction,
    v?: number | string,
  ): HomeCommand | undefined => {
    const out = dataFor(action, v);
    return out && { entity: e, action, ...out, lang };
  };
  if (intent === "set") {
    // "mude a TV para Netflix": an option of a device (source, mode) written in the sentence. Tried before the number, so the 1 of "HDMI 1" is no volume.
    const found: { e: HomeEntity; action: HomeAction; option: string; used: number[] }[] = [];
    for (const e of pool)
      for (const action of actionsOf(e))
        for (const option of action.value?.kind === "option" ? (action.value.options ?? []) : []) {
          const ow = tokenize(option);
          for (let i = 0; ow.length && i < tokens.length; i++) {
            const hit = matchAt(ow, tokens, used, i);
            if (hit) found.push({ e, action, option, used: hit });
          }
        }
    if (found.length) {
      const winners = new Map<HomeEntity, { action: HomeAction; option: string }>();
      for (const f of found.sort((x, y) => y.used.length - x.used.length)) {
        const phrase = tokens.filter((_, i) => !used[i] && !f.used.includes(i));
        if (resolve([f.e], phrase, narrowed, () => f.action) && !winners.has(f.e))
          winners.set(f.e, f);
      }
      const only = winners.size === 1 ? [...winners][0] : undefined;
      return only && finish(only[0], only[1].action, only[1].option);
    }
  }
  // 4. The value of a "set": the last number, with its unit. Digits of a device name ("Neo 40 W") stay in the phrase for every other intent.
  let value: number | undefined;
  let degrees = false;
  if (intent === "set") {
    for (let i = tokens.length - 1; i >= 0; i--)
      if (!used[i] && NUMBER.test(tokens[i]!)) {
        value = Number(tokens[i]!.replace(",", "."));
        used[i] = true;
        for (let k = i + 1; k < tokens.length && UNITS.has(tokens[k]!); k++) {
          used[k] = true;
          degrees ||= TEMPERATURE_UNITS.has(tokens[k]!);
        }
        break;
      }
  }
  // 5. The device, and the action it has.
  const accept = (e: HomeEntity) => {
    const actions = actionsOf(e);
    if (intent === "query") return actions.find((a) => a.key === "state");
    if (intent === "set") {
      const numeric = actions.filter((a) => a.value && a.value.kind !== "option");
      return (
        numeric.find((a) => (a.value!.kind === "temperature") === degrees) ??
        (degrees ? undefined : numeric[0])
      );
    }
    return actions.find((a) => WANTED[intent].includes(a.key));
  };
  const hit = resolve(pool, left(), narrowed, accept);
  return hit && finish(hit.e, hit.a, value);
}

/** English or Portuguese: the words only one of them owns decide; accents are Portuguese; a tie takes the installation's first language. */
function readLanguage(text: string, tokens: string[], languages: readonly string[]): Lang {
  const hits = { en: 0, pt: /[áàâãéêíóôõúç]/i.test(text) ? 1 : 0 };
  for (const t of tokens) {
    const owners = VOCABULARY.get(t);
    if (owners?.size === 1) hits[[...owners][0]!]++;
  }
  if (hits.en !== hits.pt) return hits.pt > hits.en ? "pt" : "en";
  const first = languages.map((l) => l.split("-")[0]).find((l) => l === "en" || l === "pt");
  return first === "pt" ? "pt" : "en";
}
