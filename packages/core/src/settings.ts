// The registry of server settings: product behaviour, limits and security policy that used to live in environment variables and now live in
// the database (table `zetta.setting`), per installation with an optional override per organization (workspace). Only the host's own
// facts stay in the environment (see ./host-env.ts). This file is the one place that says which keys exist, what they mean in plain words
// (Studio is generated from it), what they default to, and how an organization value combines with the installation value.
//
// A default here is the value the code used when the environment variable was unset, so moving a reader to this registry changes nothing
// for an install that never set the variable. A switch is the string `on` or `off`, never a boolean.

export const SETTING_GROUPS = {
  chat: "Bot runs",
  learning: "Memory and learning",
  knowledge: "Company knowledge",
  integrations: "Integrations",
  limits: "Limits and quotas",
  computers: "Computers",
  security: "Security policy",
} as const;
export type SettingGroup = keyof typeof SETTING_GROUPS;

/** Where a value is stored: for the whole installation, or for one workspace (organization). */
export const SETTING_SCOPE_KINDS = ["installation", "workspace"] as const;
export type SettingScopeKind = (typeof SETTING_SCOPE_KINDS)[number];

export const SWITCH_VALUES = ["on", "off"] as const;
export type SwitchValue = (typeof SWITCH_VALUES)[number];

/** The longest key the table accepts (the column has the same check). */
export const SETTING_KEY_MAX = 64;
/** The largest value the table stores, as text of its JSON. A list of 64 long entries is the biggest thing a setting holds. */
export const SETTING_VALUE_MAX_BYTES = 16_384;

type Common = {
  group: SettingGroup;
  label: string;
  /** Plain words for the person who reads the Studio page: what it does and what happens when it changes. */
  help: string;
  /** `installation`: one value for the server. `organization`: an installation value that an organization may also have its own value for. */
  scope: "installation" | "organization";
  /**
   * For an organization-scoped key. `override`: the organization's value wins. `narrow`: the organization may only be stricter than the
   * installation (a lower number, a capability turned off, fewer entries); a looser value is ignored.
   */
  combine?: "override" | "narrow";
  /** Security policy: only a person changes it, never a bot or an MCP client. */
  sensitive: boolean;
  /** Every migrated reader reads the value on each use, so a change needs no restart. */
  applies: "now";
  /** The environment variable this setting replaces. The first start after an upgrade imports it once (modules/settings/import-env.ts). */
  env: string;
  /** Older names of the same variable, read after `env`. */
  envAlso?: readonly string[];
  /**
   * Turns the text of the variable into a candidate value, the way the old reader understood it (`=== "1"`, `!== "off"`). Undefined: the
   * text is used as it is (a number for an integer). Returning undefined skips the import for that variable.
   */
  fromEnv?: (raw: string) => unknown;
};
export type SwitchDef = Common & { type: "switch"; default: SwitchValue };
export type IntegerDef = Common & {
  type: "integer";
  default: number;
  min: number;
  max: number;
  /** Shown beside the number: `ms`, `bytes`, `runs`. */
  unit?: string;
};
export type TextDef = Common & {
  type: "text";
  default: string;
  maxLength: number;
  /** For a text that is not free: the plain-words reason a non-empty value is refused, or null when it is fine. Empty always means "the default". */
  validate?: (text: string) => string | null;
};
export type ListDef = Common & {
  type: "list";
  default: readonly string[];
  maxItems: number;
  itemMaxLength: number;
  /** When set, only these entries are accepted. */
  options?: readonly string[];
  /** The list may not be empty (the old reader fell back to its default on an empty list). */
  nonEmpty?: boolean;
};
export type ChoiceDef = Common & { type: "choice"; default: string; options: readonly string[] };
export type SettingDef = SwitchDef | IntegerDef | TextDef | ListDef | ChoiceDef;

const switchFromEnv = {
  /** Old reader: on unless the variable is `off`. */
  unlessOff: (raw: string): SwitchValue => (raw.trim().toLowerCase() === "off" ? "off" : "on"),
  /** Old reader: off unless the variable is `on`. */
  onlyOn: (raw: string): SwitchValue => (raw.trim().toLowerCase() === "on" ? "on" : "off"),
  /** Old reader: off unless the variable is `1`. */
  onlyOne: (raw: string): SwitchValue => (raw.trim() === "1" ? "on" : "off"),
};
/** The old readers read a number from digits only, ignoring blank and nonsense (the default stayed). */
const integerFromEnv = (raw: string): number | undefined => {
  const text = raw.trim();
  return /^\d+$/.test(text) ? Number(text) : undefined;
};
/** Splits the text; with `only`, names it does not know are dropped, as the old readers did (empty then means "the default", so it is skipped). */
const listFromEnv = (separator: string, only?: readonly string[]) => (raw: string) => {
  const items = raw
    .split(separator)
    .map((x) => x.trim())
    .filter((x) => x && (!only || only.includes(x)));
  return only && items.length === 0 ? undefined : items;
};

/** Computers a person may pick. Mirrors `computerDrivers` and `computerOsList` in @zetta/db (a server test keeps them equal). */
export const VM_DRIVER_NAMES = ["cua", "agent-desktop"] as const;
export const VM_OS_NAMES = ["debian", "ubuntu"] as const;

const GIB = 1024 ** 3;

/** An address with an http or https scheme and a host, no user name or password in it. */
const httpUrl = (label: string) => (text: string) => {
  try {
    const u = new URL(text);
    if (!/^https?:$/.test(u.protocol) || !u.hostname || u.username || u.password)
      return `"${label}" must be an http or https address without a user name or password.`;
    return null;
  } catch {
    return `"${label}" must be an address such as http://127.0.0.1:3010.`;
  }
};

export const SETTINGS = {
  // Bot runs
  claudeLiveInput: {
    group: "chat",
    label: "Messages reach Claude Code while it works",
    help: "On: a message you send while Claude Code is working is read by it right away. Off: the message waits until the run ends, as with the other engines.",
    type: "switch",
    default: "on",
    scope: "organization",
    combine: "override",
    sensitive: false,
    applies: "now",
    env: "ZETTA_CLAUDE_LIVE_INPUT",
    fromEnv: switchFromEnv.unlessOff,
  },
  lightRuns: {
    group: "chat",
    label: "Light background runs",
    help: "On: background work that only reads text, such as the daily reading of chats for lessons, runs Claude Code without the person's own settings, tools and MCP servers. It costs far fewer tokens. Off: the full run.",
    type: "switch",
    default: "off",
    scope: "organization",
    combine: "override",
    sensitive: false,
    applies: "now",
    env: "ZETTA_LIGHT_RUNS",
    fromEnv: switchFromEnv.onlyOn,
  },
  hostSkills: {
    group: "chat",
    label: "Skills from the server's home folder",
    help: "On: every bot can use the skills found in the server user's home folders (~/.claude/skills and ~/.agents/skills), picked with / in the chat. Off: only skills saved in Zetta. The folders belong to one person on the server, so everyone who can chat with a bot would see them.",
    type: "switch",
    default: "off",
    scope: "installation",
    sensitive: true,
    applies: "now",
    env: "ZETTA_HOST_SKILLS",
    fromEnv: switchFromEnv.onlyOn,
  },
  // Memory and learning
  memoryLearn: {
    group: "learning",
    label: "Bots learn into memory on their own",
    help: "On: bots write what they learn from finished work into memory. Off: they only write when someone asks them to.",
    type: "switch",
    default: "on",
    scope: "organization",
    combine: "narrow",
    sensitive: false,
    applies: "now",
    env: "ZETTA_MEMORY_LEARN",
    envAlso: ["ZETTA_WIKI_LEARN"],
    fromEnv: switchFromEnv.unlessOff,
  },
  lessonBatch: {
    group: "learning",
    label: "Daily reading of chats for lessons",
    help: "On: once a day, bots read recent chats for lessons, for the people who have it on in Lessons. Off: the daily reading stops for everyone.",
    type: "switch",
    default: "on",
    scope: "organization",
    combine: "narrow",
    sensitive: false,
    applies: "now",
    env: "ZETTA_LESSON_BATCH",
    fromEnv: switchFromEnv.unlessOff,
  },
  // Company knowledge
  embedding: {
    group: "knowledge",
    label: "Meaning-based search in company knowledge",
    help: "On: the server computes embeddings with a local model (the first use downloads it) so searches find meaning, not only words. Off: keyword search only.",
    type: "switch",
    default: "on",
    scope: "organization",
    combine: "narrow",
    sensitive: false,
    applies: "now",
    env: "ZETTA_EMBEDDING",
    fromEnv: switchFromEnv.unlessOff,
  },
  // Integrations
  mcpMemberStdio: {
    group: "integrations",
    label: "Members may run local MCP commands",
    help: "On: members, not only the administrator, can add MCP servers that run as a command on this machine, from the allowed list. Off: only the administrator can. A local command runs as the server's own user, so keep it off unless everyone is trusted.",
    type: "switch",
    default: "off",
    scope: "installation",
    sensitive: true,
    applies: "now",
    env: "ZETTA_MCP_MEMBER_STDIO",
    fromEnv: switchFromEnv.onlyOne,
  },
  mcpAllowlist: {
    group: "integrations",
    label: "Allowed local MCP commands",
    help: "Commands an administrator allows as local MCP servers, one per line: the program and its arguments separated by spaces, without a shell. Anything not listed (and not built in) cannot run.",
    type: "list",
    default: [],
    maxItems: 64,
    itemMaxLength: 400,
    scope: "installation",
    sensitive: true,
    applies: "now",
    env: "ZETTA_MCP_ALLOWLIST",
    fromEnv: listFromEnv(";"),
  },
  // Limits and quotas
  harnessMax: {
    group: "limits",
    label: "Bot runs at once, in total",
    help: "How many bot runs may work at the same time on this server. More wait for a free place.",
    type: "integer",
    default: 8,
    min: 1,
    max: 1000,
    unit: "runs",
    scope: "installation",
    sensitive: false,
    applies: "now",
    env: "ZETTA_HARNESS_MAX",
    fromEnv: integerFromEnv,
  },
  harnessMaxPerUser: {
    group: "limits",
    label: "Bot runs at once, per person",
    help: "How many bot runs one person may have working at the same time. An organization can lower it.",
    type: "integer",
    default: 4,
    min: 1,
    max: 1000,
    unit: "runs",
    scope: "organization",
    combine: "narrow",
    sensitive: false,
    applies: "now",
    env: "ZETTA_HARNESS_MAX_PER_USER",
    fromEnv: integerFromEnv,
  },
  harnessWaitMs: {
    group: "limits",
    label: "How long a run waits for a place",
    help: "When all places are taken, a run waits this long (in milliseconds) before it gives up. 0 means it does not wait.",
    type: "integer",
    default: 300_000,
    min: 0,
    max: 3_600_000,
    unit: "ms",
    scope: "installation",
    sensitive: false,
    applies: "now",
    env: "ZETTA_HARNESS_WAIT_MS",
    fromEnv: integerFromEnv,
  },
  roomConcurrency: {
    group: "limits",
    label: "Room turns at once",
    help: "How many turns of bots talking in rooms may run at the same time. A turn started by a person's own message does not wait for this limit.",
    type: "integer",
    default: 4,
    min: 1,
    max: 1000,
    unit: "turns",
    scope: "installation",
    sensitive: false,
    applies: "now",
    env: "ZETTA_ROOM_CONCURRENCY",
    fromEnv: integerFromEnv,
  },
  artifactsQuota: {
    group: "limits",
    label: "Artifact storage per person",
    help: "The most one person may keep as artifacts, in bytes (the default is 5 GB). Nothing is deleted to make room: publishing over the limit is refused. An organization can lower it.",
    type: "integer",
    default: 5 * GIB,
    min: 1,
    max: 1024 * GIB * 1024,
    unit: "bytes",
    scope: "organization",
    combine: "narrow",
    sensitive: false,
    applies: "now",
    env: "ZETTA_ARTIFACTS_QUOTA",
    fromEnv: integerFromEnv,
  },
  // Computers
  vmMaxPerUser: {
    group: "computers",
    label: "Computers per person",
    help: "How many computers (desktops in a container) one person may have, running or stopped. 0 means none. An organization can lower it.",
    type: "integer",
    default: 4,
    min: 0,
    max: 1000,
    unit: "computers",
    scope: "organization",
    combine: "narrow",
    sensitive: false,
    applies: "now",
    env: "ZETTA_VM_MAX_PER_USER",
    fromEnv: integerFromEnv,
  },
  vmMaxRunningPerUser: {
    group: "computers",
    label: "Running computers per person",
    help: "How many of a person's computers may run at the same time. An organization can lower it.",
    type: "integer",
    default: 2,
    min: 0,
    max: 1000,
    unit: "computers",
    scope: "organization",
    combine: "narrow",
    sensitive: false,
    applies: "now",
    env: "ZETTA_VM_MAX_RUNNING_PER_USER",
    fromEnv: integerFromEnv,
  },
  vmMaxRunning: {
    group: "computers",
    label: "Running computers on the server",
    help: "How many computers may run at the same time on this server, for everyone together.",
    type: "integer",
    default: 6,
    min: 0,
    max: 10_000,
    unit: "computers",
    scope: "installation",
    sensitive: false,
    applies: "now",
    env: "ZETTA_VM_MAX_RUNNING",
    fromEnv: integerFromEnv,
  },
  vmDrivers: {
    group: "computers",
    label: "What can drive a computer",
    help: "The tools a person may pick to operate a computer: cua (the default) and agent-desktop. At least one. An organization can only remove some.",
    type: "list",
    default: ["cua"],
    maxItems: VM_DRIVER_NAMES.length,
    itemMaxLength: 40,
    options: VM_DRIVER_NAMES,
    nonEmpty: true,
    scope: "organization",
    combine: "narrow",
    sensitive: false,
    applies: "now",
    env: "ZETTA_VM_DRIVERS",
    fromEnv: listFromEnv(",", VM_DRIVER_NAMES),
  },
  vmOs: {
    group: "computers",
    label: "Systems a new computer can use",
    help: "The systems a person may pick for a new computer: debian (the default) and ubuntu. The image of each one must be built on the server. At least one. An organization can only remove some.",
    type: "list",
    default: ["debian"],
    maxItems: VM_OS_NAMES.length,
    itemMaxLength: 40,
    options: VM_OS_NAMES,
    nonEmpty: true,
    scope: "organization",
    combine: "narrow",
    sensitive: false,
    applies: "now",
    env: "ZETTA_VM_OS",
    fromEnv: listFromEnv(",", VM_OS_NAMES),
  },
  wahaUrl: {
    group: "integrations",
    label: "WhatsApp server address (WAHA)",
    help: "The WAHA server every person who uses WhatsApp without their own server shares. Empty: the built-in address, http://127.0.0.1:3010 (the WAHA container Zetta starts next to itself). The key of this server is saved apart, sealed, in Studio > Plugins > WhatsApp > Server for everyone. A person's own server, typed in their plugin settings, always wins.",
    type: "text",
    default: "",
    maxLength: 512,
    validate: httpUrl("WhatsApp server address"),
    scope: "installation",
    sensitive: false,
    applies: "now",
    env: "ZETTA_WAHA_URL",
  },
  // Security policy
  allowPrivateNetwork: {
    group: "security",
    label: "Let the server call private network addresses",
    help: "On: the server may call addresses on this computer or on your network, such as a speech server, a Home Assistant or a WhatsApp server on the LAN. Off: only public addresses. With it on, anyone who can type an address into a plugin can point the server at your network.",
    type: "switch",
    default: "off",
    scope: "installation",
    sensitive: true,
    applies: "now",
    env: "ZETTA_ALLOW_PRIVATE_NETWORK",
    fromEnv: switchFromEnv.onlyOne,
  },
  codeAccess: {
    group: "security",
    label: "Bots may run code",
    help: "On: a bot whose owner turned on code access may run commands. Off: no bot runs code, whatever its own setting says. An organization can turn it off for its own people, never on.",
    type: "switch",
    default: "on",
    scope: "organization",
    combine: "narrow",
    sensitive: true,
    applies: "now",
    env: "ZETTA_CODE_ACCESS",
    fromEnv: switchFromEnv.unlessOff,
  },
} as const satisfies Record<string, SettingDef>;

/**
 * Variables that held a secret and are **not** imported: a secret needs an owning administrator (a sealed connection), so it is never
 * copied from the environment. The server only warns when one is still set, and the variable has no effect. The value says where to save it.
 */
export const SECRETS_NOT_IMPORTED: Readonly<Record<string, string>> = {
  ZETTA_WAHA_API_KEY: "Studio > Plugins > WhatsApp > Server for everyone",
  ZETTA_TRANSCRIBE_API_KEY: "Studio > Voice > Speech to text",
  ZETTA_SPEECH_API_KEY: "Studio > Voice > Text to speech",
};

/**
 * Variables of the voice that were removed because the database already holds the value. The server imports each one once into the
 * installation settings row (`importLegacyVoiceSettings`), only while the column still holds what it held before anyone chose; after
 * that the variable has no effect. They are named here (and not in the importer) so the guard of `host-env.ts` sees one list.
 */
export const LEGACY_VOICE_ENV = {
  transcribe: "ZETTA_TRANSCRIBE",
  transcribeModel: "ZETTA_TRANSCRIBE_MODEL",
  transcribeLanguage: "ZETTA_TRANSCRIBE_LANGUAGE",
  speechLocal: "ZETTA_SPEECH_LOCAL",
  speechModel: "ZETTA_SPEECH_MODEL",
} as const;

export type SettingKey = keyof typeof SETTINGS;
export const SETTING_KEYS = Object.keys(SETTINGS) as SettingKey[];
export type SettingValue<K extends SettingKey = SettingKey> = (typeof SETTINGS)[K] extends {
  type: "switch";
}
  ? SwitchValue
  : (typeof SETTINGS)[K] extends { type: "integer" }
    ? number
    : (typeof SETTINGS)[K] extends { type: "list" }
      ? string[]
      : string;
/** What a value can be, before the key is known. */
export type AnySettingValue = SwitchValue | number | string | string[];

export const isSettingKey = (key: unknown): key is SettingKey =>
  typeof key === "string" && Object.hasOwn(SETTINGS, key);
export const settingDef = (key: SettingKey): SettingDef => SETTINGS[key];
export const isSensitiveSetting = (key: SettingKey): boolean => SETTINGS[key].sensitive;
/** A copy of the default, so nobody changes the registry through the array they were handed. */
export const settingDefault = <K extends SettingKey>(key: K): SettingValue<K> => {
  const value = SETTINGS[key].default as unknown;
  return (Array.isArray(value) ? [...value] : value) as SettingValue<K>;
};

export type ParsedSetting<T> = { ok: true; value: T } | { ok: false; error: string };
const hasControl = (text: string) =>
  [...text].some((c) => {
    const n = c.charCodeAt(0);
    return n < 32 || n === 127;
  });
const fail = (error: string): { ok: false; error: string } => ({ ok: false, error });

/** Validates and normalises a value against a definition. Exported for tests of definitions the registry does not use yet. */
export function parseWithDef(def: SettingDef, raw: unknown): ParsedSetting<AnySettingValue> {
  switch (def.type) {
    case "switch":
      return raw === "on" || raw === "off"
        ? { ok: true, value: raw }
        : fail(`Choose "on" or "off" for "${def.label}".`);
    case "integer": {
      if (typeof raw !== "number" || !Number.isInteger(raw))
        return fail(`"${def.label}" must be a whole number.`);
      if (raw < def.min || raw > def.max)
        return fail(`"${def.label}" must be between ${def.min} and ${def.max}.`);
      return { ok: true, value: raw };
    }
    case "text": {
      if (typeof raw !== "string") return fail(`"${def.label}" must be text.`);
      const text = raw.trim();
      if (hasControl(text)) return fail(`"${def.label}" cannot hold control characters.`);
      if (text.length > def.maxLength)
        return fail(`"${def.label}" can have at most ${def.maxLength} characters.`);
      const why = text && def.validate ? def.validate(text) : null;
      if (why) return fail(why);
      return { ok: true, value: text };
    }
    case "choice":
      return typeof raw === "string" && def.options.includes(raw)
        ? { ok: true, value: raw }
        : fail(`"${def.label}" must be one of: ${def.options.join(", ")}.`);
    case "list": {
      if (!Array.isArray(raw) || raw.some((item) => typeof item !== "string"))
        return fail(`"${def.label}" must be a list of text entries.`);
      const items: string[] = [];
      for (const item of raw as string[]) {
        const text = item.trim();
        if (!text) continue;
        if (hasControl(text))
          return fail(`An entry of "${def.label}" cannot hold control characters.`);
        if (text.length > def.itemMaxLength)
          return fail(
            `Each entry of "${def.label}" can have at most ${def.itemMaxLength} characters.`,
          );
        if (def.options && !def.options.includes(text))
          return fail(
            `"${text}" is not allowed in "${def.label}". Choose from: ${def.options.join(", ")}.`,
          );
        if (!items.includes(text)) items.push(text);
      }
      if (items.length > def.maxItems)
        return fail(`"${def.label}" can have at most ${def.maxItems} entries.`);
      if (def.nonEmpty && items.length === 0)
        return fail(`"${def.label}" needs at least one entry.`);
      return { ok: true, value: items };
    }
  }
}

/** Validates and normalises a value for a key (trims text, drops empty and repeated list entries). The error is written for the person who typed it. */
export function parseSettingValue<K extends SettingKey>(
  key: K,
  raw: unknown,
): ParsedSetting<SettingValue<K>> {
  const result = parseWithDef(SETTINGS[key], raw);
  if (!result.ok) return result;
  if (JSON.stringify(result.value).length > SETTING_VALUE_MAX_BYTES)
    return fail(`"${SETTINGS[key].label}" is too large.`);
  return result as ParsedSetting<SettingValue<K>>;
}

/** The candidate value of a legacy environment variable, or undefined when the text cannot be a value. Not validated: pass it to `parseSettingValue`. */
export function settingFromEnv(key: SettingKey, raw: string): unknown {
  const def: SettingDef = SETTINGS[key];
  if (!raw.trim()) return undefined;
  if (def.fromEnv) return def.fromEnv(raw);
  if (def.type === "integer") return integerFromEnv(raw);
  return raw;
}

export type SettingSource = "organization" | "installation" | "default";

/**
 * The value that counts, from the values stored for the organization and for the installation (each already parsed, or undefined when
 * nothing is stored) and the default. `override`: the organization's value wins. `narrow`: the organization may only be stricter, so a
 * looser value is ignored. An installation-scoped key never reads an organization value.
 */
export function effective<K extends SettingKey>(
  key: K,
  layers: {
    organization?: SettingValue<K> | undefined;
    installation?: SettingValue<K> | undefined;
  },
): { value: SettingValue<K>; source: SettingSource } {
  const def: SettingDef = SETTINGS[key];
  const base: { value: SettingValue<K>; source: SettingSource } =
    layers.installation !== undefined
      ? { value: layers.installation, source: "installation" }
      : { value: settingDefault(key), source: "default" };
  const org = layers.organization;
  if (def.scope !== "organization" || org === undefined) return base;
  if (def.combine !== "narrow") return { value: org, source: "organization" };
  switch (def.type) {
    case "switch":
      return org === "off" && base.value === "on" ? { value: org, source: "organization" } : base;
    case "integer":
      return (org as number) < (base.value as number)
        ? { value: org, source: "organization" }
        : base;
    case "list": {
      const allowed = new Set(base.value as string[]);
      const kept = (org as string[]).filter((item) => allowed.has(item));
      const narrowed = (base.value as string[]).filter((item) => kept.includes(item));
      return narrowed.length < (base.value as string[]).length
        ? { value: narrowed as SettingValue<K>, source: "organization" }
        : base;
    }
    default:
      return { value: org, source: "organization" };
  }
}

/** Every registry entry as the Studio page and the API show it: the definition without functions. */
export function settingMeta(key: SettingKey) {
  const { fromEnv: _fromEnv, ...meta } = SETTINGS[key] as SettingDef;
  return { key, ...meta, default: settingDefault(key) as AnySettingValue };
}
