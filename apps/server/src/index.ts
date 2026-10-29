import { initLogger } from "evlog";

import { createApp } from "./app";
import { sweepHarnessContainers } from "./modules/chat/harness";
import { ENV } from "./env.server";
import {
  agendaServices,
  auth,
  botClaudeServices,
  taskServices,
  artifactServices,
  botDatabaseServices,
  chatServices,
  computerServices,
  connectionServices,
  discussionServices,
  teamServices,
  inboundServices,
  integrationServices,
  decisionServices,
  featureServices,
  identity,
  installationServices,
  loopServices,
  networkMode,
  trustedExtraOrigins,
  resumeInterruptedRuns,
} from "./services";

initLogger({
  env: { service: "zetta-server" },
});

createApp({
  auth,
  identity,
  installation: installationServices,
  chat: chatServices,
  features: featureServices,
  decisions: decisionServices,
  computer: computerServices,
  connections: connectionServices,
  integrations: integrationServices,
  agenda: agendaServices,
  tasks: taskServices,
  artifacts: artifactServices,
  discussions: discussionServices,
  teams: teamServices,
  inbound: inboundServices,
  botDatabase: botDatabaseServices,
  botClaude: botClaudeServices,
  webOrigin: ENV.CORS_ORIGIN,
  desktopOrigins: trustedExtraOrigins,
}).listen(
  {
    hostname: process.env.ZETTA_HOST || (networkMode === "network" ? "0.0.0.0" : "127.0.0.1"),
    port: Number(process.env.PORT ?? 3000),
    idleTimeout: 120,
  },
  () => {
    // Bun's default (10s) cuts a chat stream while a tool such as WhatsApp is still working
    console.log(`Server is running on http://localhost:${process.env.PORT ?? 3000}`);
  },
);

// Simple in-process ticker for the other workers (routines run from node-schedule jobs, see features/routines.ts); each unit is claimed atomically before it runs. A `bun --hot` reload replaces
// the timer instead of stacking another one that keeps driving the previous module's services.
const ticker = globalThis as { zettaTick?: ReturnType<typeof setInterval> };
clearInterval(ticker.zettaTick);
ticker.zettaTick = setInterval(() => {
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
  .then(() => {
    // Once per process: a `bun --hot` reload re-runs this file while the runs it would "resume" are still alive.
    const g = globalThis as { zettaResumed?: boolean };
    if (g.zettaResumed) return void chatServices.chat.takeResumable();
    g.zettaResumed = true;
    return resumeInterruptedRuns();
  })
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
