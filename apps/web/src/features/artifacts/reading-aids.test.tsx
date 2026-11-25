import { afterEach, expect, test } from "bun:test";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, useRef } from "react";
import { createRoot } from "react-dom/client";

import { setupDom } from "../skills/dom-env";
import type { Artifact } from "./artifacts-api";

const win = setupDom();
const { OutlineList, ReadingBody } = await import("./reading-aids");
const { useReading } = await import("./use-reading");

const artifact = (over: Partial<Artifact>): Artifact => ({
  id: "a1",
  title: "Guide",
  description: "",
  fileName: "guide.md",
  mimeType: "text/markdown",
  kind: "markdown",
  size: 100,
  botId: null,
  conversationId: null,
  routineRunId: null,
  pinnedAt: null,
  createdAt: "2026-11-25T12:00:00.000Z",
  ...over,
});

const serve = (body: string) => {
  let reads = 0;
  globalThis.fetch = (async () => {
    reads++;
    return new Response(body);
  }) as unknown as typeof fetch;
  return () => reads;
};

function Harness({ file }: { file: Artifact }) {
  const scroll = useRef<HTMLDivElement>(null);
  const reading = useReading(file, scroll);
  return (
    <div ref={scroll}>
      <p data-minutes="">{reading.minutes ?? "none"}</p>
      {reading.outline.items.length > 0 && <OutlineList outline={reading.outline} />}
      <ReadingBody artifact={file} outline={reading.outline} />
    </div>
  );
}

const roots: ReturnType<typeof createRoot>[] = [];
afterEach(async () => {
  await act(async () => roots.splice(0).forEach((r) => r.unmount()));
  win.document.body.replaceChildren();
});

async function mount(file: Artifact) {
  const host = win.document.createElement("div");
  win.document.body.append(host);
  const root = createRoot(host as never);
  roots.push(root);
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  await act(async () =>
    root.render(
      <QueryClientProvider client={client}>
        <Harness file={file} />
      </QueryClientProvider>,
    ),
  );
  for (let i = 0; i < 10; i++) await act(() => new Promise((done) => setTimeout(done, 10)));
  return host as unknown as HTMLElement;
}

const DOCUMENT = `---
title: Guide
---

# Guide

Intro text.

## Setup

Text.

## Setup

More.

### Detail

End.
`;

test("a Markdown document is a reading column with an outline of its headings, read once", async () => {
  const reads = serve(DOCUMENT);
  const host = await mount(artifact({}));
  expect(host.querySelector(".reading .chat-response")).not.toBeNull();
  expect(host.querySelector(".reading")!.className).not.toContain("border");
  expect(host.querySelector("[data-minutes]")!.textContent).toBe("1");
  const ids = [...host.querySelectorAll('.reading [data-streamdown^="heading-"]')].map((h) => h.id);
  expect(ids).toEqual(["doc-guide", "doc-setup", "doc-setup-2", "doc-detail"]);
  const items = [...host.querySelector('nav[aria-label="Outline"]')!.querySelectorAll("button")];
  expect(items.map((b) => b.textContent)).toEqual(["Guide", "Setup", "Setup", "Detail"]);
  expect(items[3]!.className).toContain("pl-8");
  expect(reads()).toBe(1);
});

test("the outline marks the heading the reader is under as the document scrolls", async () => {
  serve(DOCUMENT);
  const host = await mount(artifact({}));
  const view = host.firstElementChild as HTMLElement;
  // happy-dom lays nothing out: give each heading its place, 400px apart.
  let scrolled = 0;
  host.querySelectorAll<HTMLElement>('.reading [data-streamdown^="heading-"]').forEach((h, i) => {
    h.getBoundingClientRect = () => ({ top: i * 400 - scrolled }) as DOMRect;
  });
  const current = async (y: number) => {
    scrolled = y;
    await act(async () => {
      view.dispatchEvent(new win.Event("scroll") as unknown as Event);
      await new Promise((done) => setTimeout(done, 40));
    });
    return host.querySelector('nav[aria-label="Outline"] [aria-current="location"]')?.textContent;
  };
  expect(await current(0)).toBe("Guide");
  expect(await current(820)).toBe("Setup");
  expect(await current(1300)).toBe("Detail");
});

test("a jump moves the focus to the heading", async () => {
  serve(DOCUMENT);
  const host = await mount(artifact({}));
  const items = [...host.querySelector('nav[aria-label="Outline"]')!.querySelectorAll("button")];
  await act(async () => (items[3] as unknown as HTMLElement).click());
  expect((win.document.activeElement as unknown as HTMLElement).id).toBe("doc-detail");
});

test("two headings are not worth an outline", async () => {
  serve("# One\n\nText.\n\n## Two\n\nText.");
  const host = await mount(artifact({}));
  expect(host.querySelectorAll('.reading [data-streamdown^="heading-"]').length).toBe(2);
  expect(host.querySelector('nav[aria-label="Outline"]')).toBeNull();
});

test("a file that is not a document gets no reading time", async () => {
  serve("a,b\n1,2");
  const host = await mount(artifact({ kind: "csv", fileName: "table.csv" }));
  expect(host.querySelector("[data-minutes]")!.textContent).toBe("none");
});
