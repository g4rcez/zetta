// Run by `message-edit-typing.test.ts` in its own process (React DOM must load after the fake window exists, see `mention-typing.script.tsx`).
// Types into the inline editor of a message and into the message box. Prints one JSON line.
import { Window } from "happy-dom";

const win = new Window();
Object.assign(globalThis, {
  window: win,
  document: win.document,
  navigator: win.navigator,
  Window,
  HTMLElement: win.HTMLElement,
  Element: win.Element,
  Node: win.Node,
  ShadowRoot: win.ShadowRoot,
  MutationObserver: win.MutationObserver,
  getComputedStyle: win.getComputedStyle.bind(win),
  requestAnimationFrame: (cb: () => void) => setTimeout(cb, 0),
  IS_REACT_ACT_ENVIRONMENT: true,
  ResizeObserver: class {
    observe() {}
    unobserve() {}
    disconnect() {}
  },
});
process.env.__VARLOCK_ENV = JSON.stringify({
  settings: {},
  config: { NODE_ENV: { value: "test" }, ZETTA_SERVER_URL: { value: "http://api.test" } },
});
globalThis.fetch = (async () => new Response("{}", { status: 200 })) as unknown as typeof fetch;

const { act } = await import("react");
const { createRoot } = await import("react-dom/client");
const { EditorView } = await import("@codemirror/view");
const { QueryClient, QueryClientProvider } = await import("@tanstack/react-query");
const { MessageEditor } = await import("./message-edit");
const { Composer } = await import("./composer");

const mount = async (element: unknown) => {
  const host = win.document.createElement("div");
  win.document.body.append(host);
  const root = createRoot(host as unknown as Element);
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  await act(async () =>
    root.render(<QueryClientProvider client={client}>{element as never}</QueryClientProvider>),
  );
  return host as unknown as HTMLElement;
};
const contentOf = (host: HTMLElement) =>
  host.querySelector(".cm-content") as unknown as HTMLElement;
const viewOf = (host: HTMLElement) => EditorView.findFromDOM(contentOf(host) as never)!;
const textOf = (host: HTMLElement) => viewOf(host).state.doc.toString();
const type = (host: HTMLElement, text: string) =>
  act(async () => {
    const view = viewOf(host);
    view.dispatch({
      changes: { from: 0, to: view.state.doc.length, insert: text },
      selection: { anchor: text.length },
      userEvent: "input.type",
    });
  });
const press = (host: HTMLElement, key: string, init: Record<string, unknown> = {}) =>
  act(async () => {
    contentOf(host).dispatchEvent(
      new win.KeyboardEvent("keydown", { key, bubbles: true, cancelable: true, ...init }) as never,
    );
  });
const click = (el: Element | undefined) =>
  act(async () => {
    (el as unknown as HTMLElement).click();
  });
const wait = () => act(async () => void (await new Promise((done) => setTimeout(done, 20))));

const row = {
  id: "m1",
  seq: 1,
  role: "user",
  content: "see you at noon",
  status: "complete",
  createdAt: "2026-11-03T12:00:00.000Z",
} as never;
const out: Record<string, unknown> = {};

// Ctrl+Enter saves the new text; the plain Enter and Esc do not.
{
  const saved: string[] = [];
  const cancelled: number[] = [];
  const host = await mount(
    <MessageEditor
      row={row}
      bots={[]}
      onSave={async (_r, text) => void saved.push(text)}
      onCancel={() => cancelled.push(1)}
    />,
  );
  const start = textOf(host);
  await type(host, "see you at one");
  await press(host, "Enter");
  const afterEnter = [...saved];
  await press(host, "Enter", { ctrlKey: true });
  await wait();
  await press(host, "Escape");
  out.ctrlEnter = { start, afterEnter, saved, cancelled };
}

// Save with the Save button, an unchanged text just closes, an empty text cannot be saved.
{
  const saved: string[] = [];
  const cancelled: number[] = [];
  const host = await mount(
    <MessageEditor
      row={row}
      bots={[]}
      onSave={async (_r, text) => void saved.push(text)}
      onCancel={() => cancelled.push(1)}
    />,
  );
  const save = () => [...host.querySelectorAll("button")].find((b) => b.textContent === "Save");
  await click(save());
  const unchanged = { saved: [...saved], cancelled: [...cancelled] };
  await type(host, "   ");
  const emptyDisabled = (save() as unknown as HTMLButtonElement).disabled;
  await type(host, "see you at two");
  await click(save());
  await wait();
  out.saveButton = { unchanged, emptyDisabled, saved };
}

// A refusal keeps the editor open with the text and says why.
{
  const host = await mount(
    <MessageEditor
      row={row}
      bots={[]}
      onSave={async () => {
        throw new Error("You can only edit your own messages.");
      }}
      onCancel={() => {}}
    />,
  );
  await type(host, "see you at three");
  await press(host, "Enter", { metaKey: true });
  await wait();
  out.refused = {
    alert: [...host.querySelectorAll("p[role=alert]")]
      .map((p) => p.textContent)
      .filter(Boolean)
      .join("|"),
    text: textOf(host),
  };
}

// The Up arrow in an empty message box edits the last message; with text it is a plain arrow.
function Box({ value, onEditLast }: { value: string; onEditLast: () => void }) {
  return (
    <Composer
      value={value}
      onChange={() => {}}
      placeholder="Message"
      bots={[]}
      busy={false}
      onSubmit={() => true}
      onError={() => {}}
      onEditLast={onEditLast}
    />
  );
}
{
  let edits = 0;
  const empty = await mount(<Box value="" onEditLast={() => edits++} />);
  await press(empty, "ArrowUp");
  const afterEmpty = edits;
  await press(empty, "ArrowUp", { shiftKey: true });
  const filled = await mount(<Box value="half a thought" onEditLast={() => edits++} />);
  await press(filled, "ArrowUp");
  out.upArrow = { afterEmpty, final: edits };
}

console.log("RESULT " + JSON.stringify(out));
process.exit(0);
