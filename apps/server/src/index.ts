import { initLogger } from "evlog";

import { createApp } from "./app";
import { sweepHarnessContainers } from "./modules/chat/harness";
import { ENV } from "./env.server";
import {
  agendaServices,
  auth,
  botClaudeServices,
  taskServices,
  searchServices,
  knowledgeServices,
  wikiServices,
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
  zettaMcpServices,
} from "./services";

initLogger({
  env: { service: "zetta-server" },
});

const tlsCert = process.env.ZETTA_TLS_CERT?.trim();
const tlsKey = process.env.ZETTA_TLS_KEY?.trim();
if (!tlsCert !== !tlsKey) throw new Error("Set both ZETTA_TLS_CERT and ZETTA_TLS_KEY, or neither.");
const tls = tlsCert && tlsKey ? { cert: Bun.file(tlsCert), key: Bun.file(tlsKey) } : undefined;

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
  search: searchServices,
  knowledge: knowledgeServices,
  wiki: wikiServices,
  artifacts: artifactServices,
  discussions: discussionServices,
  teams: teamServices,
  inbound: inboundServices,
  botDatabase: botDatabaseServices,
  botClaude: botClaudeServices,
  zettaMcp: zettaMcpServices,
  webOrigin: ENV.CORS_ORIGIN,
  desktopOrigins: trustedExtraOrigins,
}).listen(
  {
    hostname: process.env.ZETTA_HOST || (networkMode === "network" ? "0.0.0.0" : "127.0.0.1"),
    port: Number(process.env.PORT ?? 3000),
    idleTimeout: 120,
    // The largest legitimate body is a base64 image attachment (14 MB of text, see chat/routes.ts); Bun's default is 128 MiB.
    maxRequestBodySize: 16 * 1024 * 1024,
    tls,
  },
  () => {
    // Bun's default (10s) cuts a chat stream while a tool such as WhatsApp is still working
    console.log(
      `Server is running on ${tls ? "https" : "http"}://localhost:${process.env.PORT ?? 3000}`,
    );
  },
);

// Simple in-process ticker for the other workers (routines run from node-schedule jobs, see features/routines.ts); each unit is claimed atomically before it runs. A `bun --hot` reload replaces
// the timer instead of stacking another one that keeps driving the previous module's services.
const ticker = globalThis as { zettaTick?: ReturnType<typeof setInterval> };
clearInterval(ticker.zettaTick);
ticker.zettaTick = setInterval(() => {
  void agendaServices.scheduler.tick().catch(() => {});
  void knowledgeServices.knowledge.tick().catch(() => {});
  void wikiServices.wiki.tick().catch(() => {});
  void wikiServices.wiki.checkSources().catch(() => {});
  void wikiServices.jobs.tick().catch(() => {});
  void discussionServices.worker.tick().catch(() => {});
  void inboundServices.inbound.tick().catch(() => {});
  void loopServices.driver.tick().catch(() => {});
  void chatServices.chat.drainQueues().catch(() => {});
}, 30_000);

// Laya runs inside the server process; warm it in the background (set ZETTA_LAYA_PRELOAD=0 to load on first use).
if (process.env.ZETTA_LAYA_PRELOAD !== "0") void decisionServices.decisions.warm();

// Generations that were running when the previous process died are marked interrupted (never silently "complete").
// Then discussion turns that were running stall (the owner decides to resume) and inbound chats being delivered are retried.
void chatServices.chat
  .recoverInterrupted()
  .then(() =>
    Promise.all([
      discussionServices.store.recover(),
      inboundServices.inbound.recover(),
      chatServices.chat.recoverQueue(),
    ]),
  )
  .then(() => loopServices.driver.tick())
  .then(() => {
    // Once per process: a `bun --hot` reload re-runs this file while the runs it would "resume" are still alive.
    const g = globalThis as { zettaResumed?: boolean };
    if (g.zettaResumed) return void chatServices.chat.takeResumable();
    g.zettaResumed = true;
    return resumeInterruptedRuns();
  })
  // Messages queued before the restart are answered in order.
  .then(() => chatServices.chat.drainQueues())
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
