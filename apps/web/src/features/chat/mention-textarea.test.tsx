import { afterAll, expect, test } from "bun:test";
import { Window } from "happy-dom";
import { act } from "react";
import { createRoot } from "react-dom/client";

// React DOM reads these globals. This test file does not run in a browser.
const win = new Window();
const globals = ["window", "document", "navigator", "IS_REACT_ACT_ENVIRONMENT"] as const;
const saved = globals.map(
  (key) => [key, Object.getOwnPropertyDescriptor(globalThis, key)] as const,
);
Object.assign(globalThis, {
  window: win,
  document: win.document,
  navigator: win.navigator,
  IS_REACT_ACT_ENVIRONMENT: true,
});
// `src/env.ts` reads the app env once a window exists.
process.env.__VARLOCK_ENV = JSON.stringify({
  settings: {},
  config: { NODE_ENV: { value: "test" }, VITE_SERVER_URL: { value: "http://api.test" } },
});
// Bun runs every test file in one process: leave the globals as they were.
afterAll(() => {
  for (const [key, descriptor] of saved) {
    if (descriptor) Object.defineProperty(globalThis, key, descriptor);
    else delete (globalThis as Record<string, unknown>)[key];
  }
});

const bots = [
  { id: "00000000-0000-7000-8000-000000000001", name: "Da Vinci", onboarded: true, kind: "bot" },
] as never;

const render = async (element: unknown) => {
  const host = win.document.createElement("div");
  win.document.body.append(host);
  const root = createRoot(host as unknown as Element);
  await act(async () => root.render(element as never));
  return { host, unmount: () => act(async () => root.unmount()) };
};
// Typing is not driven here: react-dom decides at import time whether the DOM supports `input` events, and in this shared test process it
// can load before the fake window exists. The `@` list itself is the unchanged `useMention`.
test("in a form it keeps its default value and submits it as a named field", async () => {
  const { MentionTextarea } = await import("./mention");
  const { host, unmount } = await render(
    <form>
      <MentionTextarea title="Prompt" name="prompt" defaultValue="Check the news" bots={bots} />
    </form>,
  );
  const form = host.querySelector("form") as unknown as HTMLFormElement;
  expect(new win.FormData(form as never).get("prompt")).toBe("Check the news");
  await unmount();
});

test("the bare chat text box shows its value and passes plain textarea props through", async () => {
  const { MentionField } = await import("./mention");
  const { host, unmount } = await render(
    <MentionField
      aria-label="Ask"
      rows={1}
      value="hello"
      onChange={() => {}}
      bots={bots}
      placeholder="Ask the wiki"
    />,
  );
  const area = host.querySelector("textarea") as unknown as HTMLTextAreaElement;
  expect(area.value).toBe("hello");
  expect(area.getAttribute("aria-label")).toBe("Ask");
  expect(area.getAttribute("placeholder")).toBe("Ask the wiki");
  await unmount();
});
