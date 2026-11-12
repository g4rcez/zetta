import { afterEach, expect, test } from "bun:test";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act } from "react";
import { createRoot } from "react-dom/client";

import { setupDom } from "../skills/dom-env";
import type { Outgoing } from "./composer";

const win = setupDom();
Object.assign(globalThis, {
  ResizeObserver: class {
    observe() {}
    unobserve() {}
    disconnect() {}
  },
});
const { Composer } = await import("./composer");

const roots: ReturnType<typeof createRoot>[] = [];
afterEach(async () => {
  await act(async () => roots.splice(0).forEach((r) => r.unmount()));
  await new Promise((done) => setTimeout(done, 20));
});

function mount(props: { polls?: boolean; value?: string; onSubmit?: (o: Outgoing) => boolean }) {
  const host = win.document.createElement("div");
  win.document.body.append(host);
  const root = createRoot(host as never);
  roots.push(root);
  act(() =>
    root.render(
      <QueryClientProvider
        client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}
      >
        <Composer
          value={props.value ?? "Which day?"}
          onChange={() => {}}
          placeholder="Message"
          bots={[]}
          busy={false}
          onSubmit={props.onSubmit ?? (() => true)}
          onError={() => {}}
          {...(props.polls ? { polls: true } : {})}
        />
      </QueryClientProvider>,
    ),
  );
  return host as unknown as HTMLElement;
}
const byLabel = (host: HTMLElement, label: string) =>
  host.querySelector(`[aria-label="${label}"]`) as unknown as HTMLElement | null;
const click = (el: Element | null) => act(() => (el as unknown as HTMLElement).click());
/** Types into a controlled input the way React hears it: through the native setter and an `input` event. */
function type(el: Element | null, text: string) {
  const input = el as unknown as HTMLInputElement;
  const set = Object.getOwnPropertyDescriptor(win.HTMLInputElement.prototype, "value")!.set!;
  act(() => {
    set.call(input, text);
    input.dispatchEvent(new win.Event("input", { bubbles: true }) as unknown as Event);
  });
}

test("the poll tool is only offered where the page can send a poll", () => {
  expect(byLabel(mount({}), "Add a poll")).toBeNull();
  expect(byLabel(mount({ polls: true }), "Add a poll")).not.toBeNull();
});

test("adding a poll shows the options, and the tool then removes it", () => {
  const host = mount({ polls: true });
  click(byLabel(host, "Add a poll"));
  expect(host.querySelector('section[aria-label="Poll"]')).not.toBeNull();
  expect(byLabel(host, "Remove the poll")).not.toBeNull();
  click(
    host.querySelectorAll('[aria-label="Remove the poll"]')[1] ?? byLabel(host, "Remove the poll"),
  );
  expect(host.querySelector('section[aria-label="Poll"]')).toBeNull();
});

test("a poll cannot be sent until it has a question and two different options", () => {
  const sent: Outgoing[] = [];
  const host = mount({ polls: true, onSubmit: (o) => (sent.push(o), true) });
  click(byLabel(host, "Add a poll"));
  const send = () => byLabel(host, "Send");
  expect(send()!.hasAttribute("disabled")).toBe(true);
  type(byLabel(host, "Option 1"), "Tuesday");
  expect(send()!.hasAttribute("disabled")).toBe(true);
  type(byLabel(host, "Option 2"), "tuesday");
  expect(send()!.hasAttribute("disabled")).toBe(true);
  type(byLabel(host, "Option 2"), "Thursday");
  expect(send()!.hasAttribute("disabled")).toBe(false);
  click(send());
  expect(sent).toHaveLength(1);
  expect(sent[0]).toMatchObject({
    text: "Which day?",
    poll: { options: ["Tuesday", "Thursday"], mode: "single" },
  });
});

test("after the poll is sent the editor closes", async () => {
  const host = mount({ polls: true });
  click(byLabel(host, "Add a poll"));
  type(byLabel(host, "Option 1"), "A");
  type(byLabel(host, "Option 2"), "B");
  await act(async () => byLabel(host, "Send")!.click());
  expect(host.querySelector('section[aria-label="Poll"]')).toBeNull();
});

test("without a poll the message goes out as before", () => {
  const sent: Outgoing[] = [];
  const host = mount({ polls: true, onSubmit: (o) => (sent.push(o), true) });
  click(byLabel(host, "Send"));
  expect(sent[0]!.poll).toBeUndefined();
});
