import { describe, expect, test } from "bun:test";
import { existsSync, readFileSync } from "node:fs";
import { basename, join } from "node:path";

import config from "../electrobun.config";
import { resourcePaths } from "./bun/local-server";

/**
 * The build contract: what the app is called, what it bundles, and that every file the windows, the tray and the launcher page ask for is
 * something the build puts there. A mistake here does not show in any unit test; it shows as a blank window or a missing tray icon.
 */
const root = join(import.meta.dir, "..");
const read = (path: string) => readFileSync(join(root, path), "utf8");
const copy = config.build.copy as Record<string, string>;

describe("the app", () => {
  test("is called Zetta and has its own identifier", () => {
    expect(config.app.name).toBe("zetta");
    expect(config.app.identifier).toBe("app.zettabot.desktop");
    expect(config.app.version).toMatch(/^\d+\.\d+\.\d+$/);
  });

  test("runs on the Bun main process, from a file that exists", () => {
    expect(config.build.mainProcess).toBe("bun");
    expect(existsSync(join(root, config.build.bun.entrypoint))).toBe(true);
  });

  test("keeps running with no window open, because the tray keeps it alive", () => {
    expect(config.runtime.exitOnLastWindowClosed).toBe(false);
  });

  test("bundles the browser engine on every platform, because server windows ask for it", () => {
    for (const platform of [config.build.mac, config.build.linux, config.build.win]) {
      expect(platform.bundleCEF).toBe(true);
      expect(platform.defaultRenderer).toBe("cef");
    }
    expect(read("src/bun/windows.ts")).toContain('renderer: "cef"');
  });
});

describe("the files it builds and copies", () => {
  test("the launcher is the only bundled page, and its script exists", () => {
    expect(Object.keys(config.build.views)).toEqual(["launcher"]);
    expect(existsSync(join(root, config.build.views.launcher.entrypoint))).toBe(true);
  });

  test("every file it copies into the app exists", () => {
    // `.resources` is staged by scripts/prepare-resources.ts before a build and is not in the repository.
    for (const source of Object.keys(copy).filter((path) => !path.startsWith(".resources/")))
      expect({ source, exists: existsSync(join(root, source)) }).toEqual({ source, exists: true });
  });

  test("the server's files are copied to where the app looks for them", () => {
    const shipped = resourcePaths("/app", "/app/bun");
    const copiedTo = new Set(Object.values(copy).map((target) => `/app/${target}`));
    for (const [key, path] of Object.entries(shipped)) {
      if (key === "bun") continue;
      expect({
        key,
        copied: [...copiedTo].some((dir) => path === dir || path.startsWith(`${dir}/`)),
      }).toEqual({ key, copied: true });
    }
  });

  test("the tray icon is a real PNG", () => {
    const icon = Object.entries(copy).find(([, target]) => target === "views/assets/tray.png")!;
    const signature = readFileSync(join(root, icon[0])).subarray(0, 8);
    expect([...signature]).toEqual([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
  });
});

describe("what the windows and the tray ask for", () => {
  test("the launcher window loads the page the build copies", () => {
    expect(read("src/bun/windows.ts")).toContain('url: "views://launcher/index.html"');
    expect(copy["src/launcher/index.html"]).toBe("views/launcher/index.html");
  });

  test("the tray icon is the image the build copies", () => {
    const image = read("src/bun/tray.ts").match(/image:\s*"views:\/\/([^"]+)"/)![1];
    expect(Object.values(copy)).toContain(`views/${image}`);
  });

  test("the launcher page's stylesheet and script are the ones the build produces", () => {
    const html = read("src/launcher/index.html");
    expect(html).toContain('href="views://launcher/index.css"');
    expect(copy["src/launcher/index.css"]).toBe("views/launcher/index.css");
    // The bundler names the script after its entry file.
    const script = html.match(/<script src="views:\/\/launcher\/([^"]+)"/)![1];
    expect(script).toBe(basename(config.build.views.launcher.entrypoint).replace(/\.ts$/, ".js"));
  });
});

describe("the launcher page", () => {
  const html = read("src/launcher/index.html");

  test("has every element its script looks up, so it cannot fail while loading", () => {
    for (const id of ["servers", "empty", "add", "address", "status"])
      expect({ id, present: html.includes(`id="${id}"`) }).toEqual({ id, present: true });
  });

  test("has a form with an address field and a button, and says how to use them", () => {
    expect(html).toMatch(
      /<form id="add"[\s\S]*<input[^>]*id="address"[\s\S]*<button type="submit">/,
    );
    expect(html).toContain("Server address");
    expect(html).toContain('role="status"');
  });

  test("is the only page that asks for the app's channel", () => {
    const sources = ["src/bun/windows.ts"].map(read).join("\n");
    // The launcher window is given the channel, the server windows are not: `rpc` appears once, for the launcher.
    expect(sources.match(/\brpc:/g)).toHaveLength(1);
    expect(sources).toContain("rpc: launcherRpc");
  });
});
