import { expect, test } from "bun:test";
import { act } from "react";
import { createRoot } from "react-dom/client";

import { setupDom } from "./dom-env";

const win = setupDom();

const SHA = "1234567890abcdef1234567890abcdef12345678";
const offer = (trust: "official" | "trusted" | null) => ({
  repo: "acme/skills",
  ref: SHA,
  trust,
  preselected: ["skills/interview-me/SKILL.md"],
  skills: [
    {
      name: "pdf",
      path: "skills/pdf/SKILL.md",
      description: "Make PDFs",
      warnings: [],
      installed: false,
    },
    {
      name: "interview-me",
      path: "skills/interview-me/SKILL.md",
      description: "Interview the user",
      warnings: [],
      installed: false,
    },
    {
      name: "old",
      path: "skills/old/SKILL.md",
      description: "Already here",
      warnings: [],
      installed: true,
    },
    {
      name: "unsafe",
      path: "skills/unsafe/SKILL.md",
      description: "Bad",
      warnings: ["shell_injection"],
      installed: false,
    },
  ],
});

const render = async (trust: "official" | "trusted" | null) => {
  const { SkillsInstallCard } = await import("./skills-install-card");
  const decisions: unknown[][] = [];
  const host = win.document.createElement("div");
  win.document.body.append(host);
  const root = createRoot(host as unknown as Element);
  await act(async () =>
    root.render(
      <SkillsInstallCard
        offer={offer(trust) as never}
        busy={false}
        onDecide={(...args) => void decisions.push(args)}
      />,
    ),
  );
  const buttons = () => [...host.querySelectorAll("button")];
  const press = async (label: string) => {
    const b = buttons().find((x) => x.textContent?.trim() === label);
    if (!b) throw new Error(`no button "${label}" in: ${host.textContent}`);
    await act(
      async () => void b.dispatchEvent(new win.MouseEvent("click", { bubbles: true }) as never),
    );
  };
  return { host, decisions, buttons, press, unmount: () => act(async () => root.unmount()) };
};

test("the card shows the repository, its trust, what the bot ticked, and why some skills cannot be chosen", async () => {
  const { host, buttons, unmount } = await render("trusted");
  expect(host.textContent).toContain("Install skills?");
  expect(host.textContent).toContain("acme/skills · 1234567");
  expect(host.textContent).toContain("Trusted");
  expect(host.textContent).toContain("4 skills");
  expect(host.textContent).toContain(
    "Bots follow a skill's instructions, so only install ones you trust.",
  );
  expect(buttons().some((b) => b.textContent?.trim() === "Install 1 skill")).toBe(true);
  expect(host.textContent).toContain("It runs shell commands when it loads");
  const box = (name: string) =>
    host.querySelector(`input[aria-label="${name}"]`) as unknown as HTMLInputElement;
  expect(box("interview-me").checked).toBe(true);
  expect(box("unsafe").disabled).toBe(true);
  expect(box("old").disabled).toBe(false);
  await unmount();
});

test("Install sends only the ticked skills and who gets them; Not now sends no choice", async () => {
  const { decisions, press, unmount } = await render(null);
  await press("All bots");
  await press("Install 1 skill");
  expect(decisions).toEqual([[true, { paths: ["skills/interview-me/SKILL.md"], target: "all" }]]);
  await press("Not now");
  expect(decisions.at(-1)).toEqual([false]);
  await unmount();
});

test("a skill the person already has can be chosen to give it to more bots", async () => {
  const { host, decisions, buttons, press, unmount } = await render("trusted");
  const box = (name: string) =>
    host.querySelector(`input[aria-label="${name}"]`) as unknown as HTMLInputElement;
  const click = async (el: HTMLInputElement) =>
    act(async () => void el.dispatchEvent(new win.MouseEvent("click", { bubbles: true }) as never));
  await click(box("interview-me"));
  await click(box("old"));
  expect(buttons().some((b) => b.textContent?.trim() === "Add 1 skill to this bot")).toBe(true);
  await press("All bots");
  await press("Add 1 skill to all bots");
  expect(decisions).toEqual([[true, { paths: ["skills/old/SKILL.md"], target: "all" }]]);
  await unmount();
});

test("a repository that is not on the trusted list is marked", async () => {
  const { host, unmount } = await render(null);
  expect(host.textContent).toContain("Not on the trusted list");
  await unmount();
});
