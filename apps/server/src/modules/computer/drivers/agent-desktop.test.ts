import { describe, expect, test } from "bun:test";
import { ComputerError } from "../service";
import { createAgentDesktopDriver, type Run } from "./agent-desktop";
import { Passthrough } from "./types";

// Fixtures are agent-desktop 1.1.0 output recorded on the zetta-desktop image (Xtigervnc, XFCE, Chromium).
const fixture = (name: string) => Bun.file(`${import.meta.dir}/fixtures/${name}.json`).text();
const example = await fixture("agent-desktop-example");
const login = await fixture("agent-desktop-login");
const windows = await fixture("agent-desktop-windows");
const ok = (command: string, data: unknown) =>
  JSON.stringify({ version: "2.6", ok: true, command, data });
const refused = (command: string, code: string) =>
  JSON.stringify({ version: "2.6", ok: false, command, error: { code } });

type Reply = (args: string[]) => string | undefined;
/** The container boundary: answers each agent-desktop command with a recorded envelope and remembers what was run. */
function container(snapshot: string, extra: Reply = () => undefined) {
  const cli: string[][] = [];
  const keys: string[][] = [];
  const runCli: Run = async (args) => {
    cli.push(args);
    const custom = extra(args);
    if (custom !== undefined) return { code: 0, stdout: custom };
    const [cmd] = args;
    if (cmd === "snapshot") return { code: 0, stdout: snapshot };
    if (cmd === "list-windows") return { code: 0, stdout: windows };
    return { code: 0, stdout: ok(cmd!, {}) };
  };
  const xdotool: Run = async (args) => {
    keys.push(args);
    return { code: 0, stdout: "" };
  };
  return { driver: createAgentDesktopDriver({ cli: runCli, xdotool }), cli, keys };
}
const code = (p: Promise<unknown>) =>
  p.then(
    () => "ok",
    (e) => (e instanceof ComputerError ? e.code : `other:${(e as Error).message}`),
  );

describe("agent-desktop driver", () => {
  test("reads a page as numbered text, with the window title", async () => {
    const { driver } = container(example);
    const r = await driver.read({});
    expect(r).toEqual({
      kind: "page",
      title: "Example Domain - Chromium",
      body: expect.stringContaining('[0] link "Learn more" (off-screen)'),
    });
    expect((r as { body: string }).body.startsWith("This domain is for use in documentation")).toBe(
      true,
    );
  });

  test("a form page lists its inputs, hides what a password field holds, and numbers links and buttons", async () => {
    const { driver } = container(login);
    const r = await driver.read({});
    expect(r).toEqual({
      kind: "page",
      title: "Example Domain - Chromium",
      body: [
        "Sign in",
        "Username",
        '[0] textfield "Username"',
        "Password",
        '[1] textfield "Password" (password)',
        '[2] link "Home"',
        '[3] button "Go"',
      ].join("\n"),
    });
  });

  test("click_element clicks the element the last read numbered", async () => {
    const { driver, cli } = container(login);
    await driver.read({});
    await driver.act({ type: "click_element", n: 2 });
    expect(cli.at(-1)).toEqual(["click", "@s14ptx5leyzhia:e64"]);
  });

  test("click_element before any read finds nothing; a stale ref is looked up again by its label", async () => {
    const first = container(login);
    expect(await code(first.driver.act({ type: "click_element", n: 0 }))).toBe("NO_ELEMENT");

    let clicks = 0;
    const { driver, cli } = container(login, (args) =>
      args[0] === "click" && ++clicks === 1 ? refused("click", "STALE_REF") : undefined,
    );
    await driver.read({});
    await driver.act({ type: "click_element", n: 3 });
    expect(cli.filter((a) => a[0] === "click").length).toBe(2);
    expect(cli.filter((a) => a[0] === "snapshot").length).toBe(2); // the read, then the lookup
  });

  test("click_element fails with NO_ELEMENT when the label is gone after the page changed", async () => {
    let clicks = 0;
    const { driver } = container(login, (args) => {
      if (args[0] === "click" && ++clicks === 1) return refused("click", "STALE_REF");
      if (args[0] === "snapshot" && clicks === 1) return example; // another page now
      return undefined;
    });
    await driver.read({});
    expect(await code(driver.act({ type: "click_element", n: 3 }))).toBe("NO_ELEMENT");
  });

  test("keys go through xdotool with its names; an odd key name is refused", async () => {
    const { driver, keys, cli } = container(example);
    await driver.act({ type: "key", key: "Enter" });
    await driver.act({ type: "key", key: "ctrl+l" });
    expect(keys).toEqual([
      ["key", "Return"],
      ["key", "ctrl+l"],
    ]);
    expect(await code(driver.act({ type: "key", key: "ctrl+l; rm -rf /" }))).toBe("INVALID");
    expect(cli).toEqual([]); // agent-desktop's own `press` is never used: it crashes Chromium on the VM display
  });

  test("navigate focuses the address bar, types the address and presses Enter", async () => {
    const { driver, keys } = container(example);
    await driver.act({ type: "navigate", url: "https://example.com/a?b=1" });
    expect(keys).toEqual([
      ["key", "ctrl+l"],
      ["type", "--clearmodifiers", "--delay", "6", "--", "https://example.com/a?b=1"],
      ["key", "Return"],
    ]);
  });

  test("typing goes into the focused input through its ref, and into the window as keystrokes otherwise", async () => {
    const focused = JSON.stringify({
      ok: true,
      data: {
        tree: {
          role: "window",
          children: [{ role: "textfield", name: "Search", ref_id: "@s1:e5", states: ["focused"] }],
        },
      },
    });
    const withFocus = container(focused);
    await withFocus.driver.act({ type: "type", text: "hello" });
    expect(withFocus.cli.at(-1)).toEqual(["type", "--headed", "--", "@s1:e5", "hello"]);
    expect(withFocus.keys).toEqual([]);

    const without = container(login);
    await without.driver.act({ type: "type", text: "hello" });
    expect(without.keys).toEqual([["type", "--clearmodifiers", "--delay", "6", "--", "hello"]]);
  });

  test("clicks by coordinate, scrolls with the wheel, launches an app", async () => {
    const { driver, cli } = container(example);
    await driver.act({ type: "click", x: 100.4, y: 200.6 });
    await driver.act({ type: "scroll", direction: "down", amount: 5 });
    await driver.act({ type: "scroll", direction: "left" });
    await driver.act({ type: "launch", app: "xfce4-terminal" });
    expect(cli).toEqual([
      ["mouse-click", "--xy=100,201", "--headed"],
      ["mouse-wheel", "--x", "640", "--y", "400", "--dy", "-5", "--dx", "0", "--headed"],
      ["mouse-wheel", "--x", "640", "--y", "400", "--dy", "0", "--dx", "-3", "--headed"],
      ["launch", "--", "xfce4-terminal"],
    ]);
  });

  test("a refused command is UNAVAILABLE; output that is not an envelope means the container is gone", async () => {
    const refusing = container(example, (a) =>
      a[0] === "mouse-click" ? refused("mouse-click", "POLICY_DENIED") : undefined,
    );
    expect(await code(refusing.driver.act({ type: "click", x: 1, y: 1 }))).toBe("UNAVAILABLE");

    const gone = createAgentDesktopDriver({
      cli: async () => ({ code: 125, stdout: "Error: no such container" }),
      xdotool: async () => ({ code: 125, stdout: "" }),
    });
    expect(await code(gone.act({ type: "click", x: 1, y: 1 }))).toBe(
      "other:agent-desktop gave no envelope",
    );
  });

  test("a stopped turn is CANCELLED, not a lost connection", async () => {
    const stop = new AbortController();
    const driver = createAgentDesktopDriver({
      cli: async () => {
        stop.abort();
        return { code: 143, stdout: "" };
      },
      xdotool: async () => ({ code: 0, stdout: "" }),
    });
    expect(await code(driver.act({ type: "click", x: 1, y: 1 }, { signal: stop.signal }))).toBe(
      "CANCELLED",
    );
  });

  test("the screen is captured whole, or by window when the window manager refuses", async () => {
    const whole = container(example, (a) =>
      a[0] === "screenshot" ? ok("screenshot", { data: "AAAA", format: "png" }) : undefined,
    );
    expect(await whole.driver.screenshot()).toBe("AAAA");

    const byWindow = container(example, (a) =>
      a[0] === "screenshot"
        ? a.includes("--screen")
          ? refused("screenshot", "PLATFORM_NOT_SUPPORTED")
          : ok("screenshot", { data: "BBBB", format: "png" })
        : undefined,
    );
    expect(await byWindow.driver.screenshot()).toBe("BBBB");
    expect(byWindow.cli.at(-1)).toEqual([
      "screenshot",
      "--window-id",
      "w-1.11-org-a11y-atspi-accessible-1",
    ]);
  });

  test("no browser window: the read says what is open", async () => {
    const { driver } = container(example, (a) =>
      a[0] === "list-windows" ? ok("list-windows", []) : undefined,
    );
    expect(await driver.read({})).toEqual({ kind: "plain", text: "No windows are open." });
  });
});

describe("agent-desktop credential fill", () => {
  // A small https sign-in page as agent-desktop reports it: the address without its scheme, a site-information badge, two inputs.
  const secure = JSON.stringify({
    ok: true,
    data: {
      tree: {
        role: "window",
        children: [
          { role: "textfield", name: "Address and search bar", ref_id: "@s9:e13" },
          { role: "button", name: "View site information", ref_id: "@s9:e12" },
          {
            role: "webarea",
            ref_id: "@s9:e61",
            children: [
              {
                role: "textfield",
                name: "Username or email address",
                ref_id: "@s9:e62",
                bounds: { x: 10, y: 200, width: 300, height: 30 },
              },
              {
                role: "textfield",
                name: "Password",
                ref_id: "@s9:e63",
                states: ["secure"],
                bounds: { x: 10, y: 260, width: 300, height: 30 },
              },
            ],
          },
        ],
      },
    },
  });
  const address = (a: string[]) =>
    a[0] === "get" ? ok("get", { property: "value", value: "github.com/login" }) : undefined;

  test("the password goes into the password input only, at the address the grant is checked against", async () => {
    const { driver, cli } = container(secure, address);
    const seen: string[] = [];
    const done = await driver.fillCredential("password", async (url) => {
      seen.push(url);
      return "s3cret-value";
    });
    expect(done).toEqual({ label: "Password" });
    expect(seen).toEqual(["https://github.com/login"]);
    expect(cli.at(-1)).toEqual(["type", "--headed", "--", "@s9:e63", "s3cret-value"]);
  });

  test("a username goes into the username input", async () => {
    const { driver, cli } = container(secure, address);
    await driver.fillCredential("username", async () => "octocat");
    expect(cli.at(-1)).toEqual(["type", "--headed", "--", "@s9:e62", "octocat"]);
  });

  test("a page that is not secure gets nothing", async () => {
    const { driver, cli } = container(login);
    let asked = false;
    expect(
      await code(
        driver.fillCredential("password", async () => {
          asked = true;
          return "x";
        }),
      ),
    ).toBe("INSECURE");
    expect(asked).toBe(false);
    expect(cli.some((a) => a[0] === "type")).toBe(false);
  });

  test("a refusal from the grant reaches the caller as it is, and nothing is typed", async () => {
    const { driver, cli } = container(secure, address);
    const refusal = new Error("grant refused");
    const err = await driver
      .fillCredential("password", async () => {
        throw refusal;
      })
      .catch((e: unknown) => e);
    expect(err).toBeInstanceOf(Passthrough);
    expect((err as Passthrough).error).toBe(refusal);
    expect(cli.some((a) => a[0] === "type")).toBe(false);
  });

  test("no matching input or no address: nothing is typed", async () => {
    const { driver } = container(secure, address);
    expect(await code(driver.fillCredential("totp", async () => "123456"))).toBe("NO_INPUT");
    const blank = container(secure, (a) =>
      a[0] === "get" ? ok("get", { property: "value", value: "" }) : undefined,
    );
    expect(await code(blank.driver.fillCredential("password", async () => "x"))).toBe("NO_ADDRESS");
  });
});
