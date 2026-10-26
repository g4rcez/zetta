/// <reference types="bun" />
import { describe, expect, test } from "bun:test";

import {
  createIdentityClient,
  getIdentityError,
  IdentityRequestError,
  type IdentityFetch,
} from "./identity-client";

type CapturedRequest = { url: URL; init: RequestInit };
function fixture(body: unknown, status = 200) {
  const requests: CapturedRequest[] = [];
  const fetcher: IdentityFetch = async (url, init) => {
    requests.push({ url, init });
    return Response.json(body, { status });
  };
  return { client: createIdentityClient("https://zetta.example/base", fetcher), requests };
}

describe("identity client boundary", () => {
  test("status uses cookie credentials, no-store and the configured server origin", async () => {
    const { client, requests } = fixture({ state: "active", userId: "user-a", isAdmin: false });
    expect(await client.status()).toEqual({ state: "active", userId: "user-a", isAdmin: false });
    expect(requests[0]?.url.toString()).toBe("https://zetta.example/api/identity/status");
    expect(requests[0]?.init).toMatchObject({
      method: "GET",
      credentials: "include",
      cache: "no-store",
    });
  });

  test("anonymous and unenrolled states never infer membership", async () => {
    expect(await fixture({ state: "anonymous" }).client.status()).toEqual({ state: "anonymous" });
    expect(await fixture({ state: "unenrolled", userId: "user-b" }).client.status()).toEqual({
      state: "unenrolled",
      userId: "user-b",
    });
  });

  test("malformed or authority-bearing extra response fields fail closed", async () => {
    for (const body of [
      { state: "active", userId: "user-a" },
      { state: "active", userId: "user-a", isAdmin: "true" },
      { state: "anonymous", isAdmin: true },
      { state: "unknown" },
    ]) {
      await expect(fixture(body).client.status()).rejects.toMatchObject({
        code: "INVALID_RESPONSE",
      });
    }
  });

  test("acceptance sends only the token in JSON, never in the URL", async () => {
    const { client, requests } = fixture({ userId: "user-b" });
    await client.accept("synthetic-invitation");
    expect(requests[0]?.url.pathname).toBe("/api/identity/invitations/accept");
    expect(requests[0]?.url.search).toBe("");
    expect(requests[0]?.init).toMatchObject({
      method: "POST",
      credentials: "include",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ token: "synthetic-invitation" }),
    });
  });

  test("issuance validates expiry and sends intended account binding", async () => {
    const issued = {
      invitationId: "inv-a",
      token: "synthetic-once",
      expiresAt: "2026-10-23T12:00:00.000Z",
    };
    const { client, requests } = fixture(issued, 201);
    expect(
      await client.issue({ intendedEmail: "invitee@example.test", intendedUserId: "user-b" }),
    ).toEqual(issued);
    expect(JSON.parse(String(requests[0]?.init.body))).toEqual({
      intendedEmail: "invitee@example.test",
      intendedUserId: "user-b",
    });
    await expect(
      fixture({ ...issued, expiresAt: "tomorrow" }, 201).client.issue({
        intendedEmail: "invitee@example.test",
      }),
    ).rejects.toMatchObject({ code: "INVALID_RESPONSE" });
  });

  test("revocation uses only the displayed invitation ID", async () => {
    const { client, requests } = fixture({ invitationId: "inv-a" });
    expect(await client.revoke("inv-a")).toEqual({ invitationId: "inv-a" });
    expect(requests[0]?.init.body).toBe(JSON.stringify({ invitationId: "inv-a" }));
  });

  test("signup preserves invitationToken on the actual Better Auth endpoint", async () => {
    const { client, requests } = fixture({
      token: "synthetic-session",
      user: { id: "user-b", name: "Invitee" },
    });
    const input = {
      name: "Invitee",
      email: "invitee@example.test",
      password: "synthetic-password",
      invitationToken: "synthetic-invitation",
    };
    await client.signUp(input);
    expect(requests[0]?.url.pathname).toBe("/api/auth/sign-up/email");
    expect(JSON.parse(String(requests[0]?.init.body))).toEqual(input);
  });

  test("known error codes produce safe messages without reflecting server text", async () => {
    const { client } = fixture(
      { error: { code: "ENROLLMENT_UNAVAILABLE", message: "unsafe-echo-synthetic-token" } },
      409,
    );
    try {
      await client.accept("synthetic-invitation");
      throw new Error("Expected denial");
    } catch (failure) {
      expect(failure).toBeInstanceOf(IdentityRequestError);
      expect(getIdentityError(failure)).toContain("new invitation");
      expect(getIdentityError(failure)).not.toContain("unsafe-echo");
    }
  });

  test("network and unreadable response failures stay actionable and never retry mutations", async () => {
    let calls = 0;
    const fetcher: IdentityFetch = async () => {
      calls += 1;
      throw new Error("unsafe-network-detail");
    };
    const client = createIdentityClient("https://zetta.example", fetcher);
    await expect(client.issue({ intendedEmail: "invitee@example.test" })).rejects.toMatchObject({
      code: "IDENTITY_UNAVAILABLE",
    });
    expect(calls).toBe(1);
    const invalid = createIdentityClient(
      "https://zetta.example",
      async () => new Response("invalid json"),
    );
    await expect(invalid.status()).rejects.toMatchObject({ code: "INVALID_RESPONSE" });
  });
  test("deadline aborts a stalled injected fetch without retrying the mutation", async () => {
    let calls = 0;
    let capturedSignal: AbortSignal | null | undefined;
    const stalledFetch: IdentityFetch = async (_, init) => {
      calls += 1;
      capturedSignal = init.signal;
      return new Promise<Response>(() => {});
    };
    const client = createIdentityClient("https://zetta.example", stalledFetch, { timeoutMs: 5 });
    await expect(client.accept("synthetic-invitation")).rejects.toMatchObject({
      code: "IDENTITY_UNAVAILABLE",
    });
    expect(calls).toBe(1);
    expect(capturedSignal?.aborted).toBe(true);
  });

  test("deadline also bounds stalled response JSON parsing", async () => {
    class StalledBodyResponse extends Response {
      override json(): Promise<unknown> {
        return new Promise(() => {});
      }
    }
    let capturedSignal: AbortSignal | null | undefined;
    const stalledBody: IdentityFetch = async (_, init) => {
      capturedSignal = init.signal;
      return new StalledBodyResponse();
    };
    const client = createIdentityClient("https://zetta.example", stalledBody, { timeoutMs: 5 });
    await expect(client.status()).rejects.toMatchObject({ code: "IDENTITY_UNAVAILABLE" });
    expect(capturedSignal?.aborted).toBe(true);
  });
});
