import { expect, test } from "bun:test";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act } from "react";
import { createRoot } from "react-dom/client";

import { setupDom } from "../skills/dom-env";

const win = setupDom();

type Call = { method: string; path: string; body: unknown };
const calls: Call[] = [];
let profile: { name: string; email: string; avatar: unknown } = {
  name: "Ada Lovelace",
  email: "ada@example.invalid",
  avatar: null,
};
let passwordAnswer: "ok" | "wrong" = "ok";
const FIREFOX =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10.15; rv:130.0) Gecko/20100101 Firefox/130.0";
const CHROME =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/129.0.0.0 Safari/537.36";

type Answer = { status?: number; body: unknown };
const api = (path: string, method: string, body: unknown): Answer => {
  if (path === "/api/auth/get-session")
    return {
      body: {
        session: { id: "s1", token: "t", userId: "u1" },
        user: { id: "u1", name: profile.name, email: profile.email },
      },
    };
  if (path === "/api/profile") {
    if (method === "PATCH") profile = { ...profile, ...(body as object) };
    return { body: { profile } };
  }
  if (path === "/api/profile/sessions")
    return {
      body: {
        sessions: [
          {
            id: "s1",
            device: "this",
            userAgent: FIREFOX,
            ipAddress: "203.0.113.7",
            createdAt: new Date(Date.now() - 5 * 60_000).toISOString(),
          },
          {
            id: "s2",
            device: "other",
            userAgent: CHROME,
            ipAddress: null,
            createdAt: new Date(Date.now() - 3 * 86_400_000).toISOString(),
          },
        ],
      },
    };
  if (path === "/api/preferences")
    return {
      body: {
        preferences: {
          railMode: "expanded",
          sidebarSide: "left",
          railWidth: 224,
          listWidth: 320,
          timeFormat: "24h",
          theme: null,
          primaryColor: null,
          botOrder: [],
          roomOrder: [],
        },
      },
    };
  if (path === "/api/auth/change-password")
    return passwordAnswer === "ok"
      ? { body: { status: true } }
      : { status: 400, body: { code: "INVALID_PASSWORD", message: "Invalid password" } };
  if (path === "/api/auth/revoke-other-sessions") return { body: { status: true } };
  throw new Error(`unexpected ${method} ${path}`);
};
// Before anything that loads the auth client: it keeps the `fetch` it finds at load time.
globalThis.fetch = (async (input: URL | Request | string, init?: RequestInit) => {
  const url = new URL(input instanceof Request ? input.url : String(input));
  const method = init?.method ?? (input instanceof Request ? input.method : "GET");
  const raw = init?.body ?? (input instanceof Request ? await input.text() : undefined);
  const body = raw ? JSON.parse(String(raw)) : undefined;
  calls.push({ method, path: url.pathname, body });
  try {
    const answer = api(url.pathname, method, body);
    return Response.json(answer.body, { status: answer.status ?? 200 });
  } catch (e) {
    return Response.json({ message: (e as Error).message }, { status: 500 });
  }
}) as typeof fetch;

const settle = (ms = 40) => act(async () => void (await new Promise((r) => setTimeout(r, ms))));
const text = () => win.document.body.textContent ?? "";
const input = (name: string) =>
  win.document.querySelector(`input[name="${name}"]`) as unknown as HTMLInputElement;
// The library's controlled input ignores a simulated input event in this DOM (see studio/desktop.test.tsx), so its React onChange is called.
const type = async (name: string, value: string) => {
  const el = input(name);
  await act(async () => {
    Object.getOwnPropertyDescriptor(win.HTMLInputElement.prototype, "value")!.set!.call(el, value);
    const props = (el as unknown as Record<string, { onChange?: (e: unknown) => void }>)[
      Object.keys(el).find((k) => k.startsWith("__reactProps"))!
    ]!;
    props.onChange!({ target: el, currentTarget: el });
  });
};
const submit = async (formOf: string) => {
  const form = input(formOf).closest("form")!;
  await act(async () => {
    form.dispatchEvent(new win.Event("submit", { bubbles: true, cancelable: true }) as never);
  });
  await settle();
};
const button = (label: string) =>
  [...win.document.querySelectorAll("button")].find((b) => b.textContent?.trim() === label) as
    | HTMLButtonElement
    | undefined;
const press = async (label: string) => {
  const b = button(label);
  if (!b) throw new Error(`no button "${label}" in: ${text()}`);
  await act(
    async () => void b.dispatchEvent(new win.MouseEvent("click", { bubbles: true }) as never),
  );
  await settle();
};

async function mount() {
  calls.length = 0;
  profile = { name: "Ada Lovelace", email: "ada@example.invalid", avatar: null };
  passwordAnswer = "ok";
  const { PreferencesPage } = await import("./preferences-page");
  const { PreferencesProvider } = await import("./preferences");
  const host = win.document.createElement("div");
  win.document.body.replaceChildren(host);
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  await act(async () => {
    createRoot(host as unknown as Element).render(
      <QueryClientProvider client={client}>
        <PreferencesProvider>
          <PreferencesPage />
        </PreferencesProvider>
      </QueryClientProvider>,
    );
  });
  await settle(80);
}
const writes = () => calls.filter((c) => c.method !== "GET");

test("the profile shows the saved name, and the email cannot be edited", async () => {
  await mount();
  expect(input("name").value).toBe("Ada Lovelace");
  expect(input("email").value).toBe("ada@example.invalid");
  expect(input("email").readOnly).toBe(true);
  expect(text()).toContain("Email can't be changed here.");
  expect(button("Save profile")?.disabled).toBe(true);
});

test("saving a new name sends only the name", async () => {
  await mount();
  await type("name", "Ada King");
  expect(button("Save profile")?.disabled).toBe(false);
  await submit("name");
  expect(writes()).toEqual([{ method: "PATCH", path: "/api/profile", body: { name: "Ada King" } }]);
});

test("a confirmation that does not match is refused before any request", async () => {
  await mount();
  await type("current-password", "old-password-1");
  await type("new-password", "new-password-2");
  await type("confirm-password", "new-password-3");
  await submit("current-password");
  expect(text()).toContain("Passwords do not match.");
  expect(writes()).toEqual([]);
});

test("a new password that is too short is refused before any request", async () => {
  await mount();
  await type("current-password", "old-password-1");
  await type("new-password", "short");
  await type("confirm-password", "short");
  await submit("current-password");
  expect(text()).toContain("Use 8 to 128 characters.");
  expect(writes()).toEqual([]);
});

test("a valid password change signs out the other devices by default", async () => {
  await mount();
  await type("current-password", "old-password-1");
  await type("new-password", "new-password-2");
  await type("confirm-password", "new-password-2");
  await submit("current-password");
  expect(writes()).toEqual([
    {
      method: "POST",
      path: "/api/auth/change-password",
      body: {
        currentPassword: "old-password-1",
        newPassword: "new-password-2",
        revokeOtherSessions: true,
      },
    },
  ]);
  expect(input("current-password").value).toBe("");
});

test("a wrong current password is explained", async () => {
  await mount();
  passwordAnswer = "wrong";
  await type("current-password", "not-my-password");
  await type("new-password", "new-password-2");
  await type("confirm-password", "new-password-2");
  await submit("current-password");
  expect(text()).toContain("Current password is incorrect.");
  expect(input("new-password").value).toBe("new-password-2");
});

test("the session list marks this device and names each browser", async () => {
  await mount();
  expect(text()).toContain("Firefox on macOS");
  expect(text()).toContain("Chrome on Windows");
  expect(text().match(/This device/g)).toHaveLength(1);
  expect(text()).toContain("203.0.113.7 · Signed in 5m ago");
  expect(text()).toContain("Unknown address · Signed in 3d ago");
});

test("signing out the other devices asks first, then calls the endpoint once", async () => {
  await mount();
  await press("Sign out other devices");
  expect(writes()).toEqual([]);
  await press("Sign out");
  expect(writes()).toEqual([{ method: "POST", path: "/api/auth/revoke-other-sessions", body: {} }]);
});

test("choosing the 12-hour format saves it", async () => {
  await mount();
  const radio = [...win.document.querySelectorAll('input[name="time-format"]')].find((r) =>
    r.closest("label")?.textContent?.includes("12-hour"),
  ) as unknown as HTMLInputElement;
  await act(
    async () => void radio.dispatchEvent(new win.MouseEvent("click", { bubbles: true }) as never),
  );
  await settle(500);
  expect(writes()).toEqual([
    { method: "PATCH", path: "/api/preferences", body: { timeFormat: "12h" } },
  ]);
});

test("the sidebar is on the left by default, and choosing the right saves it", async () => {
  await mount();
  const radio = (label: string) =>
    [...win.document.querySelectorAll('input[name="sidebar-side"]')].find((r) =>
      r.closest("label")?.textContent?.includes(label),
    ) as unknown as HTMLInputElement;
  expect(radio("Left").checked).toBe(true);
  expect(radio("Right").checked).toBe(false);
  expect(text()).toContain("Left (default)");

  await act(
    async () =>
      void radio("Right").dispatchEvent(new win.MouseEvent("click", { bubbles: true }) as never),
  );
  await settle(500);
  expect(writes()).toEqual([
    { method: "PATCH", path: "/api/preferences", body: { sidebarSide: "right" } },
  ]);
  expect(radio("Right").checked).toBe(true);
});

test("approving by press and hold is the default, and choosing a plain click saves it", async () => {
  await mount();
  const radio = (label: string) =>
    [...win.document.querySelectorAll('input[name="approval-mode"]')].find((r) =>
      r.closest("label")?.textContent?.includes(label),
    ) as unknown as HTMLInputElement;
  expect(radio("Press and hold").checked).toBe(true);
  expect(radio("Just click").checked).toBe(false);
  expect(text()).toContain("Press and hold (default)");

  await act(
    async () =>
      void radio("Just click").dispatchEvent(
        new win.MouseEvent("click", { bubbles: true }) as never,
      ),
  );
  await settle(500);
  expect(writes()).toEqual([
    { method: "PATCH", path: "/api/preferences", body: { approvalMode: "click" } },
  ]);
});

const html = () => win.document.documentElement;
const resetLook = () => {
  delete html().dataset.theme;
  html().removeAttribute("style");
};
// The cards draw a sample ("Aa" and "~/") next to each name; only the name is read by a person using a screen reader.
const themeName = (radio: Element) => radio.closest("label")?.textContent?.replaceAll("Aa~/", "");
const chooseTheme = async (label: string) => {
  const radio = [...win.document.querySelectorAll('input[name="theme"]')].find((r) =>
    r.closest("label")?.textContent?.includes(label),
  ) as unknown as HTMLInputElement;
  await act(
    async () => void radio.dispatchEvent(new win.MouseEvent("click", { bubbles: true }) as never),
  );
  await settle(500);
};

test("choosing Nord saves it on the account and puts it on the page", async () => {
  resetLook();
  await mount();
  await chooseTheme("Nord");
  expect(writes()).toEqual([
    { method: "PATCH", path: "/api/preferences", body: { theme: "nord" } },
  ]);
  expect(html().dataset.theme).toBe("nord");
  const checked = [...win.document.querySelectorAll('input[name="theme"]')].filter(
    (r) => (r as unknown as HTMLInputElement).checked,
  );
  expect((checked as unknown as Element[]).map(themeName)).toEqual(["Nord"]);
});

test("the picker offers the nine themes, grouped by light and dark", async () => {
  await mount();
  const names = (
    [...win.document.querySelectorAll('input[name="theme"]')] as unknown as Element[]
  ).map(themeName);
  expect(names).toEqual([
    "Same as my device",
    "Light",
    "Darcula Light",
    "Dark",
    "Darcula",
    "Catppuccin",
    "Tokyo Night",
    "One Dark",
    "Nord",
  ]);
});

test("choosing Light takes the color theme off the page", async () => {
  resetLook();
  html().dataset.theme = "nord";
  await mount();
  await chooseTheme("Light");
  expect(writes()).toEqual([
    { method: "PATCH", path: "/api/preferences", body: { theme: "light" } },
  ]);
  expect(html().dataset.theme).toBeUndefined();
});

test("a main color is saved and applied, and the theme color brings the theme's own back", async () => {
  resetLook();
  await mount();
  await type("primary-color", "#cc3300");
  await settle(500);
  expect(writes()).toEqual([
    { method: "PATCH", path: "/api/preferences", body: { primaryColor: "#cc3300" } },
  ]);
  expect(html().style.getPropertyValue("--primary")).toBe("#cc3300");
  expect(html().style.getPropertyValue("--primary-foreground")).toBe("#ffffff");

  await press("Use the theme color");
  await settle(500);
  expect(writes().at(-1)).toEqual({
    method: "PATCH",
    path: "/api/preferences",
    body: { primaryColor: null },
  });
  expect(html().style.getPropertyValue("--primary")).toBe("");
});

test("a main color under 5:1 on the theme shows a warning, a strong one does not", async () => {
  resetLook();
  for (const ground of ["--background", "--card", "--sidebar", "--muted", "--accent", "--popover"])
    html().style.setProperty(ground, "#ffffff");
  await mount();
  await type("primary-color", "#ffff66");
  await settle(80);
  expect(text()).toContain("contrast on this theme");
  await type("primary-color", "#003366");
  await settle(80);
  expect(text()).not.toContain("contrast on this theme");
});
