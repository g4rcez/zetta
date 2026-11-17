import { afterEach, expect, spyOn, test } from "bun:test";
import { act } from "react";
import { createRoot } from "react-dom/client";

import { setupDom } from "../skills/dom-env";

const win = setupDom();
const { chatClient } = await import("./chat-client");
const { mergeMessages, useQuotedPage } = await import("./use-quoted-page");

const msg = (seq: number, over: object = {}) =>
  ({
    id: `m${seq}`,
    seq,
    role: "user",
    content: `line ${seq}`,
    status: "complete",
    ...over,
  }) as never as Parameters<typeof mergeMessages>[0][number];

test("the older page joins the loaded one by seq, and a message in both is kept once", () => {
  const loaded = [msg(10), msg(11)];
  expect(mergeMessages([], loaded)).toBe(loaded);
  const merged = mergeMessages([msg(3), msg(4), msg(10, { content: "stale" })], loaded);
  expect(merged.map((m) => m.seq)).toEqual([3, 4, 10, 11]);
  expect(merged.find((m) => m.seq === 10)?.content).toBe("line 10");
});

const roots: ReturnType<typeof createRoot>[] = [];
afterEach(async () => {
  await act(async () => roots.splice(0).forEach((r) => r.unmount()));
  win.document.body.innerHTML = "";
});

type Api = ReturnType<typeof useQuotedPage>;
function Probe({
  onApi,
  loaded,
  onError,
}: {
  onApi: (a: Api) => void;
  loaded: never[];
  onError: (e: unknown) => void;
}) {
  onApi(useQuotedPage({ conversationId: "c1", loaded, onError }));
  return null;
}

async function mountProbe(loaded: never[], onError: (e: unknown) => void = () => {}) {
  let api!: Api;
  const host = win.document.createElement("div");
  win.document.body.append(host);
  const root = createRoot(host as never);
  roots.push(root);
  await act(async () =>
    root.render(<Probe onApi={(a) => (api = a)} loaded={loaded} onError={onError} />),
  );
  return () => api;
}

test("a quote whose original is not on the page fetches the page around it, ending where the list begins, then flashes it", async () => {
  const asked: unknown[][] = [];
  const spy = spyOn(chatClient, "messagesAround").mockImplementation(async (...args) => {
    asked.push(args);
    return [msg(4), msg(5)];
  });
  const api = await mountProbe([msg(10), msg(11)] as never[]);
  // The original shows up in the document once the rows draw.
  const flashed: string[] = [];
  await act(async () => api().show("m4"));
  expect(asked).toEqual([["c1", "m4", 10]]);
  expect(api().messages.map((m) => m.seq)).toEqual([4, 5, 10, 11]);
  const el = win.document.createElement("div");
  el.id = "message-m4";
  (el as never as { scrollIntoView: () => void }).scrollIntoView = () => flashed.push("m4");
  win.document.body.append(el);
  win.matchMedia = ((q: string) => ({ matches: q.includes("reduce") })) as never;
  // The page loaded: the next click scrolls straight away, with no second request.
  await act(async () => api().show("m4"));
  expect(flashed).toEqual(["m4"]);
  expect(asked).toHaveLength(1);
  spy.mockRestore();
});

test("when the server does not have the message the page says so and the list stays as it was", async () => {
  const spy = spyOn(chatClient, "messagesAround").mockRejectedValue(new Error("gone"));
  const errors: unknown[] = [];
  const api = await mountProbe([msg(10)] as never[], (e) => errors.push(e));
  await act(async () => api().show("m1"));
  expect(errors).toHaveLength(1);
  expect(api().messages.map((m) => m.seq)).toEqual([10]);
  spy.mockRestore();
});
