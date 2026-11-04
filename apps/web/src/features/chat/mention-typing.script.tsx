// Run by `mention-typing.test.ts` in its own process. React DOM decides at import time whether the DOM supports `input` events, so the fake
// window must exist before it loads; a shared test process may have loaded it already. Prints one JSON line.
import { Window } from "happy-dom";

const win = new Window();
Object.assign(globalThis, {
  window: win,
  document: win.document,
  navigator: win.navigator,
  Window,
  MutationObserver: win.MutationObserver,
  getComputedStyle: win.getComputedStyle.bind(win),
  requestAnimationFrame: (cb: () => void) => setTimeout(cb, 0),
  IS_REACT_ACT_ENVIRONMENT: true,
});
process.env.__VARLOCK_ENV = JSON.stringify({
  settings: {},
  config: { NODE_ENV: { value: "test" }, VITE_SERVER_URL: { value: "http://api.test" } },
});
// Teams and rooms are only fetched for `#`.
globalThis.fetch = (async () => new Response("{}", { status: 200 })) as unknown as typeof fetch;

const { act, useState } = await import("react");
const { createRoot } = await import("react-dom/client");
const { EditorView } = await import("@codemirror/view");
const { QueryClient, QueryClientProvider } = await import("@tanstack/react-query");
const { MentionField, MentionTextarea } = await import("./mention");

const bots = [
  { id: "00000000-0000-7000-8000-000000000001", name: "Da Vinci", onboarded: true, kind: "bot" },
] as never;
const mount = async (element: unknown) => {
  const host = win.document.createElement("div");
  win.document.body.append(host);
  const root = createRoot(host as unknown as Element);
  // The bot rows draw a status dot, which reads the query cache.
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
// Typing is a user-event transaction at the end of the text, as the browser's input handling makes it.
const type = async (host: HTMLElement, text: string) =>
  act(async () => {
    const view = viewOf(host);
    view.dispatch({
      changes: { from: 0, to: view.state.doc.length, insert: text },
      selection: { anchor: text.length },
      userEvent: "input.type",
    });
  });
const press = (host: HTMLElement, key: string) =>
  act(async () => {
    contentOf(host).dispatchEvent(
      new win.KeyboardEvent("keydown", { key, bubbles: true, cancelable: true }) as never,
    );
  });
const list = (host: HTMLElement) => host.querySelector("[role=listbox]")?.textContent ?? null;

const out: Record<string, unknown> = {};

// In a form: name + defaultValue.
{
  const host = await mount(
    <form>
      <MentionTextarea title="Prompt" name="prompt" defaultValue="Check the news" bots={bots} />
    </form>,
  );
  const field = () => new win.FormData(host.querySelector("form") as never).get("prompt");
  const start = field();
  await type(host, "Check the news with @Da");
  const opened = list(host);
  await press(host, "Enter");
  out.form = { start, opened, picked: field() };
}

// Controlled, with the caller's own key handler.
{
  const keys: string[] = [];
  const shown: string[] = [];
  function Controlled() {
    const [v, setV] = useState("");
    shown.push(v);
    return (
      <MentionTextarea
        title="Goal"
        bots={bots}
        value={v}
        onChange={setV}
        onKeyDown={(e) => keys.push(e.key)}
      />
    );
  }
  const host = await mount(<Controlled />);
  await type(host, "Goal @Da");
  const opened = list(host);
  await press(host, "Enter");
  const pickedValue = textOf(host);
  const keysWhileOpen = [...keys];
  await type(host, `${pickedValue}now`);
  await press(host, "Enter");
  out.controlled = { opened, pickedValue, keysWhileOpen, keysAfter: [...keys] };
}

// The bare chat text box.
{
  function Bare() {
    const [v, setV] = useState("");
    return <MentionField aria-label="Ask" bots={bots} value={v} onChange={setV} rows={1} />;
  }
  const host = await mount(<Bare />);
  await type(host, "Who is @Da");
  const opened = list(host);
  await press(host, "Enter");
  out.field = { opened, picked: textOf(host) };
}

console.log("RESULT " + JSON.stringify(out));
process.exit(0);
