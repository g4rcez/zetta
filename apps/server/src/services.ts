import { createAuth } from "@zetta/auth";
import { createDb } from "@zetta/db";

import { ENV, desktopOrigins } from "./env.server";

import { createChatService } from "./modules/chat/service";
import { createDecisionService } from "./modules/decisions/service";
import { createJevDecider } from "./modules/decisions/jev";
import { createMcp } from "./modules/integrations/mcp";
import { createSources } from "./modules/integrations/sources";
import { createConnectionStore } from "./modules/connections/store";
import { createConnectionsService, PROVIDERS } from "./modules/connections/service";
import { createCuaCall } from "./modules/computer/desktop";
import { createDesktopService } from "./modules/computer/desktop";
import { createComputerService, dockerBrowserConfig } from "./modules/computer/service";
import { createDbVmStore, createVmService, dockerVmConfig } from "./modules/computer/vm";
import { createFeaturesService } from "./modules/features/service";
import { createAgenda } from "./modules/agenda/service";
import { createTaskStore } from "./modules/tasks/store";
import { createArtifactStore } from "./modules/artifacts/store";
import { createAgendaScheduler } from "./modules/agenda/scheduler";
import { createDiscussionStore } from "./modules/discussions/store";
import { createTeamStore } from "./modules/teams/store";
import { createLoopDriver, createLoopStore } from "./modules/chat/loops";
import { createDiscussionWorker } from "./modules/discussions/worker";
import { createInbound } from "./modules/inbound/service";
import { createBotClaude } from "./modules/bot-claude/store";
import { createBotDatabase } from "./modules/bot-database/service";
import { configureBotDatabase } from "./modules/bot-database/plugin";
import { createEnrollmentService } from "./modules/identity/enrollment";
import {
  createIdentityAccess,
  createMembershipLookup,
  issueBackgroundActor,
} from "./modules/identity/access";
import { TurnBusyError } from "./modules/chat/turns";
import { createFirstAccountSetup, createSetupState } from "./modules/identity/first-account";
import { matchesConnectionKey } from "./modules/identity/setup-key";
import { createInstallationService } from "./modules/installation/service";
import { createInvitationSignupPreflight } from "./modules/identity/signup-preflight";

// `bun --hot` re-runs this module on every edit: keep one connection pool per process instead of leaking a new one (100 connections
// fill up after a few dozen reloads).
const reloaded = globalThis as { zettaDb?: ReturnType<typeof createDb> };
export const db = (reloaded.zettaDb ??= createDb(ENV));
const installation = createInstallationService(db);
// Network mode is read once at boot: it adds the public origin to every trusted-origin list and (in index.ts) opens the listener to the network.
const installed = await installation.load();
export const networkMode = installed.networkMode;
export const trustedExtraOrigins = [
  ...desktopOrigins,
  ...(installed.networkMode === "network" && installed.publicUrl ? [installed.publicUrl] : []),
];
export const auth = createAuth(ENV, db, trustedExtraOrigins, {
  invitationSignupVerifier: createInvitationSignupPreflight(db),
  firstAccount: createFirstAccountSetup(db, ENV.ZETTA_CONNECTION_KEY),
});
const membershipLookup = createMembershipLookup(db);
export const identity = {
  access: createIdentityAccess(auth, membershipLookup),
  enrollment: createEnrollmentService(db),
  setupOpen: createSetupState(db),
  verifySetupKey: (key: string) => matchesConnectionKey(key, ENV.ZETTA_CONNECTION_KEY),
};
export const installationServices = {
  access: identity.access,
  installation,
  runningMode: installed.networkMode,
};

import { createFileStore } from "./modules/chat/files";

// Authorized server files live under ZETTA_FILES_ROOT (me/<userId>/… private, shared/… team-readable).
const files = createFileStore(process.env.ZETTA_FILES_ROOT ?? `${process.cwd()}/.zetta-files`);
const decisions = createDecisionService();
// Desktop control through Cua Spaces: enable with ZETTA_DESKTOP_RUNTIME=cua (needs the `cua` CLI; each user+profile gets its own local Linux container Space).
const cua =
  process.env.ZETTA_DESKTOP_RUNTIME === "cua" && Bun.which("cua") ? createCuaCall() : undefined;
const desktop = cua ? createDesktopService({ call: cua.call, close: cua.close }) : undefined;
// Persistent per-user VMs (docker/desktop image + cua-spacesd): enable with ZETTA_DESKTOP_RUNTIME=docker. Takes over desktop use from Cua Spaces.
const vmDocker = dockerVmConfig();
const num = (v: string | undefined) => (v && /^\d+$/.test(v) ? Number(v) : undefined);
const vms = vmDocker
  ? createVmService({
      store: createDbVmStore(db),
      docker: vmDocker,
      tokenRoot: process.env.ZETTA_VM_TOKEN_ROOT ?? `${process.cwd()}/.zetta-vm`,
      maxPerUser: num(process.env.ZETTA_VM_MAX_PER_USER),
      maxRunningPerUser: num(process.env.ZETTA_VM_MAX_RUNNING_PER_USER),
      maxRunning: num(process.env.ZETTA_VM_MAX_RUNNING),
      allowPrivate: process.env.ZETTA_ALLOW_PRIVATE_NETWORK === "1",
    })
  : undefined;
// `bun --hot` re-runs this module: the previous instance lets go of its VMs (the new one reattaches on next use) instead of keeping a
// second idle reaper and stale connections around.
const hot = globalThis as { zettaVms?: { detach(): void } };
hot.zettaVms?.detach();
hot.zettaVms = vms;
const computer = createComputerService({
  docker: dockerBrowserConfig(),
  db,
  root: process.env.ZETTA_BROWSER_ROOT ?? `${process.cwd()}/.zetta-browser`,
  executablePath: process.env.ZETTA_CHROMIUM_PATH,
});

// ZETTA_CONNECTION_KEY is required at boot (base64 of 32 random bytes: `openssl rand -base64 32`); the env schema rejects a missing or malformed value.
let connectionStore: Awaited<ReturnType<typeof createConnectionStore>> | undefined;
// A busy or still-starting database (or another server opening the store at the same moment) must not disable secrets until the next restart.
for (let attempt = 1; !connectionStore && attempt <= 5; attempt++) {
  try {
    connectionStore = await createConnectionStore(db, {
      configuration: {
        key: ENV.ZETTA_CONNECTION_KEY,
        keyId: process.env.ZETTA_CONNECTION_KEY_ID ?? "v1",
      },
      allowedProviders: PROVIDERS,
      initializeEmpty: true,
    });
  } catch (e) {
    const code = e instanceof Error ? e.message : "unknown";
    if (attempt === 5)
      console.warn(
        `Connections disabled (${code}): ZETTA_CONNECTION_KEY does not match the stored key check, or the database is unavailable.`,
      );
    else await Bun.sleep(attempt * 1000);
  }
}
const connections = createConnectionsService(db, connectionStore);
export const connectionServices = { access: identity.access, connections };
// Administrator opt-in: lets MCP servers and the WhatsApp (WAHA) plugin reach private/localhost addresses (e.g. a WAHA container). Off by default.
const mcp = createMcp(db, connections, {
  allowPrivate: process.env.ZETTA_ALLOW_PRIVATE_NETWORK === "1",
});
const jev = createJevDecider((a) => connections.jevSecret(a));
const sources = createSources(db, computer, {
  connections: {
    list: (a) => connections.list(a) as never,
    secretFor: (a, id) => connections.secretFor(a, id) as never,
  },
});
const features = createFeaturesService(db, undefined, decisions, computer, sources as never);
const agenda = createAgenda(db);
const tasks = createTaskStore(db);
const artifacts = createArtifactStore(db);
const loops = createLoopStore(db);
const discussions = createDiscussionStore(db, files, loops);
// Each bot's private Postgres schema (modules/bot-database). Bot passwords are derived from this key; the app's database user needs CREATEROLE.
const botDbKey = process.env.ZETTA_BOT_DATABASE_KEY || ENV.ZETTA_CONNECTION_KEY;
const botDatabase = botDbKey
  ? createBotDatabase(db, {
      databaseUrl: ENV.DATABASE_URL,
      key: botDbKey,
      quotaMb: num(process.env.ZETTA_BOT_DATABASE_QUOTA_MB),
    })
  : undefined;
configureBotDatabase(botDatabase);
if (botDatabase)
  void botDatabase.available().then((ok) => {
    if (!ok)
      console.warn(
        "Bot databases disabled: the app's database user needs the CREATEROLE permission.",
      );
  });
const teamStore = createTeamStore(db, discussions);
export const chatServices = {
  access: identity.access,
  chat: createChatService(
    db,
    undefined,
    files,
    computer,
    decisions,
    connections,
    { routine: features.routines.create as never, workflow: features.workflows.save as never },
    mcp,
    jev,
    desktop,
    vms,
    agenda,
    { discussions, botDatabase, loops, tasks, artifacts, teams: teamStore },
  ),
  files,
};
// Routines run as real chat turns (tools, computers, plugins) in their conversation, as the owner. A busy conversation (the owner is
// chatting in a routine that continues one chat) is retried for a while instead of failing the occurrence.
features.routines.useChat(async (userId, conversationId, prompt, requestKey) => {
  const actor = await issueBackgroundActor(membershipLookup, userId);
  if (!actor) throw new Error("owner_inactive");
  for (let attempt = 0; ; attempt++) {
    try {
      const { follow } = await chatServices.chat.startTurn(actor, conversationId, {
        content: prompt,
        clientRequestId: requestKey,
      });
      let saved: { status: string; content: string } | undefined;
      for await (const { event } of follow()) if (event.type === "message") saved = event.message;
      return { ok: saved?.status === "complete", text: saved?.content ?? "" };
    } catch (e) {
      if (!(e instanceof TurnBusyError) || attempt >= 24) throw e;
      await Bun.sleep(5_000);
    }
  }
});
// Goal loops: each step is a chat turn in the loop's conversation, as its owner. A busy conversation (the owner is typing there) is waited
// for; the step's saved reply status tells the driver whether it completed, failed or was stopped.
const loopDriver = createLoopDriver(loops, async (loop, label, prompt, requestKey) => {
  const actor = await issueBackgroundActor(membershipLookup, loop.ownerUserId);
  if (!actor) throw new Error("owner_inactive");
  // A loop in a room: the facilitator is woken and the members discuss; the step ends when the room is quiet.
  const room = await discussions.byConversation(loop.conversationId);
  if (room) {
    const started = await discussions.startLoopStep(room.id, label);
    if (started.state === "paused") {
      await loops.pause(loop.id, "the room is paused");
      return { status: "complete" };
    }
    if (started.state !== "started")
      return { status: started.state === "cancelled" ? "cancelled" : "complete" };
    const { state, summary } = await discussions.settle(
      room.id,
      started.since,
      async () => (await loops.get(loop.id))?.status !== "running",
    );
    if (state === "resolved")
      await loops.report(loop.id, "done", summary || "The room was resolved.");
    if (state === "paused") await loops.pause(loop.id, "the room is paused");
    if (state === "approval")
      await loops.pause(loop.id, "a bot waits for you to approve its brief");
    // "stopped": the loop is no longer running (stopped, or paused by a hand-off), so the driver must not end it here.
    return {
      status: state === "failed" ? "failed" : state === "cancelled" ? "cancelled" : "complete",
    };
  }
  for (let attempt = 0; ; attempt++) {
    try {
      const { follow } = await chatServices.chat.startTurn(actor, loop.conversationId, {
        content: label,
        clientRequestId: requestKey,
        loop: { id: loop.id, prompt },
      });
      let status = "failed";
      for await (const { event } of follow())
        if (event.type === "message") status = event.message.status;
      return { status };
    } catch (e) {
      if (!(e instanceof TurnBusyError) || attempt >= 60) throw e;
      await Bun.sleep(5_000);
    }
  }
});
loops.onStart = loopDriver.kick;
/** Boot: continue the Claude Code runs a restart cut off, in their own sessions. A conversation with an active goal loop is left to the loop driver. */
export async function resumeInterruptedRuns() {
  for (const r of chatServices.chat.takeResumable()) {
    void (async () => {
      if (await loops.active(r.conversationId)) return;
      const actor = await issueBackgroundActor(membershipLookup, r.ownerUserId);
      if (!actor) return;
      for (let attempt = 0; attempt < 60; attempt++) {
        try {
          const { follow } = await chatServices.chat.startTurn(actor, r.conversationId, {
            content: "Resuming after a server restart",
            clientRequestId: `resume:${r.messageId}`,
            resume: {
              sessionId: r.sessionId,
              prompt:
                "The server restarted while you were working on your previous reply. Continue the task from where you stopped; do not redo finished steps.",
            },
          });
          for await (const _ of follow());
          return;
        } catch (e) {
          if (!(e instanceof TurnBusyError)) return;
          await Bun.sleep(5_000);
        }
      }
    })().catch(() => {});
  }
}
export const loopServices = { driver: loopDriver };
const discussionWorker = createDiscussionWorker(
  db,
  discussions,
  chatServices.chat,
  membershipLookup,
);
discussions.onEnqueue = discussionWorker.kick;
export const discussionServices = {
  access: identity.access,
  store: discussions,
  worker: discussionWorker,
};
export const botDatabaseServices = { access: identity.access, db, database: botDatabase };
export const botClaudeServices = { access: identity.access, db, claude: createBotClaude(db) };
export const inboundServices = {
  access: identity.access,
  inbound: createInbound(db, mcp.plugins, chatServices.chat, membershipLookup),
};
export const featureServices = { access: identity.access, features };
export const decisionServices = { access: identity.access, decisions };
export const computerServices = { access: identity.access, computer, desktop, vms };
export const integrationServices = { access: identity.access, mcp, sources };
export const taskServices = { access: identity.access, tasks };
export const artifactServices = { access: identity.access, artifacts };
export const teamServices = { access: identity.access, store: teamStore };
export const agendaServices = {
  access: identity.access,
  agenda,
  scheduler: createAgendaScheduler(db, mcp.plugins, membershipLookup),
};
