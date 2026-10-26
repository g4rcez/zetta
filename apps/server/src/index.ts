import { initLogger } from "evlog";

import { createApp } from "./app";
import { sweepHarnessContainers } from "./modules/chat/harness";
import { desktopOrigins, ENV } from "./env.server";
import { auth, chatServices, computerServices, connectionServices, integrationServices, decisionServices, featureServices, identity } from "./services";

initLogger({
  env: { service: "zetta-server" },
});

createApp({
  auth,
  identity,
  chat: chatServices,
  features: featureServices,
  decisions: decisionServices,
  computer: computerServices,
  connections: connectionServices,
  integrations: integrationServices,
  webOrigin: ENV.CORS_ORIGIN,
  desktopOrigins,
}).listen({ port: Number(process.env.PORT ?? 3000), idleTimeout: 120 }, () => { // Bun's default (10s) cuts a chat stream while a tool such as WhatsApp is still working
  console.log(`Server is running on http://localhost:${process.env.PORT ?? 3000}`);
});

// Simple in-process scheduler: one tick per 30s; each due routine is claimed atomically before it runs.
setInterval(() => { void featureServices.features.runDue().catch(() => {}); }, 30_000);

// Laya runs inside the server process; warm it in the background (set ZETTA_LAYA_PRELOAD=0 to load on first use).
if (process.env.ZETTA_LAYA_PRELOAD !== "0") void decisionServices.decisions.warm();

// Generations that were running when the previous process died are marked interrupted (never silently "complete").
void chatServices.chat.recoverInterrupted().catch(() => {});
void featureServices.features.recover().catch(() => {});

// Containers and Spaces left by a previous process are removed at boot (this server assumes it is the only instance).
void sweepHarnessContainers().catch(() => {});
void computerServices.computer.sweep().catch(() => {});
void computerServices.desktop?.sweep().catch(() => {});
void computerServices.vms?.sweep().catch(() => {});
