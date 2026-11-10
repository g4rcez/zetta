import { randomBytes } from "node:crypto";
import { mkdirSync, readFileSync, unlinkSync, writeFileSync } from "node:fs";
import { join } from "node:path";

/**
 * One running app per user. The first instance listens on a loopback port and records `{ port, token }` in a lock file in the user-data folder
 * (created exclusively, mode 0600). A later launch reads it, sends its command line to the first instance and exits.
 * A lock whose owner does not answer is stale (a crash, a power cut) and is replaced. The token keeps other local software from steering the app.
 */
export type InstanceLock = { release(): void };

type LockFile = { pid: number; port: number; token: string };

const MAX_MESSAGE = 64 * 1024;
const ACK = "ok\n";

const parseLock = (text: string): LockFile | null => {
  try {
    const row = JSON.parse(text) as Partial<LockFile>;
    return typeof row.port === "number" &&
      typeof row.token === "string" &&
      typeof row.pid === "number"
      ? (row as LockFile)
      : null;
  } catch {
    return null;
  }
};

/** Sends `argv` to the instance that holds the lock. True when it answered. */
async function forward(lock: LockFile, argv: string[], timeoutMs: number): Promise<boolean> {
  return await new Promise<boolean>((resolve) => {
    let done = false;
    const finish = (value: boolean) => {
      if (done) return;
      done = true;
      clearTimeout(timer);
      resolve(value);
    };
    const timer = setTimeout(() => finish(false), timeoutMs);
    Bun.connect({
      hostname: "127.0.0.1",
      port: lock.port,
      socket: {
        open(socket) {
          socket.write(`${JSON.stringify({ token: lock.token, argv })}\n`);
        },
        data(socket, data) {
          finish(Buffer.from(data).toString() === ACK);
          socket.end();
        },
        close: () => finish(false),
        error: () => finish(false),
        connectError: () => finish(false),
      },
    }).catch(() => finish(false));
  });
}

/**
 * Takes the lock, or hands `argv` to the instance that has it.
 * Returns null when another instance is running (this one must exit), otherwise the lock, whose `onArgv` receives every later launch.
 */
export async function acquireInstanceLock(
  dir: string,
  argv: string[],
  onArgv: (argv: string[]) => void,
  timeoutMs = 1_500,
): Promise<InstanceLock | null> {
  mkdirSync(dir, { recursive: true });
  const path = join(dir, "instance.lock");
  const token = randomBytes(24).toString("hex");

  const listener = Bun.listen({
    hostname: "127.0.0.1",
    port: 0,
    socket: {
      data(socket, data) {
        const text = Buffer.from(data).toString();
        if (text.length > MAX_MESSAGE) {
          socket.end();
          return;
        }
        try {
          const message = JSON.parse(text.split("\n")[0]!) as { token?: unknown; argv?: unknown };
          if (message.token !== token || !Array.isArray(message.argv)) {
            socket.end();
            return;
          }
          onArgv(
            message.argv.filter((item): item is string => typeof item === "string").slice(0, 32),
          );
          socket.write(ACK);
        } catch {
          // Not our protocol: drop it.
        }
        socket.end();
      },
    },
  });

  const mine: LockFile = { pid: process.pid, port: listener.port, token };
  const release = () => {
    listener.stop(true);
    try {
      if (parseLock(readFileSync(path, "utf8"))?.token === token) unlinkSync(path);
    } catch {
      // Already gone.
    }
  };

  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      writeFileSync(path, JSON.stringify(mine), { flag: "wx", mode: 0o600 });
      return { release };
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "EEXIST") {
        listener.stop(true);
        throw error;
      }
    }
    let text = "";
    try {
      text = readFileSync(path, "utf8");
    } catch {
      continue; // It vanished between the two calls: try to create it again.
    }
    const other = parseLock(text);
    if (other && (await forward(other, argv, timeoutMs))) {
      listener.stop(true);
      return null;
    }
    // Nobody answered: the lock is stale. Remove it only if it is still the same one we looked at.
    try {
      if (readFileSync(path, "utf8") === text) unlinkSync(path);
    } catch {
      // Someone else removed it first.
    }
  }
  listener.stop(true);
  throw new Error("INSTANCE_LOCK_UNAVAILABLE");
}
