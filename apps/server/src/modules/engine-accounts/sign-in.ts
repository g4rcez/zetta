// A guided sign-in: the server runs the CLI's own sign-in command, reads the link (and the code) it prints, and passes back what the
// person pastes. Only that one command runs, with a short environment and the account's own folder: there is no shell and nothing the
// person types is ever a command. A sign-in lives in this process's memory for a few minutes; a restart forgets it and the person
// starts again.
import { mkdir, mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { uuidv7 } from "@zetta/core/uuid";
import { type AccountEngine, signInMethod, type AccountScope } from "@zetta/core/engine-accounts";
import {
  cliEnv,
  CONTAINER_ACCOUNT_DIR,
  containerCli,
  containerClientEnv,
  dockerConfig,
} from "../chat/harness";
import type { ActiveActor } from "../identity/access";
import { accountFolder, guidedRun, loginCheck } from "./adapters";
import { EngineAccountError, type EngineAccounts } from "./service";

/** `waiting`: the link is shown and the CLI waits (for the person's approval, or for a code). */
export const SIGN_IN_STATES = ["starting", "waiting", "done", "failed", "cancelled"] as const;
export type SignInState = (typeof SIGN_IN_STATES)[number];

type Session = {
  id: string;
  userId: string;
  engine: AccountEngine;
  method: string;
  state: SignInState;
  url?: string;
  code?: string;
  /** The CLI takes a code the person pastes. */
  input: "code" | "none";
  message?: string;
  accountId?: string;
  startedAt: number;
  write?: (text: string) => void;
  stop: () => void;
};

export type SignInView = ReturnType<typeof view>;
const view = (s: Session) => ({
  id: s.id,
  engine: s.engine,
  method: s.method,
  state: s.state,
  url: s.url ?? null,
  code: s.code ?? null,
  input: s.input,
  message: s.message ?? null,
  accountId: s.accountId ?? null,
});

/** What a terminal draws around the text: colours, cursor moves, hyperlink wrappers. */
export const plain = (text: string) =>
  text
    // An OSC 8 hyperlink keeps its target between the two escapes: keep the target, drop the wrapper.
    // oxlint-disable-next-line no-control-regex -- terminal escapes are what this removes
    .replace(/\x1b\]8;[^;]*;([^\x07\x1b]*)(?:\x07|\x1b\\)/g, " $1 ")
    // oxlint-disable-next-line no-control-regex -- terminal escapes are what this removes
    .replace(/\x1b\][^\x07\x1b]*(?:\x07|\x1b\\)/g, "")
    // oxlint-disable-next-line no-control-regex -- terminal escapes are what this removes
    .replace(/\x1b\[[0-9;?]*[ -/]*[@-~]/g, " ")
    // oxlint-disable-next-line no-control-regex -- terminal escapes are what this removes
    .replace(/\x1b[@-Z\\-_]/g, "");

const LIMIT_MS = 10 * 60_000;
const OUTPUT_CAP = 64_000;

export type SignInDeps = {
  accounts: EngineAccounts;
  /** Finds a program on the server. Replaced in tests. */
  resolve?: (name: string) => string | null;
  /** Where bot runs happen: on the server itself, or in a container image that holds the engines. Replaced in tests. */
  container?: typeof dockerConfig;
  /** Starts the command. Replaced in tests by a scripted process. */
  spawn?: typeof start;
  limitMs?: number;
};

type Started = {
  write: (text: string) => void;
  kill: () => void;
  exited: Promise<number>;
};
/** Starts one command with a short environment. `onText` gets everything it prints. */
function start(
  argv: string[],
  options: { env: Record<string, string>; terminal: boolean; onText: (text: string) => void },
): Started {
  const decoder = new TextDecoder();
  if (options.terminal) {
    // Wide, so a long link is never broken across lines by the program that draws it.
    const child = Bun.spawn(argv, {
      env: options.env,
      terminal: {
        cols: 500,
        rows: 50,
        data: (_terminal, data) => options.onText(decoder.decode(data, { stream: true })),
      },
    });
    return {
      // A terminal sends Return as a carriage return.
      write: (text) => void child.terminal?.write(`${text}\r`),
      kill: () => child.kill(),
      exited: child.exited,
    };
  }
  const child = Bun.spawn(argv, {
    env: options.env,
    stdin: "pipe",
    stdout: "pipe",
    stderr: "pipe",
  });
  const pump = async (stream: ReadableStream<Uint8Array>) => {
    for await (const chunk of stream) options.onText(decoder.decode(chunk, { stream: true }));
  };
  void pump(child.stdout).catch(() => undefined);
  void pump(child.stderr).catch(() => undefined);
  return {
    write: (text) => {
      child.stdin.write(`${text}\n`);
      void child.stdin.flush();
    },
    kill: () => child.kill(),
    exited: child.exited,
  };
}

export function createSignIns(deps: SignInDeps) {
  const sessions = new Map<string, Session>();
  const resolve = deps.resolve ?? Bun.which;
  const spawn = deps.spawn ?? start;
  const limit = deps.limitMs ?? LIMIT_MS;
  const container = deps.container ?? dockerConfig;
  const checking = new Set<string>();

  /**
   * The command to start and its environment. On the server itself it is the engine's own program. Where bot runs happen in a
   * container, the engines live in that image and not on the server, so the command runs there, with the account's folder mounted.
   * Undefined: the engine is not installed where runs happen.
   */
  function command(
    argv: string[],
    variables: (folder: string) => Record<string, string>,
    folder: string,
    terminal: boolean,
  ) {
    const image = container();
    if (image)
      return {
        argv: containerCli(image, {
          argv,
          folder,
          variables: variables(CONTAINER_ACCOUNT_DIR),
          terminal,
        }),
        env: containerClientEnv(),
      };
    const program = resolve(argv[0]!);
    return program
      ? { argv: [program, ...argv.slice(1)], env: cliEnv(variables(folder)) }
      : undefined;
  }

  const mine = (actor: ActiveActor, id: string) => {
    const session = sessions.get(id);
    if (!session || session.userId !== actor.userId)
      throw new EngineAccountError("NOT_FOUND", "That sign-in is over. Start it again.");
    return session;
  };
  /** A finished sign-in stays readable for a minute, so the page that polls it sees how it ended. */
  const forget = (id: string) => void setTimeout(() => sessions.delete(id), 60_000).unref?.();

  return {
    /** Starts the engine's guided sign-in for this person. One at a time per person and engine: a new one replaces the old. */
    async start(
      actor: ActiveActor,
      engine: AccountEngine,
      methodId: string,
      scope: AccountScope = "mine",
    ) {
      const method = signInMethod(engine, methodId);
      if (method?.way !== "guided")
        throw new EngineAccountError("INVALID", "This engine does not sign in that way.");
      const run = guidedRun(engine, method);
      if (!command(run.argv, run.env, "/", run.terminal))
        throw new EngineAccountError(
          "UNAVAILABLE",
          "This engine is not installed on the server. Ask the person who runs it, or paste a token or a key.",
        );
      for (const old of sessions.values())
        if (old.userId === actor.userId && old.engine === engine && old.state !== "done")
          old.stop();

      // A sign-in that leaves the CLI's own files keeps them in the account's folder; one that ends in a token needs only a scratch one.
      const pending =
        method.result === "login"
          ? await deps.accounts.beginLogin(actor, engine, methodId, scope)
          : undefined;
      const folder = pending
        ? accountFolder(pending.id)
        : await mkdtemp(join(tmpdir(), "zetta-sign-in-"));
      await mkdir(folder, { recursive: true, mode: 0o700 });

      let output = "";
      let settled = false;
      const session: Session = {
        id: uuidv7(),
        userId: actor.userId,
        engine,
        method: methodId,
        state: "starting",
        input: method.input,
        startedAt: Date.now(),
        stop: () => undefined,
      };
      sessions.set(session.id, session);

      /** Ends the sign-in once. A failed or cancelled one leaves no account and no folder behind. */
      const settle = async (
        state: "done" | "failed" | "cancelled",
        message?: string,
        token?: string,
      ) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        child.kill();
        delete session.write;
        try {
          if (state === "done" && token) {
            const account = await deps.accounts.createFromSecret(actor, {
              engine,
              method: methodId,
              secret: token,
              for: scope,
            });
            session.accountId = account.id;
          } else if (state === "done" && pending) {
            session.accountId = (await deps.accounts.finishLogin(actor, pending.id)).id;
          }
          session.state = state;
          if (message) session.message = message;
        } catch (error) {
          session.state = "failed";
          session.message =
            error instanceof EngineAccountError ? error.message : "The account could not be saved.";
        }
        if (session.state !== "done" && pending)
          await deps.accounts.remove(actor, pending.id).catch(() => undefined);
        if (!pending) await rm(folder, { recursive: true, force: true }).catch(() => undefined);
        // Nothing of the CLI's output is kept: it may hold the token.
        output = "";
        forget(session.id);
      };

      const cli = command(run.argv, run.env, folder, run.terminal)!;
      const child = spawn(cli.argv, {
        env: cli.env,
        terminal: run.terminal,
        onText: (text) => {
          if (settled) return;
          output = (output + plain(text)).slice(-OUTPUT_CAP);
          const seen = run.read(output);
          if (seen.url) session.url = seen.url;
          if (seen.code) session.code = seen.code;
          if (session.url && session.state === "starting") session.state = "waiting";
          if (seen.token) void settle("done", undefined, seen.token);
        },
      });
      session.write = child.write;
      session.stop = () => void settle("cancelled");
      const timer = setTimeout(
        () => void settle("failed", "The sign-in took too long. Start it again."),
        limit,
      );
      timer.unref?.();

      void child.exited.then(async (exit) => {
        if (settled) return;
        if (method.result === "token")
          return settle("failed", "The sign-in ended before it gave a token. Start it again.");
        // The CLI's own word on whether it is signed in now, when it has one; else its exit status.
        const check = loginCheck(engine, method.provider ?? null);
        const ok = check ? await asked(check, folder) : exit === 0;
        await settle(
          ok ? "done" : "failed",
          ok ? undefined : "The sign-in was not completed. Start it again.",
        );
      });
      return view(session);
    },

    get(actor: ActiveActor, id: string) {
      return view(mine(actor, id));
    },

    /** Passes on what the person pasted: the code, or the address the provider sent them to. One line, never a command. */
    input(actor: ActiveActor, id: string, text: string) {
      const session = mine(actor, id);
      // oxlint-disable-next-line no-control-regex -- a pasted code is one line of printable text
      const line = text.replace(/[\r\n\x00-\x1f\x7f]/g, "").trim();
      if (!line || line.length > 4000)
        throw new EngineAccountError("INVALID", "Paste the code the sign-in page showed you.");
      if (session.input !== "code" || !session.write || session.state !== "waiting")
        throw new EngineAccountError("INVALID", "This sign-in is not waiting for a code.");
      session.write(line);
      return view(session);
    },

    cancel(actor: ActiveActor, id: string) {
      const session = mine(actor, id);
      session.stop();
      return { id };
    },

    /**
     * A run on this account was refused by its engine. A sign-in the CLI keeps in the account's folder is asked again, and the answer
     * recorded; the error alone is not enough, since the words of a sign-in error also turn up in other failures. A token or a key is
     * left as it is: the run already told the person to connect again. One check at a time per account.
     */
    async recheck(accountId: string) {
      if (checking.has(accountId)) return;
      checking.add(accountId);
      try {
        const row = await deps.accounts.byId(accountId);
        if (row?.kind === "login" && row.state === "active") await this.check(row);
      } finally {
        checking.delete(accountId);
      }
    },

    /** Asks the CLI of a `login` account whether its sign-in still holds, and records the answer. */
    async check(account: { id: string; engine: AccountEngine; provider: string | null }) {
      const check = loginCheck(account.engine, account.provider);
      if (!check) return undefined;
      const ok = await asked(check, accountFolder(account.id));
      await deps.accounts.markChecked(account.id, ok);
      return ok;
    },
  };

  async function asked(check: NonNullable<ReturnType<typeof loginCheck>>, folder: string) {
    const cli = command(check.argv, check.env, folder, false);
    if (!cli) return false;
    let text = "";
    const child = spawn(cli.argv, {
      env: cli.env,
      terminal: false,
      onText: (chunk) => void (text = (text + chunk).slice(-OUTPUT_CAP)),
    });
    const timer = setTimeout(() => child.kill(), 20_000);
    const exit = await child.exited;
    clearTimeout(timer);
    // The pipes may still hold the last lines when the process is gone.
    await Bun.sleep(20);
    return check.signedIn(plain(text), exit);
  }
}
export type SignIns = ReturnType<typeof createSignIns>;
