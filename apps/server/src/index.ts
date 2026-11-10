import { initLogger } from "evlog";

import { createApp } from "./app";
import { createBackground } from "./background";
import { sweepHarnessContainers } from "./modules/chat/harness";
import { ENV } from "./env.server";
import { startPgSignals } from "./modules/events/pg-signals";
import { sql } from "@zetta/db/query";
import { createInstance } from "./modules/runtime/instance";
import { ROLE, runsWork } from "./role";
import {
  agendaServices,
  auth,
  botClaudeServices,
  taskServices,
  preferenceServices,
  profileServices,
  searchServices,
  knowledgeServices,
  memoryServices,
  outputStyleServices,
  skillServices,
  botImportServices,
  playgroundServices,
  appsServices,
  artifactServices,
  chatServices,
  databaseReady,
  database,
  db,
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
  eventServices,
  loopServices,
  taskFollowUp,
  networkMode,
  trustedExtraOrigins,
  resumeInterruptedRuns,
  zettaMcpServices,
  apps,
  skillReview,
} from "./services";

initLogger({
  env: { service: "zetta-server" },
});

const tlsCert = process.env.ZETTA_TLS_CERT?.trim();
const tlsKey = process.env.ZETTA_TLS_KEY?.trim();
if (!tlsCert !== !tlsKey) throw new Error("Set both ZETTA_TLS_CERT and ZETTA_TLS_KEY, or neither.");
const tls = tlsCert && tlsKey ? { cert: Bun.file(tlsCert), key: Bun.file(tlsKey) } : undefined;

// Every process is listed in `server_instance` and keeps a heartbeat: rows of work in progress name their owner, and recovery only takes
// the work of an owner that is gone. Registered before anything is served, recovered or stamped.
const instance = createInstance({ db, role: ROLE });
await instance.start();
// A stopped process tells its peers at once, instead of after the heartbeat times out.
for (const signal of ["SIGTERM", "SIGINT"] as const)
  process.once(
    signal,
    () =>
      void instance.stop().finally(() => {
        // The embedded Postgres stops with the process that started it; an external one is left alone.
        database.stop();
        process.exit(0);
      }),
  );

createApp({
  auth,
  identity,
  installation: installationServices,
  chat: chatServices,
  events: eventServices,
  features: featureServices,
  decisions: decisionServices,
  computer: computerServices,
  connections: connectionServices,
  integrations: integrationServices,
  agenda: agendaServices,
  tasks: taskServices,
  preferences: preferenceServices,
  profile: profileServices,
  search: searchServices,
  knowledge: knowledgeServices,
  memory: memoryServices,
  outputStyles: outputStyleServices,
  artifacts: artifactServices,
  discussions: discussionServices,
  teams: teamServices,
  inbound: inboundServices,
  botClaude: botClaudeServices,
  skills: skillServices,
  botImport: botImportServices,
  playground: playgroundServices,
  apps: appsServices,
  zettaMcp: zettaMcpServices,
  runTools: computerServices.vms,
  webOrigin: ENV.CORS_ORIGIN,
  apiOrigin: ENV.BETTER_AUTH_URL,
  desktopOrigins: trustedExtraOrigins,
  role: ROLE,
  ready: databaseReady,
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
      `Server (${ROLE}) is running on ${tls ? "https" : "http"}://localhost:${process.env.PORT ?? 3000}`,
    );
  },
);

// With several servers, publishes and worker kicks reach the other instances over Postgres NOTIFY. One `all` process needs no link.
// `bun --hot` re-runs this file: the previous listener closes first.
const busMode = process.env.ZETTA_EVENT_BUS?.trim() || (ROLE === "all" ? "local" : "pg");
if (busMode !== "local" && busMode !== "pg")
  throw new Error('ZETTA_EVENT_BUS must be "local" or "pg".');
const signals = globalThis as { zettaSignals?: { stop(): Promise<void> } };
void signals.zettaSignals?.stop();
signals.zettaSignals =
  busMode === "pg"
    ? startPgSignals({
        connectionString: database.url,
        notify: (channel, payload) => db.execute(sql`select pg_notify(${channel}, ${payload})`),
        onError: (e) => console.error("[events] link:", e instanceof Error ? e.message : e),
      })
    : undefined;

// An `api` process never owns work: no ticker, no recovery, no sweeps. Recovery marks every running row of the database as interrupted,
// so it must run in exactly one process (the worker, or the single `all` process).
if (runsWork) {
  const background = createBackground();
  // Work of a dead process is recovered by the one that is alive: at boot (including rows written before owners were recorded, when no
  // other worker is alive) and on every tick (a peer that died while this one ran). Work of a live process is never touched.
  async function recoverDead(boot: boolean) {
    const scope = await instance.recoveryScope(boot);
    await chatServices.chat.recoverInterrupted(scope);
    // A `bun --hot` reload keeps the instance id, so its own running turns are not "dead": the once-per-process guards only save work.
    await Promise.all([
      discussionServices.store.recover(scope),
      inboundServices.inbound.recover(scope),
      chatServices.chat.recoverQueue(scope),
    ]);
    await background.run("recover:features", () => featureServices.features.recover(scope, boot));
    await loopServices.driver.tick();
    // Claude Code runs a dead process cut off continue in their own sessions. At boot, once per process.
    const g = globalThis as { zettaResumed?: boolean };
    if (boot && g.zettaResumed) chatServices.chat.takeResumable();
    else {
      if (boot) g.zettaResumed = true;
      await resumeInterruptedRuns();
    }
    // Messages queued before are answered in order.
    await chatServices.chat.drainQueues();
  }

  // The routine jobs are armed apart from the recovery chain: a failure earlier in the chain must not leave every routine unscheduled
  // until the next restart. Tried again on each tick until it has worked once in this process.
  let routinesArmed = false;
  const armRoutines = async () => {
    if (routinesArmed) return;
    await featureServices.features.armRoutines();
    routinesArmed = true;
  };

  // Simple in-process ticker for the other workers (routines run from node-schedule jobs, see features/routines.ts); each unit is claimed atomically before it runs. A `bun --hot` reload replaces
  // the timer instead of stacking another one that keeps driving the previous module's services.
  const ticker = globalThis as { zettaTick?: ReturnType<typeof setInterval> };
  clearInterval(ticker.zettaTick);
  ticker.zettaTick = setInterval(() => {
    void background.exclusive("recover", () => recoverDead(false));
    void background.run("routines:arm", armRoutines);
    void background.run("agenda", () => agendaServices.scheduler.tick());
    void background.run("knowledge", () => knowledgeServices.knowledge.tick());
    void background.run("memory", () => memoryServices.memory.tick());
    void background.run("memory:sources", () => memoryServices.memory.checkSources());
    void background.run("memory:jobs", () => memoryServices.jobs.tick());
    void background.run("skills:review", () => skillReview.tick());
    void background.run("rooms", () => discussionServices.worker.tick());
    void background.run("inbound", () => inboundServices.inbound.tick());
    void background.run("loops", () => loopServices.driver.tick());
    void background.run("tasks:heartbeat", () => taskFollowUp.heartbeat.tick());
    void background.run("chat:queues", () => chatServices.chat.drainQueues());
    void background.run("chat:slow-turns", () => chatServices.chat.flagSlowTurns());
    void background.run("chat:proposals", () => chatServices.chat.expireProposals());
    void background.run("apps:pending", () => apps.expirePending());
    void background.run("routines:triggers", () => featureServices.features.routineTriggers.tick());
  }, 30_000);

  // Generations that were running when the previous process died are marked interrupted (never silently "complete").
  void background.exclusive("recover", () => recoverDead(true));
  void background.run("routines:arm", armRoutines);

  // Skills installed before their folder was kept get their files from GitHub. Once per process: `bun --hot` re-runs this module on every edit.
  const skillsBoot = globalThis as { zettaSkillFiles?: boolean };
  if (!skillsBoot.zettaSkillFiles) {
    skillsBoot.zettaSkillFiles = true;
    void skillServices.skills
      .backfillFiles(skillServices.market)
      .catch((e) =>
        console.error(`skills: backfill failed name=${(e as Error | undefined)?.name ?? typeof e}`),
      );
  }

  // Runs that were going when the previous process died are marked interrupted, once per process (`bun --hot` re-runs this module on every
  // edit, and marking then would cut the runs that are still going).
  const playgroundBoot = globalThis as { zettaPlaygroundSwept?: boolean };
  if (!playgroundBoot.zettaPlaygroundSwept) {
    playgroundBoot.zettaPlaygroundSwept = true;
    void playgroundServices.playground
      .interruptRunning()
      .catch((e) =>
        console.error(
          `playground: boot sweep failed name=${(e as Error | undefined)?.name ?? typeof e}`,
        ),
      );
    void playgroundServices.containers
      ?.sweep()
      .catch((e) =>
        console.error(
          `playground: container sweep failed name=${(e as Error | undefined)?.name ?? typeof e}`,
        ),
      );
  }

  // Containers and Spaces left by a previous process are removed at boot (this server assumes it is the only instance).
  void background.run("sweep:harness", () => sweepHarnessContainers());
  void background.run("sweep:computer", () => computerServices.computer.sweep());
  // Once per process: `bun --hot` re-runs this module on every edit, and sweeping then would stop the computers people are using.
  const boot = globalThis as { zettaVmSwept?: boolean };
  if (!boot.zettaVmSwept) {
    boot.zettaVmSwept = true;
    void background.run("sweep:vm", async () => computerServices.vms?.sweep());
  }
}
