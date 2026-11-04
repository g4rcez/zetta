import { createHash } from "node:crypto";
import { chmod, mkdtemp, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { machineKinds } from "@zetta/db/schema/features";
import { ComputerError } from "./service";

/**
 * Runs commands and file transfers on a remote machine for a bot, from the Zetta server. The bot never holds the secret:
 * - ssh and sftp: the private key goes to a short-lived `ssh-agent` on its stdin (never argv, never a file) and the agent is killed
 *   when the call ends. The host key is pinned, so a changed key fails the call.
 * - ftp: `curl` reads the user and password from a config on stdin (never argv).
 * Every result is scrubbed of the secret before it leaves this module.
 */
export type MachineKind = (typeof machineKinds)[number];

export type Target = {
  kind: MachineKind;
  /** The name the person typed. Used for TLS names; the connection goes to `ip`. */
  host: string;
  /** The address `host` resolved to when the call started (one lookup, so a later DNS answer cannot move the call). */
  ip: string;
  port: number;
  username: string;
  /** `<type> <base64>` (ssh and sftp). */
  hostKey: string | null;
};
export type Op =
  | { type: "run"; command: string }
  | { type: "list"; path: string }
  | { type: "get"; remote: string; local: string }
  | { type: "put"; local: string; remote: string };
export type ExecResult = { exitCode: number; output: string; truncated: boolean };
export type HostKeyCandidate = { key: string; type: string; fingerprint: string };

export type Run = {
  stdin?: string;
  env: Record<string, string>;
  timeoutMs: number;
  signal?: AbortSignal;
  maxBytes: number;
};
export type Exit = {
  code: number | null;
  stdout: string;
  stderr: string;
  truncated: boolean;
  timedOut: boolean;
};
export type Spawn = (cmd: string, args: string[], o: Run) => Promise<Exit>;
/** A started `ssh-agent` that holds exactly one key. */
export type Agent = { sock: string; stop(): Promise<void> };
export type StartAgent = (dir: string, key: string, lifetimeSeconds: number) => Promise<Agent>;

const MAX_OUTPUT = 64 * 1024;
const RUN_MS = 120_000;
const TRANSFER_MS = 300_000;
const SCAN_MS = 15_000;
// oxlint-disable-next-line no-control-regex
const CONTROL = /[\u0000-\u001f\u007f]/;
const SAFE_USER = /^[A-Za-z0-9_][A-Za-z0-9_.@-]{0,63}$/;
export const SECRET_MASK = "[redacted]";

/** Replaces the secret, and every line of a multi-line secret (a private key), in text that goes back to a bot, a log or a transcript. */
export function redactSecrets(text: string, secrets: readonly string[]): string {
  const parts = new Set<string>();
  for (const s of secrets) {
    const t = s.trim();
    if (!t) continue;
    parts.add(t);
    for (const line of t.split(/\r?\n/)) if (line.trim().length >= 6) parts.add(line.trim());
  }
  let out = text;
  for (const p of [...parts].sort((a, b) => b.length - a.length))
    out = out.split(p).join(SECRET_MASK);
  return out;
}

/** Keeps the end of a stream: the last lines of a long output are the useful ones. */
async function readTail(stream: ReadableStream<Uint8Array> | null | undefined, max: number) {
  if (!stream) return { text: "", truncated: false };
  const chunks: Uint8Array[] = [];
  let size = 0;
  let truncated = false;
  for await (const c of stream as unknown as AsyncIterable<Uint8Array>) {
    chunks.push(c);
    size += c.length;
    while (size > max && chunks.length > 1) {
      size -= chunks.shift()!.length;
      truncated = true;
    }
  }
  const all = Buffer.concat(chunks);
  if (all.length > max) truncated = true;
  return { text: all.subarray(Math.max(0, all.length - max)).toString("utf8"), truncated };
}

export const bunSpawn: Spawn = async (cmd, args, o) => {
  const proc = Bun.spawn([cmd, ...args], {
    stdin: o.stdin === undefined ? "ignore" : "pipe",
    stdout: "pipe",
    stderr: "pipe",
    env: o.env,
  });
  let timedOut = false;
  const timer = setTimeout(() => {
    timedOut = true;
    proc.kill();
  }, o.timeoutMs);
  const onAbort = () => proc.kill();
  o.signal?.addEventListener("abort", onAbort, { once: true });
  try {
    if (o.stdin !== undefined && proc.stdin) {
      // A command that exits before it reads its stdin closes the pipe: that is its answer, not our error.
      try {
        proc.stdin.write(o.stdin);
        await proc.stdin.end();
      } catch {
        /* the child closed its input */
      }
    }
    const [out, err, code] = await Promise.all([
      readTail(proc.stdout, o.maxBytes),
      readTail(proc.stderr, o.maxBytes),
      proc.exited,
    ]);
    return {
      code: timedOut ? null : code,
      stdout: out.text,
      stderr: err.text,
      truncated: out.truncated || err.truncated,
      timedOut,
    };
  } finally {
    clearTimeout(timer);
    o.signal?.removeEventListener("abort", onAbort);
  }
};

const CLEAN_ENV = (extra: Record<string, string> = {}) => ({
  PATH: process.env.PATH ?? "/usr/bin:/bin",
  LANG: "C",
  ...extra,
});

/** Starts `ssh-agent` on a socket inside `dir` and loads the key from stdin with a lifetime, so it is gone even if cleanup fails. */
export const startSshAgent: StartAgent = async (dir, key, lifetimeSeconds) => {
  const sock = join(dir, "a");
  const proc = Bun.spawn(["ssh-agent", "-D", "-a", sock], {
    stdin: "ignore",
    stdout: "ignore",
    stderr: "ignore",
    env: CLEAN_ENV(),
  });
  const stop = async () => {
    proc.kill();
    await proc.exited.catch(() => undefined);
  };
  try {
    for (let i = 0; i < 50; i++) {
      if (
        await stat(sock).then(
          () => true,
          () => false,
        )
      )
        break;
      if (i === 49) throw new ComputerError("UNAVAILABLE");
      await Bun.sleep(40);
    }
    const add = await bunSpawn("ssh-add", ["-t", String(lifetimeSeconds), "-"], {
      stdin: key,
      // A key with a passphrase must fail, not ask: no terminal prompt, and the "askpass" program always says no.
      env: CLEAN_ENV({
        SSH_AUTH_SOCK: sock,
        SSH_ASKPASS: "/usr/bin/false",
        SSH_ASKPASS_REQUIRE: "force",
      }),
      timeoutMs: 10_000,
      maxBytes: 4096,
    });
    if (add.code !== 0) throw new ComputerError("INVALID");
  } catch (e) {
    await stop();
    throw e;
  }
  return { sock, stop };
};

/** A private key as OpenSSH wants it: LF line ends and one final newline. */
export const normalizeKey = (key: string) => `${key.replace(/\r\n?/g, "\n").trim()}\n`;

/** `SHA256:` fingerprint of a base64 host key, as `ssh-keygen -l` prints it. */
export const fingerprintOf = (b64: string) =>
  `SHA256:${createHash("sha256").update(Buffer.from(b64, "base64")).digest("base64").replace(/=+$/, "")}`;

/** The options that make `ssh` and `sftp` safe to run for a bot: key only, pinned host, no forwarding, no user config. */
export function sshOptions(t: Target, files: { sock: string; knownHosts: string }): string[] {
  const opts = {
    BatchMode: "yes",
    User: t.username,
    IdentityAgent: files.sock,
    PreferredAuthentications: "publickey",
    PasswordAuthentication: "no",
    KbdInteractiveAuthentication: "no",
    StrictHostKeyChecking: "yes",
    UserKnownHostsFile: files.knownHosts,
    GlobalKnownHostsFile: "/dev/null",
    HostKeyAlias: "zetta-machine",
    CheckHostIP: "no",
    VerifyHostKeyDNS: "no",
    UpdateHostKeys: "no",
    ForwardAgent: "no",
    ForwardX11: "no",
    ClearAllForwardings: "yes",
    PermitLocalCommand: "no",
    ProxyCommand: "none",
    ProxyJump: "none",
    ControlMaster: "no",
    ControlPath: "none",
    LogLevel: "ERROR",
    ConnectTimeout: "15",
    ServerAliveInterval: "10",
    ServerAliveCountMax: "3",
  };
  return ["-F", "/dev/null", ...Object.entries(opts).flatMap(([k, v]) => ["-o", `${k}=${v}`])];
}

/** An sftp batch word: quoted, backslash-escaped, never able to start an option or another command. */
export function sftpWord(path: string): string {
  if (!path || CONTROL.test(path)) throw new ComputerError("INVALID");
  const safe = path.startsWith("-") ? `./${path}` : path;
  return `"${safe.replace(/(["\\])/g, "\\$1")}"`;
}
export function sftpBatch(op: Exclude<Op, { type: "run" }>): string {
  switch (op.type) {
    case "list":
      return `ls -l ${sftpWord(op.path)}\n`;
    case "get":
      return `get ${sftpWord(op.remote)} ${sftpWord(op.local)}\n`;
    case "put":
      return `put ${sftpWord(op.local)} ${sftpWord(op.remote)}\n`;
  }
}

const curlWord = (v: string) => {
  if (CONTROL.test(v)) throw new ComputerError("INVALID");
  return `"${v.replace(/\\/g, "\\\\").replace(/"/g, '\\"')}"`;
};
/** `ftp://host:port/path`. An absolute remote path becomes `/%2F…`, which is how curl asks for one. */
export function ftpUrl(host: string, port: number, path: string): string {
  if (CONTROL.test(path)) throw new ComputerError("INVALID");
  const h = host.includes(":") ? `[${host}]` : host;
  const abs = path.startsWith("/");
  const rest = path
    .replace(/^\/+/, "")
    .split("/")
    .map((s) => encodeURIComponent(s))
    .join("/");
  return `ftp://${h}:${port}/${abs ? "%2F" : ""}${rest}`;
}
/** The curl config read from stdin: the only place the FTP password appears. */
export function ftpConfig(t: Target, password: string, op: Exclude<Op, { type: "run" }>): string {
  const remote = op.type === "list" ? op.path : op.remote;
  const url = ftpUrl(
    t.host,
    t.port,
    op.type === "list" ? `${op.path.replace(/\/+$/, "")}/` : remote,
  );
  const lines = [
    `user = ${curlWord(`${t.username}:${password}`)}`,
    `url = ${curlWord(url)}`,
    // Connect to the address we checked, but keep the name for the TLS certificate.
    `connect-to = ${curlWord(`${t.host}:${t.port}:${t.ip}:${t.port}`)}`,
  ];
  if (op.type === "get") lines.push(`output = ${curlWord(op.local)}`);
  if (op.type === "put") lines.push(`upload-file = ${curlWord(op.local)}`);
  return `${lines.join("\n")}\n`;
}
export const curlArgs = (op: Exclude<Op, { type: "run" }>) => [
  "-q",
  "--silent",
  "--show-error",
  "--fail",
  "--proto",
  "=ftp,ftps",
  // Plain FTP stays allowed, but TLS is used whenever the server offers it.
  "--ssl",
  // A hostile server must not send us to another address in its PASV answer.
  "--ftp-skip-pasv-ip",
  "--connect-timeout",
  "15",
  "--max-time",
  String(Math.floor((op.type === "list" ? RUN_MS : TRANSFER_MS) / 1000)),
  ...(op.type === "get" ? ["--max-filesize", String(512 * 1024 * 1024)] : []),
  "-K",
  "-",
];

function sshFailure(e: Exit): ComputerError | undefined {
  if (e.timedOut) return new ComputerError("SLOW");
  const msg = e.stderr;
  if (/host key verification failed|REMOTE HOST IDENTIFICATION HAS CHANGED/i.test(msg))
    return new ComputerError("HOST_KEY_CHANGED");
  if (/permission denied|too many authentication failures/i.test(msg))
    return new ComputerError("AUTH_FAILED");
  if (
    e.code === 255 ||
    /connection (timed out|refused|closed|reset)|no route to host|could not resolve|network is unreachable/i.test(
      msg,
    )
  )
    return new ComputerError("UNREACHABLE");
  return undefined;
}
const CURL_AUTH = new Set([67, 9]);
const CURL_UNREACHABLE = new Set([6, 7, 28, 35, 52, 56, 60]);

export function createMachineRunner(
  deps: { spawn?: Spawn; startAgent?: StartAgent; tmp?: () => Promise<string> } = {},
) {
  const spawn = deps.spawn ?? bunSpawn;
  const startAgent = deps.startAgent ?? startSshAgent;
  // A unix socket path is short (about 100 bytes), so the directory sits directly in the system temp folder.
  const tmp =
    deps.tmp ??
    (async () => {
      const base = tmpdir().length > 60 ? "/tmp" : tmpdir();
      const dir = await mkdtemp(join(base, "zsh-"));
      await chmod(dir, 0o700);
      return dir;
    });

  /** A private temp folder, the pinned host key in it (when there is one), an agent that holds the key. All gone when `use` returns. */
  async function withAgent<T>(
    hostKey: string | null,
    key: string,
    use: (files: { sock: string; knownHosts: string }) => Promise<T>,
  ): Promise<T> {
    const dir = await tmp();
    let agent: Agent | undefined;
    try {
      const knownHosts = join(dir, "known_hosts");
      if (hostKey) await writeFile(knownHosts, `zetta-machine ${hostKey}\n`, { mode: 0o600 });
      agent = await startAgent(dir, normalizeKey(key), 600);
      return await use({ sock: agent.sock, knownHosts });
    } finally {
      await agent?.stop().catch(() => undefined);
      await rm(dir, { recursive: true, force: true });
    }
  }

  const finish = (e: Exit, secret: string): ExecResult => {
    const stderr = e.stderr.trim();
    const joined = [e.stdout.trimEnd(), stderr ? `[stderr]\n${stderr}` : ""]
      .filter(Boolean)
      .join("\n");
    return {
      exitCode: e.code ?? 1,
      output: redactSecrets(joined, [secret]).slice(-MAX_OUTPUT),
      truncated: e.truncated,
    };
  };

  return {
    /** Runs one operation. `secret` is the private key (ssh, sftp) or the password (ftp). Throws a `ComputerError` for a failed connection. */
    async exec(
      t: Target,
      secret: string,
      op: Op,
      o: { signal?: AbortSignal } = {},
    ): Promise<ExecResult> {
      if (t.kind === "ftp") {
        if (op.type === "run") throw new ComputerError("UNSUPPORTED");
        const e = await spawn("curl", curlArgs(op), {
          stdin: ftpConfig(t, secret, op),
          env: CLEAN_ENV(),
          timeoutMs: (op.type === "list" ? RUN_MS : TRANSFER_MS) + 5000,
          signal: o.signal,
          maxBytes: MAX_OUTPUT,
        });
        if (e.timedOut) throw new ComputerError("SLOW");
        if (e.code !== 0 && CURL_AUTH.has(e.code ?? -1)) throw new ComputerError("AUTH_FAILED");
        if (e.code !== 0 && CURL_UNREACHABLE.has(e.code ?? -1))
          throw new ComputerError("UNREACHABLE");
        const r = finish(e, secret);
        return op.type === "list" || e.code !== 0
          ? r
          : { ...r, output: op.type === "get" ? "Downloaded." : "Uploaded." };
      }
      if (op.type === "run" && t.kind !== "ssh") throw new ComputerError("UNSUPPORTED");
      if (!t.hostKey || !SAFE_USER.test(t.username)) throw new ComputerError("INVALID");
      return withAgent(t.hostKey, secret, async (files) => {
        const common = sshOptions(t, files);
        const env = CLEAN_ENV({ SSH_AUTH_SOCK: files.sock });
        const e =
          op.type === "run"
            ? await spawn("ssh", [...common, "-p", String(t.port), t.ip, "--", op.command], {
                env,
                timeoutMs: RUN_MS,
                signal: o.signal,
                maxBytes: MAX_OUTPUT,
              })
            : await spawn("sftp", [...common, "-P", String(t.port), "-b", "-", t.ip], {
                stdin: sftpBatch(op),
                env,
                timeoutMs: op.type === "list" ? RUN_MS : TRANSFER_MS,
                signal: o.signal,
                maxBytes: MAX_OUTPUT,
              });
        const failure = sshFailure(e);
        if (failure) throw failure;
        return finish(e, secret);
      });
    },

    /** The host keys the machine offers right now, for the person to compare and pin. */
    async scan(ip: string, port: number): Promise<HostKeyCandidate[]> {
      const e = await spawn(
        "ssh-keyscan",
        ["-T", "10", "-p", String(port), "-t", "ed25519,ecdsa,rsa", ip],
        {
          env: CLEAN_ENV(),
          timeoutMs: SCAN_MS,
          maxBytes: 16 * 1024,
        },
      );
      const keys: HostKeyCandidate[] = [];
      for (const line of e.stdout.split("\n")) {
        if (!line || line.startsWith("#")) continue;
        const [, type, b64] = line.trim().split(/\s+/);
        if (type && b64 && /^[A-Za-z0-9+/=]+$/.test(b64) && !keys.some((k) => k.type === type))
          keys.push({ type, key: `${type} ${b64}`, fingerprint: fingerprintOf(b64) });
      }
      if (!keys.length) throw new ComputerError("UNREACHABLE");
      return keys;
    },

    /**
     * The public half of a private key, without its comment (often `user@host`). The key is read the way a call reads it, through an
     * agent: `ssh-keygen -f` refuses a pipe. Throws INVALID for a key it cannot load, such as one with a passphrase.
     */
    async publicKey(key: string): Promise<string> {
      return withAgent(null, key, async ({ sock }) => {
        const e = await spawn("ssh-add", ["-L"], {
          env: CLEAN_ENV({ SSH_AUTH_SOCK: sock }),
          timeoutMs: 10_000,
          maxBytes: 8192,
        });
        const [type, b64] = e.stdout.trim().split(/\s+/);
        if (e.code !== 0 || !type || !b64) throw new ComputerError("INVALID");
        return `${type} ${b64}`;
      });
    },
  };
}
export type MachineRunner = ReturnType<typeof createMachineRunner>;
