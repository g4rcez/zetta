/**
 * The user containers run as. By default the server's own uid:gid (POSIX), so bind-mounted homes and profiles stay private (0700,
 * owned by the server user) instead of world-writable; 10001:10001 where there is no uid (Windows) or when ZETTA_CONTAINER_USER sets it.
 */
export function containerUser(env: NodeJS.ProcessEnv = process.env): { user: string; uid: string } {
  const set = env.ZETTA_CONTAINER_USER;
  if (set && /^\d+:\d+$/.test(set)) return { user: set, uid: set.split(":")[0]! };
  const uid = typeof process.getuid === "function" ? process.getuid() : undefined,
    gid = typeof process.getgid === "function" ? process.getgid() : undefined;
  if (uid !== undefined && gid !== undefined && uid !== 0)
    return { user: `${uid}:${gid}`, uid: String(uid) };
  return { user: "10001:10001", uid: "10001" };
}

export type Engine = "docker" | "podman";
const engines = new Map<string, Engine>();
/**
 * The engine that answers on `bin`: a podman shim named `docker` prints "docker version" for `--version` (it reports the name it was
 * started as), but its `version` command says "Podman Engine". Asked once per binary, when a
 * config is built (never per container). `ZETTA_CONTAINER_ENGINE` sets it when the answer is wrong or the binary cannot be run here.
 */
export function engineOf(bin: string, env: NodeJS.ProcessEnv = process.env): Engine {
  const set = env.ZETTA_CONTAINER_ENGINE;
  if (set === "docker" || set === "podman") return set;
  let engine = engines.get(bin);
  if (!engine) {
    let out = "";
    try {
      out = Bun.spawnSync([bin, "version"], {
        stdout: "pipe",
        stderr: "ignore",
        timeout: 5000,
      }).stdout.toString();
    } catch {
      /* no such binary: treated as Docker */
    }
    engine = /podman/i.test(out) ? "podman" : "docker";
    engines.set(bin, engine);
  }
  return engine;
}
/**
 * The `--tmpfs` option that lets the container user write to a mount. Docker: the mount belongs to that user. Podman rejects `uid=`
 * ("unknown mount option"), and a tmpfs over a directory that exists in the image (/home/agent) copies its root-owned 0755 mode,
 * so podman gets `mode=1777` instead. That is the mode /tmp has; the container has one user and nothing else mounted.
 */
export const tmpfsOwner = (engine: Engine | undefined) =>
  engine === "podman" ? ",mode=1777" : `,uid=${containerUser().uid}`;
