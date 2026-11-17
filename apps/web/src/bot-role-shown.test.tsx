import { afterEach, expect, test } from "bun:test";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act } from "react";
import { createRoot } from "react-dom/client";

import { setupDom } from "./features/skills/dom-env";

// Where a bot is shown without a picker (the `@` list, an organization seat, the rooms a bot may open), its role is on the row.
const win = setupDom();
(globalThis as { fetch: unknown }).fetch = async (input: URL | string) => {
  const path = new URL(String(input)).pathname;
  if (path.endsWith("/peers")) return Response.json({ peers: [] });
  return Response.json({ error: { code: "TEST", message: path } }, { status: 500 });
};

const { MentionPopup } = await import("./features/chat/mention");
const { SeatHolder } = await import("./features/org/org-bits");
const { BotPeersSection } = await import("./features/discussions/bot-peers-section");

const ANA = "00000000-0000-7000-8000-0000000000a1";
const BEN = "00000000-0000-7000-8000-0000000000a2";
const bots = [
  { id: ANA, name: "Ana Souza", kind: "specialist", role: "Support lead", description: "x" },
  {
    id: BEN,
    name: "Ben",
    kind: "specialist",
    role: "",
    description: "Writes the weekly report\nmore",
  },
] as never[];

const roots: { unmount: () => void }[] = [];
afterEach(async () => {
  await act(async () => roots.splice(0).forEach((r) => r.unmount()));
  win.document.body.replaceChildren();
});

async function mount(node: React.ReactNode) {
  const host = win.document.createElement("div");
  win.document.body.append(host);
  const root = createRoot(host as unknown as Element);
  roots.push(root);
  await act(async () =>
    root.render(
      <QueryClientProvider
        client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}
      >
        {node}
      </QueryClientProvider>,
    ),
  );
  await act(async () => void (await new Promise((r) => setTimeout(r, 30))));
  return host as unknown as Element;
}

test("the @ list shows each bot's role under its name and keeps the @Key hint", async () => {
  const host = await mount(
    <MentionPopup
      placement="below"
      mention={{
        state: { char: "@", query: "", at: 0, index: 1 },
        candidates: bots,
        pick: () => {},
      }}
    />,
  );
  const rows = [...host.querySelectorAll('[role="option"]')];
  expect(rows).toHaveLength(2);
  expect(rows[0]!.textContent).toContain("Ana Souza");
  expect(rows[0]!.textContent).toContain("@AnaSouza");
  expect(rows[0]!.textContent).toContain("Support lead");
  // No role written: the first line of the description.
  expect(rows[1]!.textContent).toContain("Writes the weekly report");
  expect(rows[1]!.textContent).not.toContain("more");
  // The highlighted row is still the one the keyboard is on.
  expect(rows.map((r) => r.getAttribute("aria-selected"))).toEqual(["false", "true"]);
});

test("the # list names a team or a room and has no role line", async () => {
  const host = await mount(
    <MentionPopup
      placement="below"
      mention={{
        state: { char: "#", query: "", at: 0, index: 0 },
        candidates: [{ id: "t1", name: "Launch", kind: "team" }] as never[],
        pick: () => {},
      }}
    />,
  );
  expect(host.querySelector('[role="option"]')!.textContent).toBe("Launch#Launch");
});

test("a seat held by a bot shows the bot's role under its name", async () => {
  const host = await mount(
    <SeatHolder
      item={{
        problem: null,
        holder: {
          kind: "bot",
          botId: ANA,
          name: "Ana Souza",
          description: "x",
          role: "Support lead",
          avatar: null,
        },
      }}
    />,
  );
  expect(host.textContent).toContain("Ana Souza");
  expect(host.textContent).toContain("Support lead");
});

test("a bot in a seat with no role shows the first line of its description", async () => {
  const host = await mount(
    <SeatHolder
      item={{
        problem: null,
        holder: {
          kind: "bot",
          botId: BEN,
          name: "Ben",
          description: "Writes the weekly report\nmore",
          avatar: null,
        },
      }}
    />,
  );
  expect(host.textContent).toContain("Writes the weekly report");
});

test("a person in a seat is unchanged: no role line", async () => {
  const host = await mount(
    <SeatHolder
      item={{
        problem: null,
        holder: { kind: "person", userId: "u1", name: "Rui Lima", avatar: null },
      }}
    />,
  );
  expect(host.textContent).toContain("Rui Lima");
  expect(host.textContent).not.toContain("Specialist");
});

test("the rooms a bot may open list the other bots with their role", async () => {
  const host = await mount(
    <BotPeersSection
      bot={{ id: "00000000-0000-7000-8000-0000000000a9", name: "Me" } as never}
      bots={bots.map((b) => ({ ...(b as object), onboarded: true, codeAccess: false })) as never}
    />,
  );
  const rows = [...host.querySelectorAll("li")].map((li) => li.textContent);
  expect(rows[0]).toContain("Ana Souza");
  expect(rows[0]).toContain("Support lead");
  expect(rows[1]).toContain("Writes the weekly report");
});
