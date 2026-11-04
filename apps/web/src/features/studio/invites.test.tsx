import { expect, test } from "bun:test";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act } from "react";
import { createRoot } from "react-dom/client";

import { setupDom } from "../skills/dom-env";

const win = setupDom();
Object.assign(globalThis, { scrollTo: () => {} });

const posts: { path: string; body: unknown }[] = [];
let pending = [
  {
    invitationId: "inv-1",
    intendedEmail: "ana@example.invalid",
    createdAt: "2030-01-01T00:00:00.000Z",
    expiresAt: "2030-01-02T00:00:00.000Z",
  },
];
globalThis.fetch = (async (input: URL | string, init?: RequestInit) => {
  const url = new URL(String(input));
  if (init?.method === "POST") {
    posts.push({ path: url.pathname, body: JSON.parse(String(init.body)) });
    pending = [];
    return Response.json({ invitationId: "inv-1" });
  }
  if (url.pathname === "/api/identity/invitations") return Response.json({ invitations: pending });
  if (url.pathname === "/api/teams") return Response.json({ teams: [] });
  return Response.json({ error: { code: "TEST", message: url.pathname } }, { status: 500 });
}) as typeof fetch;

const settle = () => act(async () => void (await new Promise((r) => setTimeout(r, 80))));

async function mount(isAdmin: boolean) {
  const { Invites } = await import("./invites");
  const host = win.document.createElement("div") as unknown as Element;
  (win.document.body as unknown as Element).append(host);
  const root = createRoot(host);
  await act(async () =>
    root.render(
      <QueryClientProvider
        client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}
      >
        <Invites isAdmin={isAdmin} />
      </QueryClientProvider>,
    ),
  );
  await settle();
  return { host, root };
}
const button = (host: Element, text: string) =>
  [...host.querySelectorAll("button")].find((b) => b.textContent === text) as HTMLElement;

test("the administrator sees a pending invitation and can revoke it", async () => {
  const { host, root } = await mount(true);
  expect(host.textContent).toContain("ana@example.invalid");

  await act(async () => button(host, "Revoke").click());
  await act(async () => button(host, "Revoke invitation").click());
  await settle();

  expect(posts).toEqual([
    { path: "/api/identity/invitations/revoke", body: { invitationId: "inv-1" } },
  ]);
  expect(host.textContent).toContain("No pending invitations.");
  await act(async () => root.unmount());
});

test("someone who is not the administrator cannot invite", async () => {
  const { host, root } = await mount(false);
  expect(host.textContent).toContain("Only the administrator of this server can invite people.");
  expect(host.querySelector("form")).toBeNull();
  await act(async () => root.unmount());
});
