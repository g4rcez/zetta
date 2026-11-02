// Run by `mention-typing.test.ts` in its own process. React DOM decides at import time whether the DOM supports `input` events, so the fake
// window must exist before it loads; a shared test process may have loaded it already. Prints one JSON line.
import { Window } from "happy-dom";

const win = new Window();
Object.assign(globalThis, {
  window: win,
  document: win.document,
  navigator: win.navigator,
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
const { MentionField, MentionTextarea } = await import("./mention");

const bots = [
  { id: "00000000-0000-7000-8000-000000000001", name: "Da Vinci", onboarded: true, kind: "bot" },
] as never;
const native = Object.getOwnPropertyDescriptor(win.HTMLTextAreaElement.prototype, "value")!.set!;

const mount = async (element: unknown) => {
  const host = win.document.createElement("div");
  win.document.body.append(host);
  const root = createRoot(host as unknown as Element);
  await act(async () => root.render(element as never));
  return host as unknown as HTMLElement;
};
// React ignores a plain `area.value = …`: it tracks the value through the prototype setter.
const type = async (area: HTMLTextAreaElement, text: string) =>
  act(async () => {
    native.call(area, text);
    area.setSelectionRange(text.length, text.length);
    area.dispatchEvent(new win.Event("input", { bubbles: true }) as never);
  });
const press = (area: HTMLTextAreaElement, key: string) =>
  act(async () => {
    area.dispatchEvent(
      new win.KeyboardEvent("keydown", { key, bubbles: true, cancelable: true }) as never,
    );
  });
const areaOf = (host: HTMLElement) =>
  host.querySelector("textarea") as unknown as HTMLTextAreaElement;
const list = (host: HTMLElement) => host.querySelector("[role=listbox]")?.textContent ?? null;

const out: Record<string, unknown> = {};

// In a form: name + defaultValue.
{
  const host = await mount(
    <form>
      <MentionTextarea title="Prompt" name="prompt" defaultValue="Check the news" bots={bots} />
    </form>,
  );
  const area = areaOf(host);
  const field = () => new win.FormData(host.querySelector("form") as never).get("prompt");
  const start = field();
  await type(area, "Check the news with @Da");
  const opened = list(host);
  await press(area, "Enter");
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
  const area = areaOf(host);
  await type(area, "Goal @Da");
  const opened = list(host);
  await press(area, "Enter");
  const pickedValue = area.value;
  const keysWhileOpen = [...keys];
  await type(area, `${pickedValue}now`);
  await press(area, "Enter");
  out.controlled = { opened, pickedValue, keysWhileOpen, keysAfter: [...keys] };
}

// The bare chat text box.
{
  function Bare() {
    const [v, setV] = useState("");
    return <MentionField aria-label="Ask" bots={bots} value={v} onChange={setV} rows={1} />;
  }
  const host = await mount(<Bare />);
  const area = areaOf(host);
  await type(area, "Who is @Da");
  const opened = list(host);
  await press(area, "Enter");
  out.field = { opened, picked: area.value };
}

console.log("RESULT " + JSON.stringify(out));
process.exit(0);
