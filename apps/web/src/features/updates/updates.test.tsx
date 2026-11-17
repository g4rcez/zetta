import { expect, test } from "bun:test";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, type ReactNode } from "react";
import { createRoot } from "react-dom/client";

import { setupDom } from "../skills/dom-env";
import type { VersionStatus } from "./updates-api";

const win = setupDom();
Object.assign(globalThis, { scrollTo: () => {} });

const BEHIND: VersionStatus = {
  build: { commit: "54121d6abcde", date: "2026-11-10T12:00:00.000Z" },
  state: "behind",
  latest: { date: "2026-11-12" },
  changes: [
    {
      day: "2026-11-12",
      type: "feat",
      scope: "chat",
      subject: "polls that people vote on",
      sha: "bffe149",
    },
    {
      day: "2026-11-12",
      type: "fix",
      scope: "web",
      subject: "reply reference above the author",
      sha: "0bbea9a",
    },
    { day: "2026-11-11", type: "perf", scope: "", subject: "faster room list", sha: "a34eee8" },
  ],
  checkedAt: "2026-11-16T00:00:00.000Z",
  check: "on",
};
let version: VersionStatus = BEHIND;
let admin = true;
let installation = { updateCheck: "on" };
const requests: string[] = [];
const patches: unknown[] = [];
globalThis.fetch = (async (input: URL | Request | string, init?: RequestInit) => {
  const url = new URL(input instanceof Request ? input.url : String(input));
  requests.push(`${init?.method ?? "GET"} ${url.pathname}`);
  if (url.pathname === "/api/identity/status")
    return Response.json({ state: "active", userId: "u1", isAdmin: admin });
  if (url.pathname === "/api/installation/version") return Response.json(version);
  if (url.pathname === "/api/installation" && init?.method === "PATCH") {
    patches.push(JSON.parse(String(init.body)));
    installation = { ...installation, ...JSON.parse(String(init.body)) };
    return Response.json(installation);
  }
  if (url.pathname === "/api/installation") return Response.json(installation);
  return Response.json(
    { error: { code: "TEST", message: `unexpected ${url.pathname}` } },
    { status: 500 },
  );
}) as typeof fetch;

const settle = (ms = 60) => act(async () => void (await new Promise((r) => setTimeout(r, ms))));
const text = () => win.document.body.textContent ?? "";

async function mount(ui: ReactNode) {
  requests.length = 0;
  patches.length = 0;
  const { createMemoryHistory, createRootRoute, createRouter, RouterProvider } =
    await import("@tanstack/react-router");
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const router = createRouter({
    routeTree: createRootRoute({
      component: () => <QueryClientProvider client={client}>{ui}</QueryClientProvider>,
    }),
    history: createMemoryHistory({ initialEntries: ["/"] }),
  });
  await router.load();
  const host = win.document.createElement("div");
  win.document.body.replaceChildren(host);
  await act(async () =>
    createRoot(host as unknown as Element).render(<RouterProvider router={router} />),
  );
  await settle();
  return host;
}
const reset = (over: Partial<VersionStatus> = {}, isAdmin = true) => {
  version = { ...BEHIND, ...over };
  admin = isAdmin;
  installation = { updateCheck: "on" };
};

test("the version line names the commit and the day of the build", async () => {
  reset();
  const { VersionLine } = await import("./version-line");
  await mount(<VersionLine />);
  expect(text()).toBe("Version 54121d6 · 2026-11-10");
});

test("a build without a stamp reads as an unknown version, and the line is silent when the server cannot answer", async () => {
  reset({ build: null, state: "unknown", latest: null, changes: [] });
  const { VersionLine } = await import("./version-line");
  await mount(<VersionLine />);
  expect(text()).toBe("Version unknown");
});

test("the administrator sees a quiet Update available link while the check says behind", async () => {
  reset();
  const { UpdateMark } = await import("./update-mark");
  const host = await mount(<UpdateMark collapsed={false} />);
  const link = host.querySelector("a")!;
  expect(link.getAttribute("href")).toBe("/update");
  expect(link.textContent).toBe("Update available");
});

test("collapsed, the mark keeps its name for assistive technology", async () => {
  reset();
  const { UpdateMark } = await import("./update-mark");
  const host = await mount(<UpdateMark collapsed />);
  expect(host.querySelector("a")?.getAttribute("aria-label")).toBe("Update available");
});

test("nothing shows when the build is current or the state is unknown", async () => {
  const { UpdateMark } = await import("./update-mark");
  reset({ state: "current", changes: [] });
  expect((await mount(<UpdateMark collapsed={false} />)).querySelector("a")).toBeNull();
  reset({ state: "unknown", latest: null, changes: [] });
  expect((await mount(<UpdateMark collapsed={false} />)).querySelector("a")).toBeNull();
});

test("a member sees nothing and the page never asks the version endpoint on their behalf", async () => {
  reset({}, false);
  const { UpdateMark } = await import("./update-mark");
  const host = await mount(<UpdateMark collapsed={false} />);
  expect(host.querySelector("a")).toBeNull();
  expect(requests).not.toContain("GET /api/installation/version");
});

test("the Update page lists the changes since the build by day, and the one command with a copy button", async () => {
  reset();
  const copied: string[] = [];
  Object.defineProperty(win.navigator, "clipboard", {
    configurable: true,
    value: { writeText: async (t: string) => void copied.push(t) },
  });
  const { UpdatePage } = await import("./update-page");
  const host = await mount(<UpdatePage />);
  const t = text();
  expect(t).toContain("Version 54121d6 · 2026-11-10");
  expect(t).toContain("A newer version is available");
  expect(t).toContain("2026-11-12");
  expect(t).toContain("polls that people vote on");
  expect(t).toContain("Fixed (web): reply reference above the author");
  expect(t).toContain("Faster: faster room list");
  expect(host.querySelectorAll('section[aria-label^="2026-"]')).toHaveLength(2);
  const command = host.querySelector('code[aria-label="Update command"]')!;
  expect(command.textContent).toBe("curl -fsSL https://zettabot.app/install | bash");
  const copy = [...host.querySelectorAll("button")].find((b) => b.textContent === "Copy")!;
  await act(
    async () => void copy.dispatchEvent(new win.MouseEvent("click", { bubbles: true }) as never),
  );
  await settle();
  expect(copied).toEqual(["curl -fsSL https://zettabot.app/install | bash"]);
});

test("a current build says so and still shows the command", async () => {
  reset({ state: "current", changes: [] });
  const { UpdatePage } = await import("./update-page");
  await mount(<UpdatePage />);
  expect(text()).toContain("You are up to date.");
  expect(text()).not.toContain("What changed since your version");
});

test("an unknown state says why: the check is off, or the build has no stamp", async () => {
  const { UpdatePage } = await import("./update-page");
  reset({ state: "unknown", latest: null, changes: [], check: "off" });
  await mount(<UpdatePage />);
  expect(text()).toContain("The update check is off");
  reset({ build: null, state: "unknown", latest: null, changes: [] });
  await mount(<UpdatePage />);
  expect(text()).toContain("carries no version stamp");
});

test("a member who opens the page is told it is for the administrator", async () => {
  reset({}, false);
  const { UpdatePage } = await import("./update-page");
  await mount(<UpdatePage />);
  expect(text()).toContain("Only the administrator can update this installation.");
  expect(text()).not.toContain("curl");
});

test("the Check for updates setting saves at once, for the administrator only", async () => {
  reset();
  const { UpdateCheckSetting } = await import("../studio/update-check-setting");
  const host = await mount(<UpdateCheckSetting onError={() => {}} />);
  const box = host.querySelector('input[type="checkbox"]') as unknown as HTMLInputElement;
  expect(box.checked).toBe(true);
  expect(box.disabled).toBe(false);
  await act(
    async () => void box.dispatchEvent(new win.MouseEvent("click", { bubbles: true }) as never),
  );
  await settle();
  expect(patches).toEqual([{ updateCheck: "off" }]);
  expect(text()).toContain("Check for updates");
  expect(text()).toContain("carries nothing about this installation");

  reset({}, false);
  const asMember = await mount(<UpdateCheckSetting onError={() => {}} />);
  expect(
    (asMember.querySelector('input[type="checkbox"]') as unknown as HTMLInputElement).disabled,
  ).toBe(true);
});

test("the setting says when the operator turned the check off for the whole server", async () => {
  reset({ state: "unknown", latest: null, changes: [], check: "off" });
  const { UpdateCheckSetting } = await import("../studio/update-check-setting");
  await mount(<UpdateCheckSetting onError={() => {}} />);
  expect(text()).toContain("turned the check off for the whole server");
});

test("the Catch up card of an update says See the update and leads to the Update page, with no second link", async () => {
  const { DecisionCard } = await import("../catch-up/catch-up-card");
  const { ACTIONS } = await import("@zetta/core/attention-kinds");
  const host = await mount(
    <DecisionCard
      card={{
        key: "card:1",
        source: "card",
        id: "1",
        kind: "update_available",
        subjectId: null,
        botId: null,
        title: "A new version of Zetta is available",
        detail: "Changes were published up to 2026-11-12.",
        nextAction: "Open the update page.",
        resultLink: "/update",
        occurrences: 1,
        createdAt: "2026-11-16T00:00:00.000Z",
        context: {},
        actions: ACTIONS.update_available,
      }}
      bot={undefined}
      bots={[]}
      busy={false}
      error={undefined}
      isAdmin
      onAct={() => {}}
      onDeny={() => {}}
      onChanged={() => {}}
      onRecheck={() => {}}
      onSkip={undefined}
    />,
  );
  const labels = [...host.querySelectorAll("button")].map((b) => b.textContent);
  expect(labels.some((l) => l?.startsWith("See the update"))).toBe(true);
  expect(labels.some((l) => l?.startsWith("Dismiss"))).toBe(true);
  expect(host.querySelector("a")).toBeNull();
});
