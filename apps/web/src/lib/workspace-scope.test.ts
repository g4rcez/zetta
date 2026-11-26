import { afterEach, expect, test } from "bun:test";

import {
  installWorkspaceScope,
  WORKSPACE_HEADER,
  withWorkspace,
  workspaceOf,
  workspaceScope,
} from "./workspace-scope";

const API = "https://zetta.example.invalid";
type Seen = { url: string; header: string | null };

function fakeTarget() {
  const seen: Seen[] = [];
  const target = {
    fetch: (async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
      const headers = new Headers(
        init?.headers ?? (input instanceof Request ? input.headers : undefined),
      );
      seen.push({ url, header: headers.get(WORKSPACE_HEADER) });
      return new Response("{}");
    }) as typeof fetch,
  };
  installWorkspaceScope(API, target);
  return { target, seen };
}

afterEach(() => void workspaceScope.set(undefined));

test("a tab with no workspace in its address sends none: the server works in the person's own", async () => {
  const { target, seen } = fakeTarget();
  await target.fetch(`${API}/api/bots`);
  expect(seen).toEqual([{ url: `${API}/api/bots`, header: null }]);
});

test("every call to the server's API says which workspace the tab works in, and nothing else does", async () => {
  const { target, seen } = fakeTarget();
  workspaceScope.set("acme");
  await target.fetch(`${API}/api/bots`);
  await target.fetch(new URL("/api/workspace/all", API), { method: "POST", body: "{}" });
  await target.fetch(
    new Request(`${API}/api/chats`, { headers: { "Content-Type": "application/json" } }),
  );
  // Not the server's API: another site, or the server's own page assets.
  await target.fetch("https://elsewhere.example.invalid/api/bots");
  await target.fetch(`${API}/assets/logo.svg`);
  expect(seen.map((s) => s.header)).toEqual(["acme", "acme", "acme", null, null]);
  // A call that names a workspace itself keeps it.
  await target.fetch(`${API}/api/bots`, { headers: { [WORKSPACE_HEADER]: "other" } });
  expect(seen.at(-1)!.header).toBe("other");
});

test("only a workspace slug is taken from the address, and a change is noticed once", () => {
  expect(workspaceOf("?w=acme")).toBe("acme");
  expect(workspaceOf("?w=Acme Corp")).toBeUndefined();
  expect(workspaceOf("?w=../x")).toBeUndefined();
  expect(workspaceOf("?q=1")).toBeUndefined();
  expect(workspaceScope.set("acme")).toBe(true);
  expect(workspaceScope.set("acme")).toBe(false);
  expect(workspaceScope.set("not a slug")).toBe(true);
  expect(workspaceScope.get()).toBeUndefined();
});

test("what cannot carry a header carries the workspace in its address", () => {
  expect(withWorkspace(new URL(`${API}/api/events`)).href).toBe(`${API}/api/events`);
  workspaceScope.set("acme");
  expect(withWorkspace(new URL(`${API}/api/steps/1/output?from=0`)).href).toBe(
    `${API}/api/steps/1/output?from=0&w=acme`,
  );
});
