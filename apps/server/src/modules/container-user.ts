/**
 * The user containers run as. By default the server's own uid:gid (POSIX), so bind-mounted homes and profiles stay private (0700,
 * owned by the server user) instead of world-writable; 10001:10001 where there is no uid (Windows) or when ZETTA_CONTAINER_USER sets it.
 */
export function containerUser(env: NodeJS.ProcessEnv = process.env): { user: string; uid: string } {
  const set = env.ZETTA_CONTAINER_USER;
  if (set && /^\d+:\d+$/.test(set)) return { user: set, uid: set.split(":")[0]! };
  const uid = typeof process.getuid === "function" ? process.getuid() : undefined, gid = typeof process.getgid === "function" ? process.getgid() : undefined;
  if (uid !== undefined && gid !== undefined && uid !== 0) return { user: `${uid}:${gid}`, uid: String(uid) };
  return { user: "10001:10001", uid: "10001" };
}
