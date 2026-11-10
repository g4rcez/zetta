import { Tray } from "electrobun/bun";
import type { ServerEntry } from "./registry";

type TrayActions = {
  openLauncher(): void;
  openServer(id: string): void;
  quit(): void;
};

/** The tray (menu bar on macOS) icon: the servers, the launcher, Quit. Closing every window leaves the app running here. */
export function createTray(actions: TrayActions) {
  const tray = new Tray({
    title: "",
    image: "views://assets/tray.png",
    template: false,
    width: 18,
    height: 18,
  });

  tray.on("tray-clicked", (event) => {
    const action = (event as { data?: { action?: string; data?: { id?: string } } }).data;
    if (!action) return;
    if (action.action === "launcher") actions.openLauncher();
    else if (action.action === "quit") actions.quit();
    else if (action.action === "server" && action.data?.id) actions.openServer(action.data.id);
  });

  return {
    setServers(servers: ServerEntry[]) {
      tray.setMenu([
        ...servers.map((server) => ({
          type: "normal" as const,
          label: server.name,
          action: "server",
          data: { id: server.id },
        })),
        ...(servers.length ? [{ type: "divider" as const }] : []),
        { type: "normal" as const, label: "Servers…", action: "launcher" },
        { type: "divider" as const },
        { type: "normal" as const, label: "Quit Zetta", action: "quit" },
      ]);
    },
  };
}
