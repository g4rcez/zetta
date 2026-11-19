import { join } from "node:path";
import { Utils } from "electrobun/bun";
import {
  createLocalServer,
  resourcePaths,
  type LocalPaths,
  type LocalServer,
  type LocalServerOptions,
  type LocalState,
} from "./local-server";
import type { Registry, ServerEntry } from "./registry";

/** Turns the local server off for this run (for a person who only wants to use remote servers, and for tests of the rest of the app). */
export const localServerEnabled = (env: Record<string, string | undefined> = process.env) =>
  env.ZETTA_DESKTOP_LOCAL?.trim().toLowerCase() !== "off";

/** The folder that holds the shipped server, web app and database runtime: next to the app's code in a build, or one the caller names. */
export const resourcesRoot = (
  env: Record<string, string | undefined> = process.env,
  here = import.meta.dir,
) => env.ZETTA_DESKTOP_RESOURCES?.trim() || join(here, "..");

export type LocalAttachment = {
  server: LocalServer;
  /** The registry entry of this computer's server (once it has an address). */
  entry(): ServerEntry | undefined;
  /** The path to open in the window (see below). */
  openPath(): string;
};

/**
 * Connects the supervised server to the rest of the app: its address is kept in the server list as "This computer", and every change of
 * state is passed to the launcher and the tray. Returns null when the local server is off.
 */
export function attachLocalServer(options: {
  registry: Registry;
  /** Called whenever the list or the state changed. */
  changed(state: LocalState): void;
  paths?: LocalPaths;
  dataDir?: string;
  server?: Partial<LocalServerOptions>;
  env?: Record<string, string | undefined>;
}): LocalAttachment | null {
  const env = options.env ?? process.env;
  if (!localServerEnabled(env)) return null;
  const paths = options.paths ?? resourcePaths(resourcesRoot(env), process.execPath);
  const dataDir = options.dataDir ?? join(Utils.paths.userData, "local");
  const server = createLocalServer({ dataDir, paths, ...options.server });

  server.onChange((state) => {
    if (state.origin)
      options.registry.setLocal({ webOrigin: state.origin, apiOrigin: state.origin });
    options.changed(state);
  });

  const entry = () => options.registry.list().find((row) => row.kind === "local");
  return {
    server,
    entry,
    openPath() {
      const { setupUrl } = server.state;
      if (!setupUrl) return "/";
      // Always the onboarding page with the key in the fragment (never sent to the server): with no account yet it opens at the key step,
      // already filled in; with one, it sends the person on to the app or the sign-in page. A person who quit half way is not stuck.
      const url = new URL(setupUrl);
      return `${url.pathname}${url.hash}`;
    },
  };
}
