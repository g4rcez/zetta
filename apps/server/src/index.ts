import { initLogger } from "evlog";
import { forEachWorkspace } from "./modules/workspaces/each";

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
  projectServices,
  orgServices,
  botQualityServices,
  learningServices,
  transcribeServices,
  speechServices,
  voiceServices,
  phoneServices,
  catchUpServices,
  preferenceServices,
  profileServices,
  avatarServices,
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
  mailPoller,
  mailServices,
  discussionServices,
  teamServices,
  inboundServices,
  integrationServices,
  desktopLinkServices,
  deviceServices,
  decisionServices,
  featureServices,
  identity,
  installationServices,
  settingsServices,
  workspaceServices,
  engineAccountServices,
  eventServices,
  loopServices,
  taskFollowUp,
  workServices,
  networkMode,
  trustedExtraOrigins,
  resumeInterruptedRuns,
  zettaMcpServices,
  apps,
  skillReview,
  learning,
  lessons,
  lessonBatch,
  lessonTrial,
  lessonTidy,
  lessonForget,
  lessonServices,
  chatSummaries,
  updateChecker,
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
  webDist: process.env.ZETTA_WEB_DIST?.trim() || undefined,
  auth,
  identity,
  installation: installationServices,
  settings: settingsServices,
  workspaces: workspaceServices,
  engineAccounts: engineAccountServices,
  chat: chatServices,
  events: eventServices,
  features: featureServices,
  decisions: decisionServices,
  computer: computerServices,
  connections: connectionServices,
  mail: mailServices,
  integrations: integrationServices,
  agenda: agendaServices,
  tasks: taskServices,
  projects: projectServices,
  org: orgServices,
  botQuality: botQualityServices,
  learning: learningServices,
  lessons: lessonServices,
  transcribe: transcribeServices,
  speech: speechServices,
  voice: voiceServices,
  phone: phoneServices,
  catchUp: catchUpServices,
  preferences: preferenceServices,
  profile: profileServices,
  avatars: avatarServices,
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
  desktopLink: desktopLinkServices,
  devices: deviceServices,
  webOrigin: ENV.ZETTA_SERVER_URL,
  apiOrigin: ENV.ZETTA_SERVER_URL,
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
  // Background work runs for one workspace at a time (modules/workspaces/each.ts).
  const each = (work: () => unknown) => forEachWorkspace(db, work);
  // Work of a dead process is recovered by the one that is alive: at boot (including rows written before owners were recorded, when no
  // other worker is alive) and on every tick (a peer that died while this one ran). Work of a live process is never touched.
  async function recoverDead(boot: boolean) {
    const scope = await instance.recoveryScope(boot);
    // Claude Code runs a dead process cut off continue in their own sessions. At boot, once per process: decided before the workspaces run,
    // so the first one does not change it for the rest.
    const g = globalThis as { zettaResumed?: boolean };
    const resumed = boot && g.zettaResumed === true;
    if (boot) g.zettaResumed = true;
    await each(async () => {
      await chatServices.chat.recoverInterrupted(scope);
      // A spoken call whose server is gone cannot be live any more.
      await voiceServices.voice.recover(scope);
      // A `bun --hot` reload keeps the instance id, so its own running turns are not "dead": the once-per-process guards only save work.
      await Promise.all([
        discussionServices.store.recover(scope),
        inboundServices.inbound.recover(scope),
        chatServices.chat.recoverQueue(scope),
      ]);
      await background.run("recover:features", () => featureServices.features.recover(scope, boot));
      await loopServices.driver.tick();
      if (resumed) chatServices.chat.takeResumable();
      else await resumeInterruptedRuns();
      // Messages queued before are answered in order.
      await chatServices.chat.drainQueues();
    });
  }

  // The routine jobs are armed apart from the recovery chain: a failure earlier in the chain must not leave every routine unscheduled
  // until the next restart. Tried again on each tick until it has worked once in this process.
  let routinesArmed = false;
  const armRoutines = async () => {
    if (routinesArmed) return;
    await each(() => featureServices.features.armRoutines());
    routinesArmed = true;
  };

  // Simple in-process ticker for the other workers (routines run from node-schedule jobs, see features/routines.ts); each unit is claimed atomically before it runs. A `bun --hot` reload replaces
  // the timer instead of stacking another one that keeps driving the previous module's services.
  const ticker = globalThis as { zettaTick?: ReturnType<typeof setInterval> };
  clearInterval(ticker.zettaTick);
  ticker.zettaTick = setInterval(() => {
    void background.exclusive("recover", () => recoverDead(false));
    void background.run("routines:arm", armRoutines);
    void background.run("agenda", () => each(() => agendaServices.scheduler.tick()));
    void background.run("knowledge", () => each(() => knowledgeServices.knowledge.tick()));
    void background.run("memory", () => each(() => memoryServices.memory.tick()));
    void background.run("memory:sources", () => each(() => memoryServices.memory.checkSources()));
    void background.run("memory:jobs", () => each(() => memoryServices.jobs.tick()));
    void background.run("skills:review", () => each(() => skillReview.tick()));
    void background.run("learning:outcomes", () => each(() => learning.outcomes.tick()));
    void background.run("learning:trial", () => each(() => lessonTrial.tick()));
    void background.run("learning:batch", () => each(() => lessonBatch.tick()));
    void background.run("learning:forget", () => each(() => lessonForget.tick()));
    void background.run("learning:tidy", () => each(() => lessonTidy.tick()));
    void background.run("workflows:resume", () =>
      each(() => featureServices.features.workflows.tick()),
    );
    void background.run("chat:summaries", () => each(() => chatSummaries.tick()));
    void background.run("rooms", () => each(() => discussionServices.worker.tick()));
    void background.run("inbound", () => each(() => inboundServices.inbound.tick()));
    void background.run("mail:bot-addresses", () => each(() => mailPoller.tick()));
    void background.run("phone:numbers", () =>
      each(async () => {
        await phoneServices.phone.syncPending();
        await phoneServices.phone.releaseExpired();
      }),
    );
    void background.run("loops", () => each(() => loopServices.driver.tick()));
    void background.run("tasks:heartbeat", () => each(() => taskFollowUp.heartbeat.tick()));
    void background.run("work:scan", () => each(() => workServices.scan.due()));
    void background.run("chat:queues", () => each(() => chatServices.chat.drainQueues()));
    void background.run("chat:slow-turns", () => each(() => chatServices.chat.flagSlowTurns()));
    void background.run("chat:proposals", () => each(() => chatServices.chat.expireProposals()));
    void background.run("apps:pending", () => each(() => apps.expirePending()));
    void background.run("routines:triggers", () =>
      each(() => featureServices.features.routineTriggers.tick()),
    );
    void background.run("updates:check", () => updateChecker.tick());
  }, 30_000);

  // Generations that were running when the previous process died are marked interrupted (never silently "complete").
  void background.exclusive("recover", () => recoverDead(true));
  void background.run("routines:arm", armRoutines);

  // Skills installed before their folder was kept get their files from GitHub. Once per process: `bun --hot` re-runs this module on every edit.
  const skillsBoot = globalThis as { zettaSkillFiles?: boolean };
  if (!skillsBoot.zettaSkillFiles) {
    skillsBoot.zettaSkillFiles = true;
    void each(() => skillServices.skills.backfillFiles(skillServices.market)).catch((e) =>
      console.error(`skills: backfill failed name=${(e as Error | undefined)?.name ?? typeof e}`),
    );
  }

  // The record of which memory items past replies used (modules/learning), built from what replies already hold. Once per process, and
  // it picks up where it stopped: a reply that already has a verdict is skipped.
  const learningBoot = globalThis as { zettaLearningBackfill?: boolean };
  if (!learningBoot.zettaLearningBackfill) {
    learningBoot.zettaLearningBackfill = true;
    void each(() =>
      learning.backfill
        .run()
        // The skills a bot learned before lessons existed become lessons too, so the page shows everything it learned.
        .then(() => lessons.backfillSkills()),
    ).catch((e) =>
      console.error(`learning: backfill failed name=${(e as Error | undefined)?.name ?? typeof e}`),
    );
  }

  // Runs that were going when the previous process died are marked interrupted, once per process (`bun --hot` re-runs this module on every
  // edit, and marking then would cut the runs that are still going).
  const playgroundBoot = globalThis as { zettaPlaygroundSwept?: boolean };
  if (!playgroundBoot.zettaPlaygroundSwept) {
    playgroundBoot.zettaPlaygroundSwept = true;
    void each(() => playgroundServices.playground.interruptRunning()).catch((e) =>
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
  void background.run("sweep:computer", () => each(() => computerServices.computer.sweep()));
  // Once per process: `bun --hot` re-runs this module on every edit, and sweeping then would stop the computers people are using.
  const boot = globalThis as { zettaVmSwept?: boolean };
  if (!boot.zettaVmSwept) {
    boot.zettaVmSwept = true;
    void background.run("sweep:vm", () => each(async () => computerServices.vms?.sweep()));
  }
}
