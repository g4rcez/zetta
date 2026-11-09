import { afterEach, expect, mock, test } from "bun:test";
import { act } from "react";
import { createRoot } from "react-dom/client";

import { setupDom } from "../features/skills/dom-env";

const win = setupDom();

const { NotificationsProvider, toast } = await import("./notify");

const roots: { unmount: () => void }[] = [];
afterEach(async () => {
  await act(async () => roots.splice(0).forEach((r) => r.unmount()));
});

async function mount() {
  const host = win.document.createElement("div");
  win.document.body.append(host);
  const root = createRoot(host as unknown as Element);
  roots.push(root);
  await act(async () =>
    root.render(
      <NotificationsProvider>
        <p>app</p>
      </NotificationsProvider>,
    ),
  );
  return host;
}

const settle = () => act(async () => void (await new Promise((r) => setTimeout(r, 60))));
const text = () => win.document.body.textContent ?? "";

test("a toast fired from plain code shows its message", async () => {
  await mount();
  await act(async () => void toast.success("Profile saved."));
  await settle();
  expect(text()).toContain("Profile saved.");
});

test("each kind shows, and the same id updates the toast instead of piling up", async () => {
  await mount();
  await act(async () => {
    toast.error("Could not load.", { id: "load" });
    toast.warning("Careful.");
    toast.info("FYI.");
  });
  await settle();
  // Without the pointer on the stack it shows three toasts.
  for (const t of ["Could not load.", "Careful.", "FYI."]) expect(text()).toContain(t);
  await act(async () => void toast.error("Still failing.", { id: "load" }));
  await settle();
  expect(text()).toContain("Still failing.");
  expect(text()).not.toContain("Could not load.");
});

// The test DOM has no animations to finish, so a toast that is closing stays; the library marks it as ending.
const ending = () => win.document.querySelector("[data-ending-style]");

test("an action button runs its handler and closes the toast", async () => {
  await mount();
  const onUndo = mock(() => {});
  await act(
    async () => void toast("Deleted “Plan”", { action: { label: "Undo", onClick: onUndo } }),
  );
  await settle();
  const undo = [...win.document.querySelectorAll("button")].find((b) => b.textContent === "Undo")!;
  expect(undo).toBeDefined();
  expect(ending()).toBeNull();
  await act(async () => undo.click());
  expect(onUndo).toHaveBeenCalledTimes(1);
  expect(ending()).not.toBeNull();
});

test("the returned subscriber closes the toast", async () => {
  await mount();
  let sub: ReturnType<typeof toast> | undefined;
  await act(async () => {
    sub = toast("Deleting…");
  });
  await settle();
  expect(ending()).toBeNull();
  await act(async () => void sub?.close());
  expect(ending()).not.toBeNull();
});

test("without a provider a toast does nothing and does not throw", () => {
  expect(() => toast.error("nobody listens")).not.toThrow();
});
