import { expect, test } from "bun:test";
import { act } from "react";
import { createRoot } from "react-dom/client";

import { setupDom } from "../skills/dom-env";

const win = setupDom();

const BOT = "00000000-0000-7000-8000-000000000001";
const settle = () => act(async () => void (await new Promise((r) => setTimeout(r, 30))));
const press = async (el: { dispatchEvent(e: never): unknown } | null | undefined) => {
  if (!el) throw new Error(`missing element in: ${win.document.body.textContent}`);
  await act(
    async () => void el.dispatchEvent(new win.MouseEvent("click", { bubbles: true }) as never),
  );
  await settle();
};

const mount = async (address: Record<string, unknown>) => {
  const { FiltersBar } = await import("./filters-bar");
  const { filterOf, activeCount, parseMemorySearch } = await import("./memory-filters");
  const search = parseMemorySearch(address);
  const filter = filterOf(search);
  const changes: Record<string, unknown>[] = [];
  const host = win.document.createElement("div");
  win.document.body.append(host);
  const root = createRoot(host as unknown as Element);
  await act(async () =>
    root.render(
      <FiltersBar
        search={search}
        filter={filter}
        set={(next) => void changes.push(next)}
        clear={() => void changes.push({ clear: true })}
        active={activeCount(filter)}
        tags={[{ tag: "gotcha", count: 9 }]}
        bots={[{ id: BOT, name: "Bartender" }]}
        teams={[]}
        shown={1}
        total={24}
      />,
    ),
  );
  await settle();
  return { changes, unmount: () => act(async () => root.unmount()) };
};

test("the page shows only the bar and one chip per active filter", async () => {
  const page = await mount({ createdBy: BOT, tag: "gotcha" });
  const labels = [
    ...win.document.querySelectorAll(
      "ul[aria-label='Active filters'] button[aria-label^='Remove']",
    ),
  ].map((b) => b.getAttribute("aria-label"));
  expect(labels).toEqual(["Remove Tag: gotcha", "Remove Created by: Bartender"]);
  expect(win.document.body.textContent).toContain("1 of 24 items");
  expect(win.document.querySelectorAll("select").length).toBe(1);
  await page.unmount();
});

test("removing a chip takes that one value out of the address", async () => {
  const page = await mount({ createdBy: BOT, tag: "gotcha" });
  await press(win.document.querySelector("button[aria-label='Remove Created by: Bartender']"));
  expect(page.changes).toEqual([{ createdBy: undefined }]);
  await page.unmount();
});

test("the Filters button opens a drawer with every facet", async () => {
  const page = await mount({ createdBy: BOT });
  const open = [...win.document.querySelectorAll("button")].find((b) =>
    b.textContent?.startsWith("Filters"),
  );
  await press(open);
  const dialog = win.document.querySelector("[role='dialog']");
  expect(dialog?.textContent).toContain("Created by");
  const created = dialog?.querySelector("select[name='createdBy']") as unknown as
    | HTMLSelectElement
    | undefined;
  expect(created?.value).toBe(BOT);
  expect(dialog?.textContent).toContain("Show 1 item");
  await page.unmount();
});
