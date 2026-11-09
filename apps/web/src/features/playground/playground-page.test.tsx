import { expect, test } from "bun:test";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act } from "react";

import { setupDom } from "../skills/dom-env";

const win = setupDom();
// Loaded after the DOM exists: react-dom picks its way of reading text inputs when it loads.
const loadRoot = async () => (await import("react-dom/client")).createRoot;

const PG = "00000000-0000-7000-8000-0000000000b1";
const RUN = "00000000-0000-7000-8000-0000000000c1";
const calls: { path: string; method: string; body: unknown }[] = [];
const state = { mine: true, runner: "host" as "host" | "browser" };

const playground = () => ({
  id: PG,
  title: "Greeter",
  language: state.runner === "browser" ? "html" : "typescript",
  runner: state.runner,
  visibility: "private",
  ownerUserId: state.mine ? "me" : "someone",
  ownerName: state.mine ? "Me" : "Ada",
  createdByBotId: null,
  version: 3,
  createdAt: "2026-11-05T00:00:00Z",
  updatedAt: "2026-11-05T00:00:00Z",
  mine: state.mine,
  entry: state.runner === "browser" ? "index.html" : "main.ts",
  inputs: [{ name: "name", type: "string", default: "World" }],
  files:
    state.runner === "browser"
      ? [{ path: "index.html", content: "<p>hi</p>\n", size: 10 }]
      : [
          { path: "main.ts", content: 'console.log("hi")\n', size: 18 },
          { path: "lib/greet.ts", content: "export const greet = 1\n", size: 23 },
        ],
});
const summary = {
  id: RUN,
  playgroundId: PG,
  actorUserId: "me",
  botId: null,
  runner: "host",
  status: "ok",
  runtimeVersion: "1.3.14",
  entry: "main.ts",
  inputs: { name: "World" },
  exitCode: 0,
  output: "complete",
  durationMs: 120,
  startedAt: "2026-11-05T00:00:00Z",
  finishedAt: "2026-11-05T00:00:01Z",
};
const runs: (typeof summary)[] = [];

const api = (path: string, method: string, body: unknown) => {
  calls.push({ path, method, body });
  if (path === "/api/playgrounds/languages")
    return {
      languages: [
        {
          id: "typescript",
          label: "TypeScript",
          defaultEntry: "main.ts",
          runners: ["host", "container", "browser"],
          hostVersion: "1.3.14",
          container: false,
        },
        {
          id: "html",
          label: "HTML",
          defaultEntry: "index.html",
          runners: ["browser"],
          hostVersion: null,
          container: false,
        },
      ],
    };
  if (path === `/api/playgrounds/${PG}` && method === "GET") return { playground: playground() };
  if (path === `/api/playgrounds/${PG}/runs` && method === "GET") return { runs };
  if (path === `/api/playgrounds/${PG}/runs` && method === "POST") {
    runs.unshift(summary);
    return { run: summary };
  }
  if (path === `/api/playground-runs/${RUN}`)
    return { run: { ...summary, stdout: "hello World\n", stderr: "", files: [], outputs: [] } };
  if (path === `/api/playgrounds/${PG}` && method === "PATCH")
    return { playground: { ...playground(), version: 4 } };
  if (path === `/api/playgrounds/${PG}/build`) return { html: "<p>built page</p>" };
  if (path === "/api/apps/publish" && method === "POST")
    return {
      published: {
        app: { id: "app-1", slug: "greeter", name: "Greeter" },
        version: { id: "v1", n: 1 },
        created: true,
        changes: {
          added: ["greet"],
          removed: [],
          changed: [],
          accountsAdded: [],
          accountsRemoved: [],
        },
      },
    };
  throw new Error(`unexpected ${method} ${path}`);
};
globalThis.fetch = (async (input: URL | string, init?: RequestInit) => {
  const url = new URL(String(input));
  try {
    return Response.json(
      api(
        `${url.pathname}${url.search}`,
        init?.method ?? "GET",
        init?.body ? JSON.parse(String(init.body)) : undefined,
      ),
    );
  } catch (e) {
    return Response.json(
      { error: { code: "TEST", message: (e as Error).message } },
      { status: 500 },
    );
  }
}) as typeof fetch;

const settle = () => act(async () => void (await new Promise((r) => setTimeout(r, 30))));
const buttons = () => [...win.document.querySelectorAll("button")];
const named = (label: string) => buttons().find((x) => x.textContent?.trim() === label);
const press = async (label: string) => {
  const b = named(label);
  if (!b) throw new Error(`no button "${label}" in: ${win.document.body.textContent}`);
  await act(async () => void b.dispatchEvent(new win.MouseEvent("click", { bubbles: true })));
  await settle();
};
const text = () => win.document.body.textContent ?? "";

type Search = import("./playground-search").PlaygroundSearch;
/** The page in a stand-in for the router: the address is the state, and every change to it is recorded. */
const mount = async (initial: Search, onOpenApp?: (slug: string) => void) => {
  const { PlaygroundPage } = await import("./playground-page");
  const { withPlaygroundSearch } = await import("./playground-search");
  const { useState } = await import("react");
  const changes: Search[] = [];
  function Address() {
    const [search, setAddress] = useState<Search>(initial);
    return (
      <PlaygroundPage
        id={PG}
        search={search}
        setSearch={(patch) => {
          const next = withPlaygroundSearch(search, patch);
          changes.push(next);
          setAddress(next);
        }}
        onOpen={() => {}}
        onLeave={() => {}}
        {...(onOpenApp && { onOpenApp })}
      />
    );
  }
  const host = win.document.createElement("div");
  win.document.body.append(host);
  const root = (await loadRoot())(host as unknown as Element);
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  await act(async () =>
    root.render(
      <QueryClientProvider client={client}>
        <Address />
      </QueryClientProvider>,
    ),
  );
  await settle();
  return { changes, unmount: () => act(async () => root.unmount()) };
};

test("the address says which file is open: the page shows it with no click", async () => {
  state.mine = true;
  state.runner = "host";
  const { unmount } = await mount({ file: "lib/greet.ts" });

  expect(win.document.querySelector('[aria-label="Code of lib/greet.ts"]')).not.toBeNull();
  expect(win.document.querySelector('[aria-label="Code of main.ts"]')).toBeNull();
  const pressed = [...win.document.querySelectorAll('[role="group"][aria-label="Files"] button')]
    .filter((b) => b.getAttribute("aria-pressed") === "true")
    .map((b) => b.textContent);
  expect(pressed).toEqual(["lib/greet.ts"]);
  expect(text()).toContain("main.tsentry");
  await unmount();
});

test("Run starts a run of the saved files with the input defaults, then shows what it printed", async () => {
  calls.length = 0;
  runs.length = 0;
  const { changes, unmount } = await mount({});

  expect(text()).toContain("to see the result here.");
  await press("Run");

  expect(calls.find((c) => c.method === "POST")).toEqual({
    path: `/api/playgrounds/${PG}/runs`,
    method: "POST",
    body: { inputs: { name: "World" } },
  });
  // Nothing was edited, so nothing was saved.
  expect(calls.some((c) => c.method === "PATCH")).toBe(false);
  expect(changes).toEqual([{ run: RUN }]);
  expect(text()).toContain("hello World");
  expect(text()).toContain("Succeeded");
  await unmount();
});

test("a person who only has read access can run and fork, not edit", async () => {
  state.mine = false;
  const { unmount } = await mount({});

  expect(text()).toContain("Shared by Ada");
  expect(named("Save")).toBeUndefined();
  expect(named("Archive")).toBeUndefined();
  expect(named("Add file")).toBeUndefined();
  expect(named("Fork to edit")).toBeDefined();
  expect(named("Run")).toBeDefined();
  expect(
    win.document.querySelector('[aria-label="Code of main.ts"]')?.getAttribute("aria-disabled"),
  ).toBe("true");
  await unmount();
});

test("a browser playground builds a page and shows it in a sandboxed frame", async () => {
  state.mine = true;
  state.runner = "browser";
  calls.length = 0;
  const { unmount } = await mount({});

  await press("Preview");

  expect(calls.find((c) => c.path.endsWith("/build"))?.body).toEqual({
    files: [{ path: "index.html", content: "<p>hi</p>\n" }],
    entry: "index.html",
    inputs: { name: "World" },
  });
  const frame = win.document.querySelector("iframe");
  expect(frame?.getAttribute("srcdoc")).toBe("<p>built page</p>");
  expect(frame?.getAttribute("sandbox")).toBe("allow-scripts allow-popups");
  await unmount();
});

test("the owner can open a rename form for the open file; a viewer cannot", async () => {
  state.mine = true;
  state.runner = "host";
  const owner = await mount({ file: "lib/greet.ts" });
  expect(named("Rename lib/greet.ts")).toBeDefined();
  await press("Rename lib/greet.ts");
  expect(named("Cancel")).toBeDefined();
  await owner.unmount();

  state.mine = false;
  const viewer = await mount({});
  expect(named("Rename main.ts")).toBeUndefined();
  await viewer.unmount();
});

const key = async (init: { key: string; ctrlKey?: boolean; metaKey?: boolean }) =>
  act(
    async () =>
      void win.document.body.dispatchEvent(
        new win.KeyboardEvent("keydown", { bubbles: true, cancelable: true, ...init }) as never,
      ),
  );
const posts = () => calls.filter((c) => c.method === "POST" && c.path.endsWith("/runs"));

test("Ctrl+Enter, Cmd+Enter and F9 run the playground; Enter alone does not", async () => {
  state.mine = true;
  state.runner = "host";
  runs.length = 0;
  calls.length = 0;
  const { unmount } = await mount({});

  await key({ key: "Enter" });
  expect(posts()).toHaveLength(0);

  await key({ key: "Enter", ctrlKey: true });
  await settle();
  expect(posts()).toHaveLength(1);

  await key({ key: "Enter", metaKey: true });
  await settle();
  expect(posts()).toHaveLength(2);

  await key({ key: "F9" });
  await settle();
  expect(posts()).toHaveLength(3);
  expect(named("Run")?.getAttribute("aria-keyshortcuts")).toBe("Control+Enter Meta+Enter F9");
  await unmount();
});

test("the tab of the right panel is in the address: Inputs shows the fields with no click", async () => {
  state.mine = true;
  state.runner = "host";
  const { changes, unmount } = await mount({ panel: "inputs" });

  const field = win.document.querySelector(
    'input[aria-label="name"]',
  ) as unknown as HTMLInputElement;
  expect(field.value).toBe("World");
  expect(text()).toContain("inputs.json");
  await press("Output");
  expect(changes).toEqual([{}]);
  await unmount();
});

test("a value typed in the inputs goes to the run, and nothing is saved", async () => {
  state.mine = true;
  state.runner = "host";
  runs.length = 0;
  calls.length = 0;
  const { unmount } = await mount({ panel: "inputs" });

  const field = win.document.querySelector(
    'input[aria-label="name"]',
  ) as unknown as HTMLInputElement;
  Object.getOwnPropertyDescriptor(win.HTMLInputElement.prototype, "value")!.set!.call(field, "Ada");
  await act(
    async () => void field.dispatchEvent(new win.Event("input", { bubbles: true }) as never),
  );
  await press("Run");

  expect(posts()[0]?.body).toEqual({ inputs: { name: "Ada" } });
  expect(calls.some((c) => c.method === "PATCH")).toBe(false);
  await unmount();
});

const typeInto = async (el: HTMLInputElement, value: string) => {
  Object.getOwnPropertyDescriptor(win.HTMLInputElement.prototype, "value")!.set!.call(el, value);
  await act(async () => void el.dispatchEvent(new win.Event("input", { bubbles: true }) as never));
};
const submit = async (el: HTMLInputElement) => {
  await act(
    async () =>
      void el.form!.dispatchEvent(
        new win.Event("submit", { bubbles: true, cancelable: true }) as never,
      ),
  );
  await settle();
};

test("renaming the entry file keeps it as the entry, and Save sends the new path", async () => {
  state.mine = true;
  state.runner = "host";
  calls.length = 0;
  const { unmount } = await mount({});

  await press("Rename main.ts");
  const field = win.document.querySelector(
    'input[aria-label="New name of main.ts"]',
  ) as unknown as HTMLInputElement;
  await typeInto(field, "report.ts");
  await submit(field);

  const tabs = [
    ...win.document.querySelectorAll('[role="group"][aria-label="Files"] button[aria-pressed]'),
  ].map((b) => b.textContent);
  expect(tabs).toEqual(["report.tsentry", "lib/greet.ts"]);
  await press("Save");
  const sent = calls.find((c) => c.method === "PATCH");
  expect((sent!.body as { entry: string }).entry).toBe("report.ts");
  expect((sent!.body as { files: { path: string }[] }).files.map((f) => f.path)).toEqual([
    "report.ts",
    "lib/greet.ts",
  ]);
  await unmount();
});

test("a new file with a path the server would refuse says why and is not added", async () => {
  state.mine = true;
  state.runner = "host";
  const { unmount } = await mount({});

  await press("Add file");
  const field = win.document.querySelector(
    'input[aria-label="Path of the new file"]',
  ) as unknown as HTMLInputElement;
  await typeInto(field, "../secret.ts");
  await submit(field);

  expect(win.document.querySelector('[role="alert"]')?.textContent).toBe(
    "Use a relative path without `..`.",
  );
  expect(
    win.document.querySelectorAll('[role="group"][aria-label="Files"] button[aria-pressed]'),
  ).toHaveLength(2);
  await unmount();
});

test("Publish makes an app from the saved files, says what it added, and can open it", async () => {
  // A test above that failed before it unmounted leaves its page in the document: start clean.
  win.document.body.innerHTML = "";
  state.mine = true;
  state.runner = "host";
  const opened: string[] = [];
  const { unmount } = await mount({}, (slug) => opened.push(slug));
  expect(named("Publish")?.hasAttribute("disabled")).toBe(false);
  await press("Publish");
  expect(calls.at(-1)).toEqual({
    path: "/api/apps/publish",
    method: "POST",
    body: { playgroundId: PG },
  });
  expect(text()).toContain("Published Greeter as apps.greeter, version 1");
  expect(text()).toContain("New tools: greet");
  await press("Open the app");
  expect(opened).toEqual(["greeter"]);
  await unmount();
});

test("a person who cannot edit, and a page that runs in the browser, have no Publish", async () => {
  win.document.body.innerHTML = "";
  state.mine = false;
  state.runner = "host";
  const viewer = await mount({});
  expect(named("Publish")).toBeUndefined();
  await viewer.unmount();
  win.document.body.innerHTML = "";
  state.mine = true;
  state.runner = "browser";
  const page = await mount({});
  expect(named("Publish")).toBeUndefined();
  await page.unmount();
  state.runner = "host";
});
