/**
 * One session lookup per request. The request log (`identifyUser` in app.ts) and the route's access check both read the session of the same
 * request: two queries for one answer. The result is kept only while the request's `Headers` object is alive (a WeakMap), so nothing is
 * shared between requests and a sign-out is seen by the next one.
 */
type SessionApi = { getSession: (input: never) => Promise<unknown> };

export function memoizeSession<T extends { api: SessionApi }>(auth: T): T {
  const memo = new WeakMap<Headers, Promise<unknown>>();
  const getSession = (input: { headers?: unknown; [key: string]: unknown }) => {
    const original = auth.api.getSession as (input: unknown) => Promise<unknown>;
    // Another option (a query, `asResponse`) can change the answer: ask the real function.
    if (!(input.headers instanceof Headers) || Object.keys(input).some((k) => k !== "headers"))
      return original.call(auth.api, input);
    const headers = input.headers;
    let hit = memo.get(headers);
    if (!hit) {
      hit = original.call(auth.api, input);
      memo.set(headers, hit);
      hit.catch(() => memo.delete(headers)); // a failure is not remembered
    }
    return hit;
  };
  const api = new Proxy(auth.api, {
    get: (target, key) => (key === "getSession" ? getSession : Reflect.get(target, key, target)),
  });
  return new Proxy(auth, {
    get: (target, key) => (key === "api" ? api : Reflect.get(target, key, target)),
  });
}
