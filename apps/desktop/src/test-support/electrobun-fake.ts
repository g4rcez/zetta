import { mock } from "bun:test";

/**
 * A recording stand-in for the Electrobun runtime (`electrobun/bun` in the main process, `electrobun/view` in the launcher page).
 * The real one needs a native webview, so no test could open a window. This one keeps every window, view, tray and call in memory, so the
 * app's own code (windows, tray, the entry point, the launcher page) runs for real on top of it and a test can read what it did.
 *
 * Assumption, not verified against a running app: closing a window from code (`window.close()`) closes it, and only the person pressing the
 * close button raises `will-close` first. `userClose` models that button.
 */

type Handler = (event: unknown) => void;

class Emitter {
  private handlers = new Map<string, Handler[]>();
  on(name: string, handler: Handler) {
    this.handlers.set(name, [...(this.handlers.get(name) ?? []), handler]);
  }
  emit(name: string, event: unknown = {}) {
    // A copy, so a handler that registers another one does not change what this call runs.
    for (const handler of (this.handlers.get(name) ?? []).slice()) handler(event);
  }
  clear() {
    this.handlers.clear();
  }
}

let nextId = 1;

export type WindowOptions = {
  title?: string;
  url?: string | null;
  frame?: { width: number; height: number; x?: number; y?: number };
  rpc?: unknown;
  renderer?: string;
  sandbox?: boolean;
  allowedProtocols?: Record<string, boolean>;
};

export class FakeBrowserWindow {
  readonly id = nextId++;
  /** The view a window creates for itself; the app removes it when it puts its own view in. */
  readonly webviewId = nextId++;
  hidden = false;
  closed = false;
  shown = 0;
  private events = new Emitter();
  constructor(readonly options: WindowOptions) {
    fake.windows.push(this);
  }
  on(name: string, handler: Handler) {
    this.events.on(name, handler);
  }
  emit(name: string, event: unknown = {}) {
    this.events.emit(name, event);
  }
  show() {
    this.hidden = false;
    this.shown++;
  }
  hide() {
    this.hidden = true;
  }
  close() {
    if (this.closed) return;
    this.closed = true;
    this.events.emit("close");
  }
}

export type ViewOptions = WindowOptions & { windowId?: number };

export type FakeRpc = {
  handlers: {
    requests: Record<string, (params: never) => unknown>;
    messages: Record<string, (payload: never) => unknown>;
  };
  /** What the main process sent to the page: `{ name, args }` per call. */
  sent: { name: string; args: unknown[] }[];
  send: Record<string, (...args: unknown[]) => void>;
};

export class FakeBrowserView {
  readonly id = nextId++;
  readonly executed: string[] = [];
  private events = new Emitter();
  constructor(readonly options: ViewOptions) {
    fake.views.push(this);
  }
  on(name: string, handler: Handler) {
    this.events.on(name, handler);
  }
  emit(name: string, event: unknown = {}) {
    this.events.emit(name, event);
  }
  executeJavascript(code: string) {
    this.executed.push(code);
  }
  static getById(id: number) {
    return { remove: () => void fake.removedViewIds.push(id) };
  }
  static defineRPC(config: { handlers: FakeRpc["handlers"] }): FakeRpc {
    const sent: FakeRpc["sent"] = [];
    const send = new Proxy({} as FakeRpc["send"], {
      get:
        (_target, name) =>
        (...args: unknown[]) => {
          // The real channel throws while the launcher window has no page.
          if (fake.sendFails) throw new Error("NO_WEBVIEW");
          sent.push({ name: String(name), args });
        },
    });
    const rpc: FakeRpc = { handlers: config.handlers, sent, send };
    fake.rpcs.push(rpc);
    return rpc;
  }
}

export type TrayMenuItem = { type: string; label?: string; action?: string; data?: unknown };

export class FakeTray {
  menu: TrayMenuItem[] = [];
  private events = new Emitter();
  constructor(readonly options: Record<string, unknown>) {
    fake.trays.push(this);
  }
  on(name: string, handler: Handler) {
    this.events.on(name, handler);
  }
  setMenu(menu: TrayMenuItem[]) {
    this.menu = menu;
  }
  /** The person chose a menu entry. */
  click(action: string, data?: unknown) {
    this.events.emit("tray-clicked", { data: { action, ...(data === undefined ? {} : { data }) } });
  }
  emit(name: string, event: unknown) {
    this.events.emit(name, event);
  }
}

/** The state of the fake runtime. Call `fake.reset()` before every test. */
export const fake = {
  windows: [] as FakeBrowserWindow[],
  views: [] as FakeBrowserView[],
  trays: [] as FakeTray[],
  rpcs: [] as FakeRpc[],
  removedViewIds: [] as number[],
  shownInFolder: [] as string[],
  openedExternal: [] as string[],
  quits: 0,
  appMenu: undefined as unknown,
  /** What `Updater.localInfo.channel()` answers: `dev`, `canary` or `stable`. */
  channel: "stable",
  /** `Utils.paths.userData`: a folder the test made. */
  userData: "",
  /** Makes `rpc.send.*` throw, as it does while the launcher has no open window. */
  sendFails: false,
  /** `Electrobun.events`: `reopen`, `before-quit`, `new-window-open-<view id>`. */
  events: new Emitter(),
  reset() {
    this.windows = [];
    this.views = [];
    this.trays = [];
    this.rpcs = [];
    this.removedViewIds = [];
    this.openedExternal = [];
    this.shownInFolder = [];
    this.quits = 0;
    this.appMenu = undefined;
    this.channel = "stable";
    this.userData = "";
    this.sendFails = false;
    this.events.clear();
    nextId = 1;
  },
  /** The person presses a window's close button: the app is asked first (`will-close`), and the window closes unless it said no. */
  userClose(window: FakeBrowserWindow) {
    const event = { response: { allow: true } };
    window.emit("will-close", event);
    if (event.response.allow !== false) window.close();
  },
};

const electrobunBun = {
  default: { events: fake.events },
  BrowserWindow: FakeBrowserWindow,
  BrowserView: FakeBrowserView,
  Tray: FakeTray,
  Utils: {
    get paths() {
      return { userData: fake.userData };
    },
    openExternal: (url: string) => void fake.openedExternal.push(url),
    quit: () => void fake.quits++,
    showItemInFolder: (path: string) => void fake.shownInFolder.push(path),
  },
  Updater: { localInfo: { channel: async () => fake.channel } },
  ApplicationMenu: { setApplicationMenu: (menu: unknown) => void (fake.appMenu = menu) },
};

/** The launcher page's side of the channel: the test decides how the main process answers each request. */
export const launcherFake = {
  handlers: undefined as FakeRpc["handlers"] | undefined,
  request: {} as Record<string, (params: unknown) => Promise<unknown>>,
  created: 0,
  reset() {
    this.handlers = undefined;
    this.request = {};
    this.created = 0;
  },
};

class FakeElectroview {
  static defineRPC(config: { handlers: FakeRpc["handlers"] }) {
    launcherFake.handlers = config.handlers;
    return {
      request: new Proxy(
        {},
        {
          get: (_target, name) => (params: unknown) => launcherFake.request[String(name)]!(params),
        },
      ),
    };
  }
  constructor(readonly options: unknown) {
    launcherFake.created++;
  }
}

/**
 * Electrobun 2.x does not ship its runtime through npm: `electrobun/bun` and `electrobun/view` both resolve to one file in node_modules
 * that only throws (the SDK is projected into `.hutch/devkit` by `electrobun prepare`). Bun keys a module mock by that resolved file, so two
 * mocks for the two specifiers would overwrite each other. One module with everything in it answers both, whether or not the SDK was
 * projected on this machine.
 */
const electrobunModule = { ...electrobunBun, Electroview: FakeElectroview };

/** Puts the fake in place of `electrobun/bun` and `electrobun/view`. Call it before anything from the app is imported. */
export function installElectrobunFake() {
  mock.module("electrobun/bun", () => electrobunModule);
  mock.module("electrobun/view", () => electrobunModule);
}
