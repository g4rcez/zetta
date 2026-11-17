import { afterAll, expect, test } from "bun:test";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act } from "react";
import { createRoot } from "react-dom/client";

import { setupDom } from "../skills/dom-env";

const win = setupDom();
// The library builds `new Event("change")` from the global, and happy-dom only takes its own Event class.
const realEvent = globalThis.Event;
globalThis.Event = win.Event as unknown as typeof Event;
afterAll(() => {
  globalThis.Event = realEvent;
});

const ME = "00000000-0000-7000-8000-0000000000e1";
const ANA = "00000000-0000-7000-8000-0000000000e2";
const BEN = "00000000-0000-7000-8000-0000000000e3";
(globalThis as { fetch: unknown }).fetch = async (input: URL | string) => {
  const path = new URL(String(input)).pathname;
  if (path === `/api/bots/${ME}/decision`)
    return Response.json({
      decision: {
        enabled: true,
        question: "What does this message need?",
        minConfidencePct: 60,
        options: [
          { label: "Billing", description: "About money", action: "delegate", targetBotId: ANA },
          { label: "Other", description: "Anything else", action: "respond" },
        ],
      },
    });
  return Response.json({ error: { code: "TEST", message: path } }, { status: 500 });
};

const { BotDecision } = await import("./bot-decision");

const bots = [
  { id: ME, name: "Router", kind: "specialist", description: "" },
  { id: ANA, name: "Ana", kind: "specialist", role: "Billing support", description: "" },
  {
    id: BEN,
    name: "Ana",
    kind: "specialist",
    role: "",
    description: "Answers legal questions\nmore",
  },
] as never[];

test("'Hand over to' lists the other bots with their role, so two bots with one name can be told apart", async () => {
  const host = win.document.createElement("div");
  win.document.body.append(host);
  const root = createRoot(host as unknown as Element);
  await act(async () =>
    root.render(
      <QueryClientProvider
        client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}
      >
        <BotDecision bot={bots[0]} bots={bots as never} />
      </QueryClientProvider>,
    ),
  );
  await act(async () => void (await new Promise((r) => setTimeout(r, 60))));
  const box = host.querySelector('[role="combobox"]') as unknown as HTMLInputElement;
  // The saved target is shown by name.
  expect(box.value).toBe("Ana");
  await act(async () => {
    for (const type of ["pointerdown", "mousedown", "pointerup", "mouseup", "click"])
      box.dispatchEvent(new win.MouseEvent(type, { bubbles: true, button: 0 }) as unknown as Event);
  });
  await act(async () => void (await new Promise((r) => setTimeout(r, 30))));
  const shown = [...win.document.querySelectorAll('[role="option"]')].map((o) => o.textContent);
  // The bot being edited is not offered as its own target.
  expect(shown).toEqual(["AnaBilling support", "AnaAnswers legal questions"]);
  await act(async () => root.unmount());
});
