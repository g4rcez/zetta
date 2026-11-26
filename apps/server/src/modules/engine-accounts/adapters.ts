// What the server knows about each engine's own sign-in: the command it runs, what to read from its output, how to ask whether a
// sign-in still holds, and what a run needs to use an account. The choices a person sees are in @zetta/core/engine-accounts.
import { join } from "node:path";
import {
  type AccountEngine,
  type AccountKind,
  isKeyProvider,
  KEY_ENV,
  LOGIN_FOLDER_ENV,
  type SignInMethod,
  TOKEN_ENV,
} from "@zetta/core/engine-accounts";
import { dataDir } from "@zetta/core/zetta-home";
import type { RunAccount } from "../chat/harness";

export type { RunAccount };

/** The folder of one account: the CLI's own sign-in and state. Only runs on that account are pointed at it. */
export const accountFolder = (accountId: string) => join(dataDir("engine-accounts"), accountId);

type Guided = Extract<SignInMethod, { way: "guided" }>;

/** How one guided sign-in is run. */
export type GuidedRun = {
  /** The command, its first word being the program to find on the server. */
  argv: string[];
  /** The command draws a screen and reads keys: it gets a terminal. Otherwise it gets a pipe. */
  terminal: boolean;
  /** The variables that keep the sign-in inside `folder`. */
  env: (folder: string) => Record<string, string>;
  /** What the output shows so far. `token` ends a sign-in whose result is a token. */
  read: (text: string) => { url?: string; code?: string; token?: string };
};

const first = (text: string, pattern: RegExp) => pattern.exec(text)?.[0];

export function guidedRun(engine: AccountEngine, method: Guided): GuidedRun {
  if (engine === "claude-code")
    return {
      argv: ["claude", "setup-token"],
      terminal: true,
      env: (folder) => ({ CLAUDE_CONFIG_DIR: folder }),
      read: (text) => ({
        url: first(
          text,
          /https:\/\/(?:claude\.ai|console\.anthropic\.com|platform\.claude\.com)\/oauth\/authorize[^\s"'<>]*/,
        ),
        token: first(text, /sk-ant-oat\d{2}-[A-Za-z0-9_-]{20,}/),
      }),
    };
  if (engine === "codex")
    return {
      argv: ["codex", "login", "--device-auth"],
      terminal: false,
      env: (folder) => ({ CODEX_HOME: folder }),
      read: (text) => ({
        url: first(text, /https:\/\/auth\.openai\.com\/[^\s"'<>]*/),
        code: first(text, /\b[A-Z0-9]{4}-[A-Z0-9]{4,6}\b/),
      }),
    };
  if (engine === "omp")
    return {
      argv: ["omp", "login", method.provider ?? "anthropic"],
      terminal: false,
      env: (folder) => ({ PI_CODING_AGENT_DIR: folder }),
      read: (text) => ({
        url: first(text.slice(Math.max(0, text.indexOf("Open this URL"))), /https:\/\/[^\s"'<>]+/),
      }),
    };
  throw new Error(`no guided sign-in for ${engine}`);
}

/** The command that asks a CLI whether the sign-in in `folder` still holds, and how to read its answer. Undefined: the CLI cannot say. */
export function loginCheck(
  engine: AccountEngine,
  provider: string | null,
):
  | {
      argv: string[];
      env: (folder: string) => Record<string, string>;
      signedIn: (text: string, exit: number) => boolean;
    }
  | undefined {
  if (engine === "codex")
    return {
      argv: ["codex", "login", "status"],
      env: (folder) => ({ CODEX_HOME: folder }),
      signedIn: (text, exit) =>
        exit === 0 && /logged in/i.test(text) && !/not logged in/i.test(text),
    };
  if (engine === "omp")
    return {
      argv: ["omp", "token", provider ?? "anthropic", "--list"],
      env: (folder) => ({ PI_CODING_AGENT_DIR: folder }),
      signedIn: (text, exit) => exit === 0 && !/no oauth accounts/i.test(text),
    };
  return undefined;
}

/**
 * What a run gets from an account. A key or a token travels in the variable its CLI reads. A CLI that keeps a sign-in of its own in a
 * folder (Codex, Pi, OMP) is always pointed at the account's folder, also for a key: left at the server user's folder it would find
 * the sign-in of the server's own user there and could run on that one.
 */
export function attach(
  account: {
    id: string;
    ownerUserId: string;
    engine: AccountEngine;
    kind: AccountKind;
    provider: string | null;
  },
  secret: string | undefined,
): RunAccount {
  const env: Record<string, string> = {};
  if (account.kind === "token") {
    const variable = TOKEN_ENV[account.engine];
    if (!variable || !secret) throw new Error("this engine takes no token");
    env[variable] = secret;
  }
  if (account.kind === "api_key") {
    if (!isKeyProvider(account.provider) || !secret) throw new Error("this key has no provider");
    env[KEY_ENV[account.provider]] = secret;
    // Codex reads its own name for the key when it runs without a terminal.
    if (account.engine === "codex") Object.assign(env, { CODEX_API_KEY: secret });
  }
  const variable = LOGIN_FOLDER_ENV[account.engine];
  return {
    accountId: account.id,
    ownerUserId: account.ownerUserId,
    env,
    ...(variable ? { folder: { path: accountFolder(account.id), variable } } : {}),
  };
}
