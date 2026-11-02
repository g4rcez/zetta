import { expect, test } from "bun:test";
import { act } from "react";
import { createRoot } from "react-dom/client";

import { setupDom } from "../skills/dom-env";

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
      <ProposalsPanel
        proposals={[proposal as never]}
        bots={bots as never}
        notify={() => {}}
        onResolved={() => {}}
        onBotsChanged={() => {}}
      />,
    ),
  );
  return { host, unmount: () => act(async () => root.unmount()) };
};
const images = (host: HTMLElement) =>
  [...host.querySelectorAll("img")].map((i) => i.getAttribute("src"));

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

test("a wiki save request shows the bot that asks", async () => {
  const { host, unmount } = await render({
    id: "p2",
    kind: "create_wiki_page",
    botId: ASKER,
    proposedByBotId: ASKER,
    diff: [
      { field: "bot", from: null, to: "Treinador" },
      { field: "wiki", from: null, to: "Interview notes" },
    ],
    patch: {},
  });
  expect(host.textContent).toContain("suggests: Save to the wiki");
  expect(images(host)).toContain("/avatars/treinador.png");
  await unmount();
});
