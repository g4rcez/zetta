import { initLogger } from "evlog";

import { createApp } from "./app";
import { sweepHarnessContainers } from "./modules/chat/harness";
import { desktopOrigins, ENV } from "./env.server";
import {
  agendaServices,
  auth,
  botClaudeServices,
  botDatabaseServices,
  chatServices,
  computerServices,
  connectionServices,
  discussionServices,
  inboundServices,
  integrationServices,
  decisionServices,
  featureServices,
  identity,
  loopServices,
} from "./services";

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
  agenda: agendaServices,
  discussions: discussionServices,
  inbound: inboundServices,
  botDatabase: botDatabaseServices,
  botClaude: botClaudeServices,
  webOrigin: ENV.CORS_ORIGIN,
  desktopOrigins,
}).listen({ port: Number(process.env.PORT ?? 3000), idleTimeout: 120 }, () => {
  // Bun's default (10s) cuts a chat stream while a tool such as WhatsApp is still working
  console.log(`Server is running on http://localhost:${process.env.PORT ?? 3000}`);
});

// Simple in-process scheduler: one tick per 30s; each due routine is claimed atomically before it runs. A `bun --hot` reload replaces
// the timer instead of stacking another one that keeps driving the previous module's services.
const ticker = globalThis as { zettaTick?: ReturnType<typeof setInterval> };
clearInterval(ticker.zettaTick);
ticker.zettaTick = setInterval(() => {
  void featureServices.features.runDue().catch(() => {});
  void agendaServices.scheduler.tick().catch(() => {});
  void discussionServices.worker.tick().catch(() => {});
  void inboundServices.inbound.tick().catch(() => {});
  void loopServices.driver.tick().catch(() => {});
}, 30_000);

// Laya runs inside the server process; warm it in the background (set ZETTA_LAYA_PRELOAD=0 to load on first use).
if (process.env.ZETTA_LAYA_PRELOAD !== "0") void decisionServices.decisions.warm();

// Generations that were running when the previous process died are marked interrupted (never silently "complete").
// Then discussion turns that were running stall (the owner decides to resume) and inbound chats being delivered are retried.
void chatServices.chat
  .recoverInterrupted()
  .then(() => Promise.all([discussionServices.store.recover(), inboundServices.inbound.recover()]))
  .then(() => loopServices.driver.tick())
  .catch(() => {});
void featureServices.features.recover().catch(() => {});

// Containers and Spaces left by a previous process are removed at boot (this server assumes it is the only instance).
void sweepHarnessContainers().catch(() => {});
void computerServices.computer.sweep().catch(() => {});
void computerServices.desktop?.sweep().catch(() => {});
// Once per process: `bun --hot` re-runs this module on every edit, and sweeping then would stop the computers people are using.
const boot = globalThis as { zettaVmSwept?: boolean };
if (!boot.zettaVmSwept) {
  boot.zettaVmSwept = true;
  void computerServices.vms?.sweep().catch(() => {});
}
