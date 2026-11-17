import { afterEach, expect, test } from "bun:test";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act } from "react";
import { createRoot } from "react-dom/client";

import { setupDom } from "../skills/dom-env";

const win = setupDom();
const { useEditMessage } = await import("./use-edit-message");
const { chatQueries } = await import("./chat-queries");
const { keysFor } = await import("@/lib/live-events");

const message = (id: string, content: string, over: object = {}) =>
  ({ id, seq: 1, role: "user", content, status: "complete", ...over }) as never;

const roots: ReturnType<typeof createRoot>[] = [];
afterEach(async () => {
  await act(async () => roots.splice(0).forEach((r) => r.unmount()));
  win.document.body.innerHTML = "";
});

type Api = ReturnType<typeof useEditMessage>;
async function mountHook(submit: (id: string, text: string) => Promise<never>) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  client.setQueryData(chatQueries.messages("c1").queryKey, [message("m1", "old text")]);
  let api!: Api;
  function Probe() {
    api = useEditMessage({ conversationId: "c1", submit });
    return null;
  }
  const host = win.document.createElement("div");
  win.document.body.append(host);
  const root = createRoot(host as never);
  roots.push(root);
  await act(async () =>
    root.render(
      <QueryClientProvider client={client}>
        <Probe />
      </QueryClientProvider>,
    ),
  );
  return { api: () => api, client };
}
const cached = (client: QueryClient) =>
  client.getQueryData<{ id: string; content: string; editedAt?: string }[]>(
    chatQueries.messages("c1").queryKey,
  )!;

test("starting an edit opens the editor on that message, and Cancel closes it", async () => {
  const { api } = await mountHook(async () => message("m1", "x"));
  await act(async () => api().start(message("m1", "old text")));
  expect(api().editingId).toBe("m1");
  await act(async () => api().cancel());
  expect(api().editingId).toBeUndefined();
  // A bot's reply and a message not saved yet never open the editor.
  await act(async () => api().start(message("m2", "reply", { role: "assistant" })));
  await act(async () => api().start(message("m3", "echo", { seq: Number.MAX_SAFE_INTEGER })));
  expect(api().editingId).toBeUndefined();
});

test("saving puts the server's message into the list at once and closes the editor", async () => {
  const sent: string[][] = [];
  const { api, client } = await mountHook(async (id, text) => {
    sent.push([id, text]);
    return message(id, text, { editedAt: "2026-11-03T12:30:00.000Z" });
  });
  await act(async () => api().start(message("m1", "old text")));
  await act(async () => api().save(message("m1", "old text"), "new text"));
  expect(sent).toEqual([["m1", "new text"]]);
  expect(cached(client)[0]).toMatchObject({
    content: "new text",
    editedAt: "2026-11-03T12:30:00.000Z",
  });
  expect(api().editingId).toBeUndefined();
});

test("a refusal leaves the editor open and the list as it was", async () => {
  const { api, client } = await mountHook(async () => {
    throw new Error("refused");
  });
  await act(async () => api().start(message("m1", "old text")));
  let thrown: unknown;
  await act(async () => {
    thrown = await api()
      .save(message("m1", "old text"), "new text")
      .catch((e: unknown) => e);
  });
  expect((thrown as Error).message).toBe("refused");
  expect(api().editingId).toBe("m1");
  expect(cached(client)[0]!.content).toBe("old text");
});

test("the live signal of a conversation refreshes its messages, which is how an edit shows without a reload", () => {
  expect(keysFor("conversation:c1")).toEqual([{ queryKey: ["conversations", "c1"], exact: false }]);
  expect(chatQueries.messages("c1").queryKey.slice(0, 2)).toEqual(["conversations", "c1"]);
});
