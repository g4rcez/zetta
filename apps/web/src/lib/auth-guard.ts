const TTL_MS = 30_000;
let hit: { at: number; value: Promise<unknown> } | undefined;

/**
 * Short cache for the `_auth` route guard: link-hover preloads run the guard again for every route, and each run costs two requests.
 * Only a successful check is kept (a redirect or an error is never cached), and sign-in, sign-out, sign-up and invitation
 * requests drop it (see `invalidateAuthGuard` in auth-client.ts and identity-client.ts callers).
 */
export function cachedAuthGuard<T>(load: () => Promise<T>): Promise<T> {
  if (hit && Date.now() - hit.at < TTL_MS) return hit.value as Promise<T>;
  const entry = { at: Date.now(), value: load() };
  hit = entry;
  entry.value.catch(() => {
    if (hit === entry) hit = undefined;
  });
  return entry.value as Promise<T>;
}

export const invalidateAuthGuard = () => {
  hit = undefined;
};
