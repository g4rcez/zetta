import { afterEach, expect, test } from "bun:test";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act } from "react";
import { createRoot } from "react-dom/client";

import { setupDom } from "../skills/dom-env";
import type { Artifact } from "./artifacts-api";

const win = setupDom();
const { ArtifactViewer, entryImageUrl } = await import("./viewers");

const artifact = (over: Partial<Artifact>): Artifact => ({
  id: "a1",
  title: "Drawing",
  description: "",
  fileName: "drawing.svg",
  mimeType: "image/svg+xml",
  kind: "image",
  size: 100,
  botId: null,
  conversationId: null,
  routineRunId: null,
  pinnedAt: null,
  createdAt: "2026-11-25T12:00:00.000Z",
  ...over,
});

const made: string[] = [];
const create = URL.createObjectURL;
const roots: ReturnType<typeof createRoot>[] = [];
afterEach(async () => {
  await act(async () => roots.splice(0).forEach((r) => r.unmount()));
  win.document.body.replaceChildren();
  URL.createObjectURL = create;
  made.length = 0;
});

// A blob address belongs to the app's origin: a script inside an SVG opened from one would run as the person.
test("an SVG artifact is shown from the server's sandboxed address, never from a blob", async () => {
  URL.createObjectURL = (b) => {
    made.push((b as Blob).type);
    return "blob:test";
  };
  globalThis.fetch = (async () =>
    new Response("<svg/>", {
      headers: { "content-type": "image/svg+xml" },
    })) as unknown as typeof fetch;
  const host = win.document.createElement("div");
  win.document.body.append(host);
  const root = createRoot(host as never);
  roots.push(root);
  await act(async () => {
    root.render(
      <QueryClientProvider client={new QueryClient()}>
        <ArtifactViewer a={artifact({})} />
      </QueryClientProvider>,
    );
    await new Promise((r) => setTimeout(r, 20));
  });
  const src = win.document.querySelector("img")?.getAttribute("src") ?? "";
  expect(src).toContain("/api/artifacts/a1/content");
  expect(made).toEqual([]);
});

test("an image inside a zip gets a type that cannot run on the app's origin", () => {
  const types: string[] = [];
  URL.createObjectURL = (b) => {
    types.push((b as Blob).type);
    return "blob:test";
  };
  const bytes = new TextEncoder().encode('<svg xmlns="http://www.w3.org/2000/svg"/>');
  expect(entryImageUrl("a/b.svg", bytes).startsWith("data:image/svg+xml")).toBe(true);
  entryImageUrl("a/b.PNG", bytes);
  entryImageUrl("a/b.jpg", bytes);
  expect(types).toEqual(["image/png", "image/jpeg"]);
});
