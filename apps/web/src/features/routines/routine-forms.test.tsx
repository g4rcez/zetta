import { afterAll, expect, test } from "bun:test";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act } from "react";

import type { Bot } from "../chat/chat-client";
import { setupDom } from "../skills/dom-env";

const win = setupDom();
// Bun's own FormData cannot read a DOM form; the page uses the browser's.
const bunFormData = globalThis.FormData;
globalThis.FormData = win.FormData as never;
afterAll(() => {
  globalThis.FormData = bunFormData;
});

type Call = { path: string; method: string; body: any };
let calls: Call[] = [];
globalThis.fetch = (async (input: URL | string, init?: RequestInit) => {
  const url = new URL(String(input));
  const method = init?.method ?? "GET";
  const body = init?.body ? JSON.parse(String(init.body)) : undefined;
  const ok = (v: unknown, status = 200) => Response.json(v, { status });
  calls.push({ path: url.pathname, method, body });
  if (url.pathname === "/api/routines/preview") {
    const when = String(body.when ?? "");
    if (when.includes("blah"))
      return ok(
        {
          error: {
            code: "SCHEDULE_TEXT",
            message: 'I couldn\'t read "blah" as a schedule. Try "Monday to Friday at 8:30".',
          },
        },
        400,
      );
    if (when)
      return ok({
        nextRuns: ["2030-01-07T11:30:00.000Z"],
        understood: "weekdays at 08:30 (UTC)",
        assumed: when.includes("morning")
          ? '"morning" has no exact time, so it is set to 08:00.'
          : null,
      });
    return ok({ nextRuns: ["2030-01-07T09:00:00.000Z"] });
  }
  if (url.pathname === "/api/routines" && method === "POST")
    return ok({ routine: { id: "r1", ...body } }, 201);
  if (/^\/api\/routines\/[^/]+$/.test(url.pathname) && method === "PATCH")
    return ok({ routine: { id: "r1", ...body } });
  return ok({});
}) as typeof fetch;

const bots = [{ id: "b1", name: "Digest bot", kind: "specialist" }] as unknown as Bot[];
const settle = () => act(async () => void (await new Promise((r) => setTimeout(r, 40))));
const text = () => win.document.body.textContent ?? "";
const click = async (el: Element | null | undefined, what: string) => {
  if (!el) throw new Error(`no ${what} in: ${text().slice(0, 400)}`);
  await act(async () => void el.dispatchEvent(new win.MouseEvent("click", { bubbles: true })));
  await settle();
};
const press = (label: string) =>
  click(
    [...win.document.querySelectorAll("button")].find((b) => b.textContent?.trim() === label),
    `button "${label}"`,
  );
/** Sets the text of an uncontrolled field. The forms read their fields when sent, so no typing event is needed. */
const fill = (name: string, value: string) => {
  const el = win.document.querySelector(`[name="${name}"]`) as HTMLInputElement | null;
  if (!el) throw new Error(`no field ${name}`);
  Object.getOwnPropertyDescriptor(win.HTMLInputElement.prototype, "value")!.set!.call(el, value);
};
const send = async (label: string) => {
  const form = win.document.querySelector(`form[aria-label="${label}"]`) as HTMLFormElement;
  await act(
    async () =>
      void form.dispatchEvent(
        new win.Event("submit", { bubbles: true, cancelable: true }) as never,
      ),
  );
  await settle();
};
const lastCall = (path: string) => calls.filter((c) => c.path === path).at(-1);

async function mount(which: "new" | "edit", routine?: Record<string, unknown>) {
  win.document.body.replaceChildren();
  calls = [];
  // Imported here, after the fake window exists (see the note in features/bots/grok-import.test.tsx).
  const { createRoot } = await import("react-dom/client");
  const { createMemoryHistory, createRootRoute, createRouter, RouterProvider } =
    await import("@tanstack/react-router");
  const { NewRoutineForm, EditForm } = await import("./routines");
  const saved: unknown[] = [];
  const element =
    which === "new" ? (
      <NewRoutineForm bots={bots} flows={[]} onCreated={(r) => saved.push(r)} onClose={() => {}} />
    ) : (
      <EditForm
        routine={routine as never}
        bots={bots}
        onSaved={() => saved.push("saved")}
        onCancel={() => {}}
      />
    );
  const router = createRouter({
    routeTree: createRootRoute({
      component: () => (
        <QueryClientProvider
          client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}
        >
          {element}
        </QueryClientProvider>
      ),
    }),
    history: createMemoryHistory({ initialEntries: ["/"] }),
  });
  await router.load();
  const host = win.document.createElement("div");
  win.document.body.append(host);
  const root = createRoot(host as unknown as Element);
  await act(async () => root.render(<RouterProvider router={router} />));
  await settle();
  return { saved };
}

const weekdayRoutine = {
  id: "r1",
  botId: "b1",
  title: "Digest",
  prompt: "Write it.",
  timezone: "UTC",
  dailyAt: "08:44",
  weekdays: [1, 2, 3, 4, 5],
  everyMinutes: null,
  kind: "recurring",
  version: 3,
  paused: true,
  nextRunAt: null,
};

test("a new routine starts in the 'Describe it' mode: one box for the schedule, no time picker", async () => {
  await mount("new");
  expect(win.document.querySelector('[name="scheduleText"]')).toBeTruthy();
  expect(win.document.querySelector('[name="dailyAt"]')).toBeNull();
  expect(text()).toContain("Describe it");
  expect(text()).toContain("Monday to Friday at 8:30");
  expect(text()).toContain("0 9 * * 1-5");
});

test("preview sends the words, then says what they were understood as, with the next runs", async () => {
  await mount("new");
  fill("scheduleText", "Monday to Friday at 8:30");
  await press("Preview schedule");
  expect(lastCall("/api/routines/preview")!.body).toMatchObject({
    when: "Monday to Friday at 8:30",
    timezone: expect.stringMatching(/\S/),
  });
  expect(lastCall("/api/routines/preview")!.body).not.toHaveProperty("dailyAt");
  expect(text()).toContain("Understood as weekdays at 08:30 (UTC)");
  expect(text()).toContain("Next runs");
});

test("an assumption the server made is shown with it", async () => {
  await mount("new");
  fill("scheduleText", "every weekday morning");
  await press("Preview schedule");
  expect(text()).toContain("has no exact time, so it is set to 08:00");
});

test("text the server cannot read shows its reason, and no runs", async () => {
  await mount("new");
  fill("scheduleText", "blah");
  await press("Preview schedule");
  expect(text()).toContain("couldn't read");
  expect(text()).not.toContain("Next runs");
  expect(text()).not.toContain("Understood as");
});

test("previewing with an empty box asks for the schedule and sends nothing", async () => {
  await mount("new");
  await press("Preview schedule");
  expect(text()).toContain('Write when it should run, for example "Monday to Friday at 8:30"');
  expect(calls.some((c) => c.path === "/api/routines/preview")).toBe(false);
});

test("creating sends the words in place of the time fields", async () => {
  const { saved } = await mount("new");
  fill("title", "Digest");
  fill("scheduleText", "Monday to Friday at 8:30");
  await send("New routine");
  const made = lastCall("/api/routines")!;
  expect(made.method).toBe("POST");
  expect(made.body).toMatchObject({ title: "Digest", when: "Monday to Friday at 8:30" });
  for (const field of ["dailyAt", "everyMinutes", "onceAt", "weekdays"])
    expect(made.body).not.toHaveProperty(field);
  expect(saved).toHaveLength(1);
});

test("the older ways still send what they always sent", async () => {
  await mount("new");
  await click(
    [...win.document.querySelectorAll('input[type="radio"][name="mode"]')][1],
    "the Every day radio",
  );
  expect(win.document.querySelector('[name="dailyAt"]')).toBeTruthy();
  expect(win.document.querySelector('[name="scheduleText"]')).toBeNull();
  fill("dailyAt", "09:30");
  await send("New routine");
  expect(lastCall("/api/routines")!.body).toMatchObject({ dailyAt: "09:30" });
  expect(lastCall("/api/routines")!.body).not.toHaveProperty("when");
});

test("changing the mode clears what was previewed for the other one", async () => {
  await mount("new");
  fill("scheduleText", "Monday to Friday at 8:30");
  await press("Preview schedule");
  expect(text()).toContain("Understood as");
  await click(
    [...win.document.querySelectorAll('input[type="radio"][name="mode"]')][1],
    "the Every day radio",
  );
  expect(text()).not.toContain("Understood as");
});

test("editing a weekday routine: the box shows its schedule as an example, and the time field is still there", async () => {
  await mount("edit", weekdayRoutine);
  const box = win.document.querySelector('[name="when"]') as HTMLInputElement;
  expect(box).toBeTruthy();
  expect(box.value).toBe("");
  expect(box.getAttribute("placeholder")).toBe("weekdays at 08:44");
  expect(win.document.querySelector('[name="dailyAt"]')).toBeTruthy();
});

test("editing with the box empty sends the time field, as before", async () => {
  await mount("edit", weekdayRoutine);
  await send("Edit Digest");
  const patched = lastCall("/api/routines/r1")!;
  expect(patched.method).toBe("PATCH");
  expect(patched.body).toMatchObject({ expectedVersion: 3, dailyAt: "08:44", timezone: "UTC" });
  expect(patched.body).not.toHaveProperty("when");
});

test("editing with words sends them instead of the time field", async () => {
  const { saved } = await mount("edit", weekdayRoutine);
  fill("when", "every day at 7am");
  await send("Edit Digest");
  const patched = lastCall("/api/routines/r1")!;
  expect(patched.body).toMatchObject({
    expectedVersion: 3,
    when: "every day at 7am",
    timezone: "UTC",
  });
  expect(patched.body).not.toHaveProperty("dailyAt");
  expect(saved).toEqual(["saved"]);
});

test("a one-time routine has no schedule text to edit", async () => {
  await mount("edit", {
    ...weekdayRoutine,
    kind: "once",
    dailyAt: null,
    weekdays: null,
    onceAt: "2030-01-01T10:00:00.000Z",
  });
  expect(win.document.querySelector('[name="when"]')).toBeNull();
  expect(text()).toContain("date of a one-time routine cannot be changed");
});
