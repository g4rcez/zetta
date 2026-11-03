import { EditorView } from "@codemirror/view";
import { afterAll, expect, test } from "bun:test";
import { Window } from "happy-dom";
import { act } from "react";
import { createRoot } from "react-dom/client";

import { Editor } from "./editor";
import { markdownBindings, wrapOnType } from "./markdown-typing";

// React DOM and CodeMirror read these globals. This test file does not run in a browser.
const win = new Window();
const fake = {
  window: win,
  document: win.document,
  navigator: win.navigator,
  Window,
  MutationObserver: win.MutationObserver,
  getComputedStyle: win.getComputedStyle.bind(win),
  requestAnimationFrame: (cb: () => void) => setTimeout(cb, 0),
  IS_REACT_ACT_ENVIRONMENT: true,
};
const saved = Object.keys(fake).map(
  (key) => [key, Object.getOwnPropertyDescriptor(globalThis, key)] as const,
);
Object.assign(globalThis, fake);
// Bun runs every test file in one process: leave the globals as they were.
afterAll(() => {
  for (const [key, descriptor] of saved) {
    if (descriptor) Object.defineProperty(globalThis, key, descriptor);
    else delete (globalThis as Record<string, unknown>)[key];
  }
});

const render = async (element: (v: string) => unknown, first = "") => {
  const host = win.document.createElement("div");
  win.document.body.append(host);
  const root = createRoot(host as unknown as Element);
  await act(async () => root.render(element(first) as never));
  return {
    host: host as unknown as HTMLElement,
    again: (v: string) => act(async () => root.render(element(v) as never)),
    unmount: () => act(async () => root.unmount()),
  };
};
const view = (host: HTMLElement) =>
  EditorView.findFromDOM(host.querySelector(".cm-content") as never)!;
// A key press in the browser is a user-event transaction.
const type = (host: HTMLElement, text: string) =>
  act(async () => {
    const v = view(host);
    v.dispatch({ changes: { from: v.state.doc.length, insert: text }, userEvent: "input.type" });
  });

test("in a form it submits its text as a named field and tells the form about each edit", async () => {
  const { host, unmount } = await render(() => (
    <form>
      <Editor name="note" aria-label="Note" defaultValue="Check the news" />
    </form>
  ));
  const form = host.querySelector("form") as unknown as HTMLFormElement;
  const field = () => new win.FormData(form as never).get("note");
  let inputs = 0;
  (form as unknown as EventTarget).addEventListener("input", () => (inputs += 1));
  expect(field()).toBe("Check the news");
  await type(host, " today");
  expect(field()).toBe("Check the news today");
  expect(inputs).toBe(1);
  await unmount();
});

test("a controlled editor shows a new value from its parent without calling onChange", async () => {
  const seen: string[] = [];
  const { host, again, unmount } = await render(
    (v) => <Editor aria-label="Goal" value={v} onChange={(t) => seen.push(t)} />,
    "first",
  );
  expect(host.querySelector(".cm-content")?.textContent).toBe("first");
  await again("second");
  expect(host.querySelector(".cm-content")?.textContent).toBe("second");
  expect(seen).toEqual([]);
  await unmount();
});

test("typing calls onChange with the whole text", async () => {
  const seen: string[] = [];
  const { host, unmount } = await render(() => (
    <Editor aria-label="Goal" defaultValue="Hi" onChange={(t) => seen.push(t)} />
  ));
  await type(host, " there");
  expect(seen).toEqual(["Hi there"]);
  await unmount();
});

test("maxLength refuses text that would be longer", async () => {
  const { host, unmount } = await render(() => (
    <Editor aria-label="Goal" defaultValue="abcd" maxLength={5} />
  ));
  await type(host, "ef");
  expect(host.querySelector(".cm-content")?.textContent).toBe("abcd");
  await type(host, "e");
  expect(host.querySelector(".cm-content")?.textContent).toBe("abcde");
  await unmount();
});

test("the editable element carries the label and the placeholder shows while empty", async () => {
  const { host, unmount } = await render(() => (
    <Editor aria-label="Message" placeholder="Say something" />
  ));
  expect(host.querySelector("[role=textbox]")?.getAttribute("aria-label")).toBe("Message");
  expect(host.querySelector(".cm-placeholder")?.textContent).toBe("Say something");
  await unmount();
});

// Presses a key in the editor as the browser does. Returns whether the editor took the key.
const press = async (host: HTMLElement, key: string, init: Record<string, unknown> = {}) => {
  let taken = false;
  await act(async () => {
    const content = host.querySelector(".cm-content") as unknown as HTMLElement;
    const event = new win.KeyboardEvent("keydown", {
      key,
      bubbles: true,
      cancelable: true,
      ...init,
    });
    content.dispatchEvent(event as never);
    taken = event.defaultPrevented;
  });
  return taken;
};
const text = (host: HTMLElement) => view(host).state.doc.toString();
const caretAtEnd = (host: HTMLElement) => {
  const v = view(host);
  v.dispatch({ selection: { anchor: v.state.doc.length } });
};

test("Enter after a bullet starts the next bullet", async () => {
  const { host, unmount } = await render(() => <Editor aria-label="Note" defaultValue="- one" />);
  caretAtEnd(host);
  await press(host, "Enter");
  expect(text(host)).toBe("- one\n- ");
  await unmount();
});

test("Enter after a numbered item starts the next number", async () => {
  const { host, unmount } = await render(() => <Editor aria-label="Note" defaultValue="1. one" />);
  caretAtEnd(host);
  await press(host, "Enter");
  expect(text(host)).toBe("1. one\n2. ");
  await unmount();
});

test("Shift+Enter also continues a list", async () => {
  const { host, unmount } = await render(() => <Editor aria-label="Note" defaultValue="- one" />);
  caretAtEnd(host);
  await press(host, "Enter", { shiftKey: true });
  expect(text(host)).toBe("- one\n- ");
  await unmount();
});

test("Enter on an empty bullet ends the list", async () => {
  const { host, unmount } = await render(() => (
    <Editor aria-label="Note" defaultValue={"- one\n- "} />
  ));
  caretAtEnd(host);
  await press(host, "Enter");
  expect(text(host)).toBe("- one\n");
  await unmount();
});

test("Enter on a plain line only adds a line", async () => {
  const { host, unmount } = await render(() => <Editor aria-label="Note" defaultValue="hello" />);
  caretAtEnd(host);
  await press(host, "Enter");
  expect(text(host)).toBe("hello\n");
  await unmount();
});

test("Tab nests a list item, and on a plain line it still moves focus", async () => {
  const list = await render(() => <Editor aria-label="Note" defaultValue="- one" />);
  expect(await press(list.host, "Tab")).toBe(true);
  expect(text(list.host)).toBe("    - one");
  await list.unmount();
  const plain = await render(() => <Editor aria-label="Note" defaultValue="one" />);
  expect(await press(plain.host, "Tab")).toBe(false);
  expect(text(plain.host)).toBe("one");
  await plain.unmount();
});

// Mod is Cmd on a Mac and Ctrl elsewhere; CodeMirror reads the platform when it loads, so the test runs the bound command.
test("the bold shortcut marks the selection bold, and a second use takes the mark off", async () => {
  const { host, unmount } = await render(() => <Editor aria-label="Note" defaultValue="one two" />);
  const bold = markdownBindings.find((b) => b.key === "Mod-b")!.run!;
  view(host).dispatch({ selection: { anchor: 0, head: 3 } });
  bold(view(host));
  expect(text(host)).toBe("**one** two");
  bold(view(host));
  expect(text(host)).toBe("one two");
  await unmount();
});

test("Enter after a task item starts an unchecked task", async () => {
  const { host, unmount } = await render(() => (
    <Editor aria-label="Note" defaultValue="- [x] done" />
  ));
  caretAtEnd(host);
  await press(host, "Enter");
  expect(text(host)).toBe("- [x] done\n- [ ] ");
  await unmount();
});

test("Enter in a nested list keeps the nesting, and Backspace on its marker leaves the indent", async () => {
  const { host, unmount } = await render(() => (
    <Editor aria-label="Note" defaultValue={"- a\n    - b"} />
  ));
  caretAtEnd(host);
  await press(host, "Enter");
  expect(text(host)).toBe("- a\n    - b\n    - ");
  await press(host, "Backspace");
  expect(text(host)).toBe("- a\n    - b\n      ");
  await unmount();
});

test("typing * over selected text wraps it and keeps it selected, so a second * makes it bold", async () => {
  const { host, unmount } = await render(() => <Editor aria-label="Note" defaultValue="one two" />);
  view(host).dispatch({ selection: { anchor: 0, head: 3 } });
  expect(wrapOnType(view(host), 0, 3, "*")).toBe(true);
  expect(text(host)).toBe("*one* two");
  expect(wrapOnType(view(host), 1, 4, "*")).toBe(true);
  expect(text(host)).toBe("**one** two");
  await unmount();
});

test("typing * with nothing selected, or over a selection in code, is a plain character", async () => {
  const empty = await render(() => <Editor aria-label="Note" defaultValue="one" />);
  expect(wrapOnType(view(empty.host), 0, 0, "*")).toBe(false);
  await empty.unmount();
  const code = await render(() => <Editor aria-label="Note" defaultValue={"```js\na * b\n```"} />);
  view(code.host).dispatch({ selection: { anchor: 6, head: 7 } });
  expect(wrapOnType(view(code.host), 6, 7, "*")).toBe(false);
  await code.unmount();
});
