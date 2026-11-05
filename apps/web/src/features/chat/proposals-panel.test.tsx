import { expect, test } from "bun:test";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act } from "react";
import { createRoot } from "react-dom/client";

import { setupDom } from "../skills/dom-env";

const withQuery = (element: unknown) => (
  <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
    {element as never}
  </QueryClientProvider>
);

const win = setupDom();

const ASKER = "01a19da2-3c92-783a-b90d-c35975f3c60c";
const TARGET = "01a19cdc-1326-7da2-928e-99a8c7b1b22f";
const bots = [
  {
    id: ASKER,
    name: "Treinador",
    kind: "specialist",
    avatar: { kind: "image", src: "/avatars/treinador.png" },
  },
  {
    id: TARGET,
    name: "Zetta",
    kind: "chief",
    avatar: { kind: "image", src: "/avatars/zetta.png" },
  },
];
const render = async (proposal: object) => {
  const { ProposalsPanel } = await import("./proposals-panel");
  const host = win.document.createElement("div");
  win.document.body.append(host);
  const root = createRoot(host as unknown as Element);
  await act(async () =>
    root.render(
      withQuery(
        <ProposalsPanel
          proposals={[proposal as never]}
          bots={bots as never}
          notify={() => {}}
          onResolved={() => {}}
          onBotsChanged={() => {}}
        />,
      ),
    ),
  );
  return { host, unmount: () => act(async () => root.unmount()) };
};
// happy-dom elements are not the `lib.dom` types the app is compiled with.
const images = (host: unknown) =>
  [...(host as HTMLElement).querySelectorAll("img")].map((i) => i.getAttribute("src"));

test("a permission request shows the bot that asks, and the bot it is about, with their avatars", async () => {
  const { host, unmount } = await render({
    id: "p1",
    kind: "bot_permission",
    botId: TARGET,
    proposedByBotId: ASKER,
    diff: [
      { field: "bot", from: null, to: "Zetta" },
      { field: "allow", from: null, to: "Bash(git push)" },
    ],
  });
  expect(host.textContent).toContain("Treinador");
  expect(host.textContent).toContain("suggests: Change what a bot may do");
  expect(host.textContent).toContain("Zetta");
  expect(images(host)).toEqual(["/avatars/treinador.png", "/avatars/zetta.png"]);
  await unmount();
});

test("a memory save request shows the bot that asks", async () => {
  const { host, unmount } = await render({
    id: "p2",
    kind: "create_memory_item",
    botId: ASKER,
    proposedByBotId: ASKER,
    diff: [
      { field: "bot", from: null, to: "Treinador" },
      { field: "memory", from: null, to: "Interview notes" },
    ],
    patch: {},
  });
  expect(host.textContent).toContain("suggests: Save to memory");
  expect(images(host)).toContain("/avatars/treinador.png");
  await unmount();
});

test("a change the chief asks for says what it is, shows each old and new value, and offers Approve", async () => {
  const { host, unmount } = await render({
    id: "p3",
    kind: "chief_action",
    botId: null,
    proposedByBotId: TARGET,
    diff: [
      { field: "bot", from: null, to: "Treinador" },
      { field: "computerMode", from: "off", to: "browser" },
      { field: "add member", from: null, to: "Editor (Reviewer)" },
      { field: "add member", from: null, to: "Writer" },
    ],
    patch: { title: "Change Treinador" },
  });
  expect(host.textContent).toContain("suggests: Change Treinador");
  expect(host.textContent).toContain("Computer: off → browser");
  expect(host.textContent).toContain("Add member: Editor (Reviewer)");
  expect(host.textContent).toContain("Add member: Writer");
  expect(host.textContent).not.toContain("Approve and create");
  expect([...host.querySelectorAll("button")].map((b) => b.textContent)).toEqual([
    "Reject",
    "Approve",
  ]);
  await unmount();
});
