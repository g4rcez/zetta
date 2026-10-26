/// <reference types="bun" />
import { describe, expect, test } from "bun:test";
import { createAuthClient } from "better-auth/react";

import {
  AuthenticationRequestError,
  createAuthenticationFetch,
  type AuthenticationFetch,
} from "./auth-transport";

function manualDeadline() {
  let expire = () => {};
  let active = 0;
  return {
    start(callback: () => void) {
      expire = callback;
      active += 1;
      return () => { active -= 1; };
    },
    expire: () => expire(),
    active: () => active,
  };
}

describe("authentication transport deadline", () => {
  test("aborts stalled headers once and releases its deadline", async () => {
    const clock = manualDeadline();
    let calls = 0;
    let signal: AbortSignal | null | undefined;
    const fetcher: AuthenticationFetch = async (_, init) => {
      calls += 1;
      signal = init?.signal;
      return new Promise(() => {});
    };
    const request = createAuthenticationFetch(fetcher, clock.start)("https://identity.invalid");
    clock.expire();
    await expect(request).rejects.toMatchObject({ code: "timeout" });
    expect(signal?.aborted).toBe(true);
    expect(calls).toBe(1);
    expect(clock.active()).toBe(0);
  });

  test("bounds a stalled body and cancels both response branches", async () => {
    const clock = manualDeadline();
    let bodyStarted = () => {};
    const ready = new Promise<void>((resolve) => { bodyStarted = resolve; });
    let cancelled = false;
    const response = new Response(new ReadableStream<Uint8Array>({
      pull() { bodyStarted(); },
      cancel() { cancelled = true; },
    }));
    let signal: AbortSignal | null | undefined;
    const request = createAuthenticationFetch(async (_, init) => {
      signal = init?.signal;
      return response;
    }, clock.start)("https://identity.invalid");
    await ready;
    clock.expire();
    await expect(request).rejects.toMatchObject({ code: "timeout" });
    expect(signal?.aborted).toBe(true);
    expect(clock.active()).toBe(0);
    await Promise.resolve();
    expect(cancelled).toBe(true);
  });

  test("caller cancellation aborts pending work and detaches its listener", async () => {
    const clock = manualDeadline();
    const caller = new AbortController();
    let receivedSignal: AbortSignal | null | undefined;
    const request = createAuthenticationFetch(async (_, init) => {
      receivedSignal = init?.signal;
      return new Promise(() => {});
    }, clock.start)(new Request("https://identity.invalid", { signal: caller.signal }));
    caller.abort(new Error("private cancellation reason"));
    await expect(request).rejects.toMatchObject({ code: "cancelled" });
    expect(receivedSignal?.aborted).toBe(true);
    expect(receivedSignal?.reason).toBeInstanceOf(AuthenticationRequestError);
    expect(clock.active()).toBe(0);
  });

  test("already cancelled requests never start fetch or a deadline", async () => {
    const clock = manualDeadline();
    let calls = 0;
    const caller = new AbortController();
    caller.abort();
    const fetcher = createAuthenticationFetch(async () => {
      calls += 1;
      return new Response();
    }, clock.start);
    await expect(fetcher("https://identity.invalid", { signal: caller.signal }))
      .rejects.toMatchObject({ code: "cancelled" });
    expect(calls).toBe(0);
    expect(clock.active()).toBe(0);
  });

  test("returns the original response and preserves request and cookie semantics", async () => {
    const clock = manualDeadline();
    const response = Response.json({ user: { id: "synthetic-user" } }, {
      status: 201,
      headers: { "set-cookie": "synthetic=value; HttpOnly", "x-auth-result": "created" },
    });
    let observed: RequestInit | undefined;
    const caller = new AbortController();
    const result = await createAuthenticationFetch(async (_, init) => {
      observed = init;
      return response;
    }, clock.start)("https://identity.invalid", {
      method: "POST", credentials: "include", cache: "no-store", body: "synthetic-input",
      headers: { "content-type": "application/json" }, signal: caller.signal,
    });
    expect(result).toBe(response);
    expect(result.status).toBe(201);
    expect(result.headers.get("set-cookie")).toBe("synthetic=value; HttpOnly");
    expect(await result.json()).toEqual({ user: { id: "synthetic-user" } });
    expect(observed).toMatchObject({
      method: "POST", credentials: "include", cache: "no-store", body: "synthetic-input",
      headers: { "content-type": "application/json" },
    });
    expect(clock.active()).toBe(0);
    caller.abort();
    expect(observed?.signal?.aborted).toBe(false);
  });

  test("HTTP denial remains a normal readable response", async () => {
    const clock = manualDeadline();
    const response = Response.json({ code: "INVALID_EMAIL_OR_PASSWORD" }, { status: 401 });
    const result = await createAuthenticationFetch(async () => response, clock.start)("https://identity.invalid");
    expect(result).toBe(response);
    expect(result.status).toBe(401);
    expect(await result.json()).toEqual({ code: "INVALID_EMAIL_OR_PASSWORD" });
    expect(clock.active()).toBe(0);
  });

  test("oversized authentication responses abort without exposing content", async () => {
    const clock = manualDeadline();
    let signal: AbortSignal | null | undefined;
    const fetcher = createAuthenticationFetch(async (_, init) => {
      signal = init?.signal;
      return new Response("private-content".repeat(80_000));
    }, clock.start);
    await expect(fetcher("https://identity.invalid")).rejects.toMatchObject({ code: "response_too_large" });
    expect(signal?.aborted).toBe(true);
    expect(clock.active()).toBe(0);
  });

  test("network and body errors have fixed private-safe diagnostics", async () => {
    for (const fetcher of [
      async () => { throw new Error("private driver detail"); },
      async () => new Response(new ReadableStream({
        start(controller) { controller.error(new Error("private body detail")); },
      })),
    ]) {
      const clock = manualDeadline();
      const error = await createAuthenticationFetch(fetcher, clock.start)("https://identity.invalid")
        .catch((failure: unknown) => failure);
      expect(error).toBeInstanceOf(AuthenticationRequestError);
      expect(error).toMatchObject({ code: "unavailable" });
      expect(String(error)).not.toContain("private");
      expect(clock.active()).toBe(0);
    }
  });

  test("a late header response is cancelled after an expired request", async () => {
    const clock = manualDeadline();
    const pending = Promise.withResolvers<Response>();
    const cancelled = Promise.withResolvers<void>();
    const request = createAuthenticationFetch(() => pending.promise, clock.start)("https://identity.invalid");
    clock.expire();
    await expect(request).rejects.toMatchObject({ code: "timeout" });
    pending.resolve(new Response(new ReadableStream({ cancel() { cancelled.resolve(); } })));
    await cancelled.promise;
    expect(clock.active()).toBe(0);
  });
});

describe("Better Auth transport composition", () => {
  test("successful signin preserves cookies, response hooks and credential input", async () => {
    const clock = manualDeadline();
    const response = Response.json({
      token: "synthetic-session", redirect: false,
      user: { id: "synthetic-user", email: "person@identity.invalid", name: "Person" },
    }, { headers: { "set-cookie": "synthetic=value; HttpOnly" } });
    let input: RequestInit | undefined;
    let hookedResponse: Response | undefined;
    let successful = false;
    const client = createAuthClient({
      baseURL: "https://identity.invalid/api/auth",
      fetchOptions: {
        retry: 0,
        customFetchImpl: createAuthenticationFetch(async (_, init) => {
          input = init;
          return response;
        }, clock.start),
      },
    });
    const result = await client.signIn.email({ email: "person@identity.invalid", password: "synthetic-password" }, {
      onResponse: (context) => { hookedResponse = context.response; },
      onSuccess: () => { successful = true; },
    });
    expect(result.error).toBeNull();
    expect(result.data?.user.id).toBe("synthetic-user");
    expect(hookedResponse).toBe(response);
    expect(hookedResponse?.headers.get("set-cookie")).toBe("synthetic=value; HttpOnly");
    expect(input).toMatchObject({ method: "POST", credentials: "include" });
    expect(input?.body).toBe(JSON.stringify({ email: "person@identity.invalid", password: "synthetic-password" }));
    expect(successful).toBe(true);
    expect(clock.active()).toBe(0);
  });

  test("session refetch settles despite its own signal and clears loading", async () => {
    const clock = manualDeadline();
    let started = () => {};
    const ready = new Promise<void>((resolve) => { started = resolve; });
    let calls = 0;
    const client = createAuthClient({
      baseURL: "https://identity.invalid/api/auth",
      fetchOptions: {
        retry: 0,
        customFetchImpl: createAuthenticationFetch(async () => {
          calls += 1;
          started();
          return new Promise(() => {});
        }, clock.start),
      },
    });
    const session = client.$store.atoms.session;
    if (!session) throw new Error("Expected the installed Better Auth session atom");
    const refetch = session.get().refetch();
    await ready;
    clock.expire();
    await refetch;
    expect(session.get()).toMatchObject({ isPending: false, isRefetching: false });
    expect(session.get().error).toBeInstanceOf(AuthenticationRequestError);
    expect(calls).toBe(1);
    expect(clock.active()).toBe(0);
  });

  test("signout with an uncertain outcome fails once without success hooks", async () => {
    const clock = manualDeadline();
    let started = () => {};
    const ready = new Promise<void>((resolve) => { started = resolve; });
    let calls = 0;
    let successful = false;
    const client = createAuthClient({
      baseURL: "https://identity.invalid/api/auth",
      fetchOptions: {
        retry: 0,
        customFetchImpl: createAuthenticationFetch(async () => {
          calls += 1;
          started();
          return new Promise(() => {});
        }, clock.start),
      },
    });
    const result = client.signOut({ fetchOptions: { onSuccess: () => { successful = true; } } });
    await ready;
    clock.expire();
    await expect(result).rejects.toMatchObject({ code: "timeout" });
    expect(successful).toBe(false);
    expect(calls).toBe(1);
    expect(clock.active()).toBe(0);
  });
});
