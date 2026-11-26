/**
 * Agent accounts: how a person connects their own subscription or key to an engine (Claude Code, Codex, Pi, OMP...), so a bot they use
 * runs on their account and not on one sign-in shared by the whole server. Everything here is pure: the server builds the sign-in and
 * the run from it, and the web app draws the choices from it.
 */

/** The engines that take an account. `fixture` and `decision` run no outside CLI. */
export const ACCOUNT_ENGINES = [
  "claude-code",
  "codex",
  "pi",
  "omp",
  "opencode",
  "cursor",
  "hermes",
  "deepseek",
] as const;
export type AccountEngine = (typeof ACCOUNT_ENGINES)[number];
export const isAccountEngine = (value: unknown): value is AccountEngine =>
  ACCOUNT_ENGINES.includes(value as AccountEngine);
export const ACCOUNT_ENGINE_LABELS: Record<AccountEngine, string> = {
  "claude-code": "Claude Code",
  codex: "Codex",
  pi: "Pi",
  omp: "OMP",
  opencode: "OpenCode",
  cursor: "Cursor",
  hermes: "Hermes",
  deepseek: "DeepSeek",
};

/**
 * What an account is made of. `login`: the CLI's own sign-in, kept in a folder on the server that only this account uses. `token`: a
 * long-lived token of a subscription, stored sealed. `api_key`: a provider key, stored sealed.
 */
export const ACCOUNT_KINDS = ["login", "token", "api_key"] as const;
export type AccountKind = (typeof ACCOUNT_KINDS)[number];

/** `pending`: a sign-in was started and not finished. `signed_out`: the CLI says the sign-in is gone; the person signs in again. */
export const ACCOUNT_STATES = ["pending", "active", "signed_out"] as const;
export type AccountState = (typeof ACCOUNT_STATES)[number];

/** A person has one `default` account per engine: the one their bots use unless a bot names another. */
/**
 * `default`: the account a person's bots use. `extra`: another of theirs. `workspace`: an account an owner or administrator connected for
 * the whole workspace, which a member with none of their own runs on; it is nobody's own account, the administrator's included.
 */
export const ACCOUNT_USES = ["default", "extra", "workspace"] as const;
/** Whom an account a person connects is for. */
export const ACCOUNT_SCOPES = ["mine", "workspace"] as const;
export type AccountScope = (typeof ACCOUNT_SCOPES)[number];
export type AccountUse = (typeof ACCOUNT_USES)[number];

/**
 * Whose account runs a bot when someone who is not its owner talks to it. `asker`: the person who asks, always. `owner_in_rooms`: in a
 * room it runs on its owner's account, so the people of the room need no account of their own for it.
 */
export const SHARED_ACCOUNT = ["asker", "owner_in_rooms"] as const;
export type SharedAccount = (typeof SHARED_ACCOUNT)[number];

/** Whether a person with no account of their own may run on the sign-in of the server's own user. */
export const SERVER_LOGIN = ["allowed", "off"] as const;
export type ServerLogin = (typeof SERVER_LOGIN)[number];

/** The variable each provider's key travels in. A run gets only the key of the account it runs on. */
export const KEY_ENV = {
  anthropic: "ANTHROPIC_API_KEY",
  openai: "OPENAI_API_KEY",
  google: "GEMINI_API_KEY",
  openrouter: "OPENROUTER_API_KEY",
  deepseek: "DEEPSEEK_API_KEY",
  cursor: "CURSOR_API_KEY",
} as const;
export type KeyProvider = keyof typeof KEY_ENV;
export const KEY_PROVIDER_LABELS: Record<KeyProvider, string> = {
  anthropic: "Anthropic",
  openai: "OpenAI",
  google: "Google",
  openrouter: "OpenRouter",
  deepseek: "DeepSeek",
  cursor: "Cursor",
};
export const isKeyProvider = (value: unknown): value is KeyProvider =>
  typeof value === "string" && value in KEY_ENV;

/** The variable a subscription token travels in. */
export const TOKEN_ENV: Partial<Record<AccountEngine, string>> = {
  "claude-code": "CLAUDE_CODE_OAUTH_TOKEN",
};

/** The variable that points a CLI at the folder of its own sign-in. */
export const LOGIN_FOLDER_ENV: Partial<Record<AccountEngine, string>> = {
  codex: "CODEX_HOME",
  omp: "PI_CODING_AGENT_DIR",
  pi: "PI_CODING_AGENT_DIR",
};

const MODEL_KEYS: readonly KeyProvider[] = [
  "anthropic",
  "openai",
  "google",
  "openrouter",
  "deepseek",
];

/**
 * One way to connect an account.
 * - `guided`: the server runs the CLI's own sign-in command and shows its link in the web app. `input: "code"` means the person pastes
 *   a code back; `"none"` means the CLI finishes by itself once the person approves in the browser.
 * - `paste`: the person pastes a token or a key, which is sealed in the browser before it is sent.
 */
export type SignInMethod =
  | {
      id: string;
      way: "guided";
      label: string;
      help: string;
      /** What the finished sign-in leaves: a sealed token, or the CLI's own sign-in in the account's folder. */
      result: "token" | "login";
      input: "code" | "none";
      /** The provider the CLI signs in to, for a CLI that speaks to several. */
      provider?: string;
    }
  | {
      id: string;
      way: "paste";
      label: string;
      help: string;
      kind: "token" | "api_key";
      /** The providers whose key this engine takes. */
      providers?: readonly KeyProvider[];
    };

const key = (providers: readonly KeyProvider[], what: string): SignInMethod => ({
  id: "api_key",
  way: "paste",
  label: "Paste an API key",
  help: `${what} Usage is billed to the key's account, per use.`,
  kind: "api_key",
  providers,
});

export const ENGINE_SIGN_IN: Record<AccountEngine, readonly SignInMethod[]> = {
  "claude-code": [
    {
      id: "subscription",
      way: "guided",
      label: "Sign in with your Claude subscription",
      help: "Zetta opens Claude's own sign-in. You approve in your browser and paste the code it shows back here.",
      result: "token",
      input: "code",
    },
    {
      id: "token",
      way: "paste",
      label: "Paste a token",
      help: "On your own computer run `claude setup-token`, sign in, and paste the token it prints.",
      kind: "token",
    },
    key(["anthropic"], "A key from the Anthropic Console."),
  ],
  codex: [
    {
      id: "subscription",
      way: "guided",
      label: "Sign in with your ChatGPT plan",
      help: "Zetta starts Codex's own sign-in and shows a link and a one-time code. You enter the code on that page.",
      result: "login",
      input: "none",
    },
    key(["openai"], "A key from the OpenAI platform."),
  ],
  omp: [
    {
      id: "subscription-anthropic",
      way: "guided",
      label: "Sign in with your Claude subscription",
      help: "Zetta starts OMP's own sign-in. You approve in your browser and paste the code or the final address back here.",
      result: "login",
      input: "code",
      provider: "anthropic",
    },
    {
      id: "subscription-openai",
      way: "guided",
      label: "Sign in with your ChatGPT plan",
      help: "Zetta starts OMP's own sign-in. You approve in your browser and paste the code or the final address back here.",
      result: "login",
      input: "code",
      provider: "openai-codex",
    },
    key(MODEL_KEYS, "A key of the provider whose models this bot uses."),
  ],
  pi: [key(MODEL_KEYS, "A key of the provider whose models this bot uses.")],
  opencode: [key(MODEL_KEYS, "A key of the provider whose models this bot uses.")],
  hermes: [key(MODEL_KEYS, "A key of the provider whose models this bot uses.")],
  deepseek: [key(["deepseek"], "A key from the DeepSeek platform.")],
  cursor: [key(["cursor"], "A key from your Cursor dashboard.")],
};

export const signInMethod = (engine: AccountEngine, id: string): SignInMethod | undefined =>
  ENGINE_SIGN_IN[engine].find((method) => method.id === id);

export const ACCOUNT_LABEL_MAX = 80;
/** A pasted token or key: long enough to be one, short enough to be nothing else. */
export const ACCOUNT_SECRET = { min: 8, max: 8000 } as const;

export const ACCOUNT_KIND_LABELS: Record<AccountKind, string> = {
  login: "Signed in",
  token: "Subscription token",
  api_key: "API key",
};

/** A label for an account the person did not name. */
export function defaultAccountLabel(kind: AccountKind, provider?: string | null): string {
  if (kind === "api_key" && isKeyProvider(provider)) return `${KEY_PROVIDER_LABELS[provider]} key`;
  return kind === "api_key" ? "API key" : kind === "token" ? "Subscription" : "Subscription";
}
