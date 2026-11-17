import { afterEach, describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { Window } from "happy-dom";

import type { ServerEntry } from "../bun/registry";
import type { AddServerResult } from "../shared/launcher-rpc";
import { installElectrobunFake, launcherFake } from "../test-support/electrobun-fake";

/**
 * The launcher page (`index.html` + `index.ts`) run for real in a fake browser (happy-dom). The main process is replaced by the test, which
 * decides what each request answers and sees what the page asked for.
 */
installElectrobunFake();

const page = readFileSync(new URL("./index.html", import.meta.url), "utf8");
const body = page.match(/<main>[\s\S]*<\/main>/)![0]; // the page without the script and style tags: the test loads the script itself

const entry = (id: string, name: string, lastOpenedAt: string | null = null): ServerEntry => ({
  id,
  name,
  kind: "remote",
  webOrigin: `https://${id}.example.invalid`,
  apiOrigin: `https://${id}.example.invalid`,
  lastOpenedAt,
});
const added = (server: ServerEntry, sharesCookiesWith: string[] = []): AddServerResult => ({
  status: "added",
  server,
  sharesCookiesWith,
});

/** Lets the page's promises settle (a timer of 0 ms is never the 4 s one the remove button waits on). */
const settle = () => new Promise((resolve) => setTimeout(resolve, 0));

type Answers = {
  addServer?: (params: { address: string }) => Promise<AddServerResult>;
};

let window: Window | undefined;
const loads = { count: 0 }; // every load of the page script is a fresh copy of it
afterEach(() => {
  delete (globalThis as { document?: unknown }).document;
  window = undefined;
});

async function open(servers: ServerEntry[] = [], answers: Answers = {}) {
  launcherFake.reset();
  window = new Window({ url: "http://localhost/" });
  window.document.body.innerHTML = body;
  Object.defineProperty(globalThis, "document", {
    value: window.document,
    configurable: true,
    writable: true,
  });

  const asked = {
    list: 0,
    add: [] as string[],
    open: [] as string[],
    remove: [] as string[],
  };
  launcherFake.request = {
    listServers: async () => (asked.list++, servers),
    addServer: async (params) => {
      const { address } = params as { address: string };
      asked.add.push(address);
      return answers.addServer
        ? answers.addServer({ address })
        : added(entry("new", "new.example.invalid"));
    },
    openServer: async (params) => (asked.open.push((params as { id: string }).id), true),
    removeServer: async (params) => (asked.remove.push((params as { id: string }).id), true),
  };
  await import(`./index.ts?launcher=${++loads.count}`);
  await settle();

  const doc = window.document;
  const q = <T extends Element>(selector: string) => doc.querySelector(selector) as unknown as T;
  return {
    asked,
    doc,
    form: q<HTMLFormElement>("#add"),
    address: q<HTMLInputElement>("#address"),
    note: q<HTMLElement>("#status"),
    empty: q<HTMLElement>("#empty"),
    submitButton: q<HTMLButtonElement>("#add button"),
    rows: () => [...doc.querySelectorAll("#servers li")] as unknown as HTMLLIElement[],
    names: () => [...doc.querySelectorAll("#servers .name")].map((el) => el.textContent),
    button: (row: HTMLLIElement, text: string) =>
      [...row.querySelectorAll("button")].find((b) => b.textContent === text) as HTMLButtonElement,
    /** Types the address and submits the form. Returns the submit event, to see whether the page cancelled it. */
    submit: async (value: string, form: HTMLFormElement, input: HTMLInputElement) => {
      input.value = value;
      const event = new window!.Event("submit", { cancelable: true }) as unknown as Event;
      form.dispatchEvent(event);
      await settle();
      return event;
    },
  };
}

describe("the server list", () => {
  test("is asked for when the page opens, and an empty list says how to add the first server", async () => {
    const { asked, empty, rows } = await open([]);
    expect(asked.list).toBe(1);
    expect(rows()).toHaveLength(0);
    expect(empty.hidden).toBe(false);
    expect(empty.textContent).toContain("Add the address of your Zetta server");
  });

  test("shows each server's name and address, the most recently opened first, then by name", async () => {
    const { names, rows, empty } = await open([
      entry("c", "Charlie"),
      entry("a", "Alpha"),
      entry("old", "Old", "2026-11-01T10:00:00.000Z"),
      entry("new", "New", "2026-11-10T10:00:00.000Z"),
    ]);
    expect(names()).toEqual(["New", "Old", "Alpha", "Charlie"]);
    expect(empty.hidden).toBe(true);
    expect(rows()[0]!.querySelector(".origin")!.textContent).toBe("https://new.example.invalid");
  });

  test("a list sent by the app replaces what is on screen", async () => {
    const { names, empty } = await open([entry("a", "Alpha")]);
    launcherFake.handlers!.messages.serversChanged!([
      entry("b", "Beta"),
      entry("c", "Carol"),
    ] as never);
    expect(names()).toEqual(["Beta", "Carol"]);

    launcherFake.handlers!.messages.serversChanged!([] as never);
    expect(names()).toEqual([]);
    expect(empty.hidden).toBe(false);
  });

  test("Open asks the app to open that server", async () => {
    const { asked, rows, button } = await open([entry("a", "Alpha"), entry("b", "Beta")]);
    button(rows()[1]!, "Open").click();
    await settle();
    expect(asked.open).toEqual(["b"]);
  });
});

describe("removing a server", () => {
  /** The remove button waits 4 seconds for its confirmation: the test takes that timer and runs it by hand. */
  async function withTimers<T>(run: (lapse: () => void) => Promise<T>) {
    const timers: (() => void)[] = [];
    const real = globalThis.setTimeout;
    globalThis.setTimeout = ((fn: () => void, ms?: number, ...rest: unknown[]) =>
      ms === 4_000 ? (timers.push(fn), 0) : real(fn, ms, ...rest)) as unknown as typeof setTimeout;
    try {
      return await run(() => timers.splice(0).forEach((fn) => fn()));
    } finally {
      globalThis.setTimeout = real;
    }
  }

  test("one click only asks to confirm; the second click removes", async () => {
    await withTimers(async () => {
      const { asked, rows, button } = await open([entry("a", "Alpha")]);
      const remove = button(rows()[0]!, "Remove");
      remove.click();
      expect(remove.textContent).toBe("Confirm remove");
      expect(asked.remove).toEqual([]);

      remove.click();
      await settle();
      expect(asked.remove).toEqual(["a"]);
    });
  });

  test("the question lapses after a few seconds and asks again", async () => {
    await withTimers(async (lapse) => {
      const { asked, rows, button } = await open([entry("a", "Alpha")]);
      const remove = button(rows()[0]!, "Remove");
      remove.click();
      expect(remove.textContent).toBe("Confirm remove");

      lapse();
      expect(remove.textContent).toBe("Remove");
      remove.click(); // a fresh first click: asks again, removes nothing
      expect(remove.textContent).toBe("Confirm remove");
      expect(asked.remove).toEqual([]);
    });
  });
});

describe("adding a server", () => {
  test("checks the address, then confirms and clears the field", async () => {
    let answer!: (result: AddServerResult) => void;
    const { asked, form, address, note, submitButton, submit } = await open([], {
      addServer: () => new Promise((resolve) => (answer = resolve)),
    });

    await submit("zetta.example.invalid", form, address);
    expect(asked.add).toEqual(["zetta.example.invalid"]);
    expect(note.textContent).toBe("Checking the server...");
    expect(submitButton.disabled).toBe(true);

    answer(added(entry("z", "zetta.example.invalid")));
    await settle();
    expect(note.textContent).toBe("Added zetta.example.invalid.");
    expect(note.className).toBe("");
    expect(address.value).toBe("");
    expect(submitButton.disabled).toBe(false);
  });

  test("sends the address without the spaces around it", async () => {
    const { asked, form, address, submit } = await open();
    await submit("   zetta.example.invalid  ", form, address);
    expect(asked.add).toEqual(["zetta.example.invalid"]);
  });

  test("never lets the form reload the page, with an address or without one", async () => {
    const { form, address, submit } = await open();
    expect((await submit("zetta.example.invalid", form, address)).defaultPrevented).toBe(true);
    expect((await submit("", form, address)).defaultPrevented).toBe(true);
  });

  test("an empty address asks nothing", async () => {
    const { asked, form, address, note, submit } = await open();
    await submit("    ", form, address);
    expect(asked.add).toEqual([]);
    expect(note.textContent).toBe("");
  });

  test("a server on the same host as another says that signing in to one signs out the other", async () => {
    const { form, address, note, submit } = await open([], {
      addServer: async () => added(entry("b", "Beta"), ["Alpha", "Gamma"]),
    });
    await submit("localhost:4000", form, address);
    expect(note.textContent).toBe(
      "Added Beta. It is on the same host as Alpha, Gamma: signing in to one signs you out of the other.",
    );
  });

  const problems: [Exclude<AddServerResult["status"], "added">, string][] = [
    ["invalid-address", "That is not a web address. Use something like zetta.example.com."],
    ["unreachable", "Could not reach that address. Check it and your connection."],
    ["not-zetta", "That address answered, but it is not a Zetta server this app can use."],
    ["newer-protocol", "That server needs a newer version of this app."],
  ];
  for (const [status, sentence] of problems)
    test(`says so in plain words when the address is ${status}, and keeps what was typed`, async () => {
      const { form, address, note, submit } = await open([], {
        addServer: async () => ({ status }),
      });
      await submit("zetta.example.invalid", form, address);
      expect(note.textContent).toBe(sentence);
      expect(note.className).toBe("error");
      expect(address.value).toBe("zetta.example.invalid");
    });

  test("an unexpected failure says so and lets the person try again", async () => {
    const { form, address, note, submitButton, submit } = await open([], {
      addServer: async () => {
        throw new Error("the channel closed");
      },
    });
    await submit("zetta.example.invalid", form, address);
    expect(note.textContent).toBe("Something went wrong. Try again.");
    expect(note.className).toBe("error");
    expect(submitButton.disabled).toBe(false);
  });

  test("a zetta://add link fills the address and asks the person to check it, without adding it", async () => {
    const { asked, doc, address, note } = await open();
    launcherFake.handlers!.messages.promptAdd!("https://zetta.example.invalid" as never);
    expect(address.value).toBe("https://zetta.example.invalid");
    expect(doc.activeElement?.id).toBe("address"); // the launcher calls `address.focus()`
    expect(note.textContent).toBe(
      'Check this address, then press "Add server": https://zetta.example.invalid',
    );
    expect(asked.add).toEqual([]);
  });
});

describe("the page itself", () => {
  test("opens the channel to the app once", async () => {
    await open();
    expect(launcherFake.created).toBe(1);
  });
});
