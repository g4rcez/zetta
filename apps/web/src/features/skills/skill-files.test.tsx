import { afterEach, expect, test } from "bun:test";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act } from "react";
import { createRoot } from "react-dom/client";

import { setupDom } from "./dom-env";

const win = setupDom();
afterEach(() => {
  win.document.body.innerHTML = "";
});

const ID = "00000000-0000-7000-8000-0000000000a1";
const sent: { path: string; method: string; body: any }[] = [];
let refuse = false;
let files = [
  { path: "notes.md", size: 7, mode: "file" },
  { path: "logo.png", size: 5, mode: "file" },
];
globalThis.fetch = (async (input: URL | string, init?: RequestInit) => {
  const url = new URL(String(input));
  const path = `${url.pathname}${url.search}`;
  const method = init?.method ?? "GET";
  const body = init?.body ? JSON.parse(String(init.body)) : undefined;
  if (method !== "GET") sent.push({ path, method, body });
  if (path === `/api/skills/${ID}`) return Response.json({ skill: { id: ID, name: "s", files } });
  if (path === `/api/skills/${ID}/file?path=notes.md`)
    return Response.json({
      file: { path: "notes.md", mode: "file", size: 7, encoding: "utf8", content: "# notes" },
    });
  if (path === `/api/skills/${ID}/file?path=logo.png`)
    return Response.json({
      file: { path: "logo.png", mode: "file", size: 5, encoding: "base64", content: "iVBO" },
    });
  if (path === `/api/skills/${ID}/files` && method === "PUT") {
    if (refuse)
      return Response.json(
        { error: { code: "TOO_LARGE", message: "big.bin is larger than 1 MB." } },
        { status: 413 },
      );
    files = [
      ...files.filter((f) => !body.files.some((n: any) => n.path === f.path)),
      ...body.files.map((n: any) => ({
        path: n.path,
        size: n.content.length,
        mode: n.mode ?? "file",
      })),
    ];
    return Response.json({ files });
  }
  if (path === `/api/skills/${ID}/files/remove`) {
    files = files.filter((f) => !body.paths.includes(f.path));
    return Response.json({ files });
  }
  return Response.json(
    { error: { code: "TEST", message: `unexpected ${method} ${path}` } },
    { status: 500 },
  );
}) as typeof fetch;

const settle = () => act(async () => void (await new Promise((r) => setTimeout(r, 30))));
const text = () => win.document.body.textContent ?? "";
const buttons = () => [...win.document.querySelectorAll("button")];
const press = async (label: string, nth = 0) => {
  const b = buttons().filter((x) => x.textContent?.trim() === label)[nth];
  if (!b) throw new Error(`no button "${label}" in: ${text()}`);
  await act(async () => void b.dispatchEvent(new win.MouseEvent("click", { bubbles: true })));
  await settle();
};
const mount = async (owned: boolean) => {
  const { SkillFiles } = await import("./skill-files");
  let changed = 0;
  const host = win.document.createElement("div");
  win.document.body.append(host);
  const root = createRoot(host as unknown as Element);
  await act(async () =>
    root.render(
      <QueryClientProvider
        client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}
      >
        <SkillFiles id={ID} count={2} owned={owned} onChanged={() => void changed++} />
      </QueryClientProvider>,
    ),
  );
  await settle();
  await press("2 files next to SKILL.md");
  return { changed: () => changed, unmount: () => act(async () => root.unmount()) };
};

test("someone who does not own the skill can look at the files and nothing else", async () => {
  const { unmount } = await mount(false);
  expect(text()).toContain("notes.md");
  expect(buttons().some((b) => b.textContent === "Edit" || b.textContent === "Add a file")).toBe(
    false,
  );
  await unmount();
});

test("the owner removes a file after a question", async () => {
  sent.length = 0;
  const { changed, unmount } = await mount(true);
  await press("Remove", 0);
  expect(sent).toEqual([]);
  expect(text()).toContain("Remove notes.md?");
  await press("Yes, remove");
  expect(sent.at(-1)).toEqual({
    path: `/api/skills/${ID}/files/remove`,
    method: "POST",
    body: { paths: ["notes.md"] },
  });
  expect(changed()).toBe(1);
  await unmount();
});

test("a text file opens in the editor and a file that is not text says so", async () => {
  files = [
    { path: "notes.md", size: 7, mode: "file" },
    { path: "logo.png", size: 5, mode: "file" },
  ];
  const { unmount } = await mount(true);
  await press("Edit", 1);
  expect(text()).toContain("That file is not text. Remove it and add another.");
  expect(win.document.querySelector('form[aria-label="File"]')).toBeNull();
  await press("Edit", 0);
  const form = win.document.querySelector('form[aria-label="File"]')!;
  expect((form.querySelector("input") as unknown as HTMLInputElement).value).toBe("notes.md");
  expect((form.querySelector("input") as unknown as HTMLInputElement).disabled).toBe(true);
  await unmount();
});

test("a server refusal is shown next to the file and the editor stays open", async () => {
  sent.length = 0;
  refuse = true;
  files = [{ path: "notes.md", size: 7, mode: "file" }];
  const { changed, unmount } = await mount(true);
  await press("Add a file");
  const form = win.document.querySelector('form[aria-label="File"]')!;
  expect((form.querySelector("input") as unknown as HTMLInputElement).disabled).toBe(false);
  await act(
    async () =>
      void form.dispatchEvent(new win.Event("submit", { bubbles: true, cancelable: true })),
  );
  await settle();
  refuse = false;
  expect(sent.at(-1)?.method).toBe("PUT");
  expect(text()).toContain("big.bin is larger than 1 MB.");
  expect(win.document.querySelector('form[aria-label="File"]')).not.toBeNull();
  expect(changed()).toBe(0);
  await unmount();
});
