import { afterAll, expect, test } from "bun:test";
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

const { Fields } = await import("./item-fields");

const ANA = "00000000-0000-7000-8000-0000000000f1";
const BEN = "00000000-0000-7000-8000-0000000000f2";
const bots = [
  { id: ANA, name: "Ana", kind: "specialist", role: "Archivist", description: "" },
  { id: BEN, name: "Ana", kind: "specialist", role: "", description: "Keeps the notes\nmore" },
] as never[];

test("the bot that reads an item is picked with its role, and its id is what the form sends", async () => {
  const host = win.document.createElement("div");
  win.document.body.append(host);
  const root = createRoot(host as unknown as Element);
  await act(async () =>
    root.render(
      <form>
        <Fields
          meta
          bots={bots as never}
          page={{ title: "t", howto: "", content: "c", tags: [], type: "solo", authorBotId: BEN }}
        />
      </form>,
    ),
  );
  await act(async () => void (await new Promise((r) => setTimeout(r, 30))));
  const hidden = host.querySelector(
    'input[type="hidden"][name="authorBotId"]',
  ) as unknown as HTMLInputElement;
  expect(hidden.value).toBe(BEN);
  const box = [...host.querySelectorAll('[role="combobox"]')].find(
    (b) => b.getAttribute("data-name") === "authorBotId",
  ) as unknown as HTMLInputElement;
  await act(async () => {
    for (const type of ["pointerdown", "mousedown", "pointerup", "mouseup", "click"])
      box.dispatchEvent(new win.MouseEvent(type, { bubbles: true, button: 0 }) as unknown as Event);
  });
  await act(async () => void (await new Promise((r) => setTimeout(r, 30))));
  const shown = [...win.document.querySelectorAll('[role="option"]')].map((o) => o.textContent);
  expect(shown).toEqual(["AnaArchivist", "AnaKeeps the notes"]);
  await act(async () => root.unmount());
});
