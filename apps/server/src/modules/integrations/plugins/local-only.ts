import { PluginError } from "./registry";

/**
 * Plugins that act on the machine Zetta runs on (an Obsidian vault folder, the Apple apps). They work only on a local install: on a
 * server open to the network they would act on the server, not on the person's computer. Set once at boot from the installation.
 */
let install: "local" | "network" = "network";
export const setInstallMode = (m: "local" | "network") => {
  install = m;
};
export const isLocalInstall = () => install === "local";

export function assertLocal(name: string, platform?: NodeJS.Platform) {
  if (install !== "local")
    throw new PluginError(
      "LOCAL_ONLY",
      `${name} works only when Zetta runs on your own computer.`,
      "Install Zetta on the computer that has the app (the desktop app or a local install).",
    );
  if (platform && process.platform !== platform)
    throw new PluginError(
      "WRONG_PLATFORM",
      `${name} needs ${platform === "darwin" ? "macOS" : platform}; this computer runs ${process.platform}.`,
    );
}
