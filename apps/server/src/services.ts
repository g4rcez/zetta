import { createAuth, mcpResource } from "@zetta/auth";
import { createDb } from "@zetta/db";
import { sql } from "@zetta/db/query";

import { ENV, desktopOrigins } from "./env.server";

import { layaModelFor } from "@zetta/core/laya-languages";
import { createAttention } from "./modules/chat/attention";
import { createRouting } from "./modules/chat/routing";
import { createTurnRunner } from "./modules/chat/pipeline";
import { createChatService } from "./modules/chat/service";
import { createDecisionService } from "./modules/decisions/service";
import { createJevDecider } from "./modules/decisions/jev";
import { createMcp } from "./modules/integrations/mcp";
import { createSources } from "./modules/integrations/sources";
import { createConnectionStore } from "./modules/connections/store";
import { createConnectionsService, PROVIDERS } from "./modules/connections/service";
import { createComputerService, dockerBrowserConfig } from "./modules/computer/service";
import { createMachineRunner } from "./modules/computer/machine-runner";
import { createMachineService } from "./modules/computer/machines";
import { vmSecretsFrom } from "./modules/computer/vm-secrets";
import {
  createDbVmStore,
  createVmService,
  dockerVmConfig,
  vmDriversFrom,
  vmOsFrom,
} from "./modules/computer/vm";
import { createFeaturesService } from "./modules/features/service";
import { createRoutinePollers } from "./modules/features/routine-pollers";
import { PluginError } from "./modules/integrations/plugins/registry";
import { createAgenda } from "./modules/agenda/service";
import { createLocalEmbedder } from "./modules/knowledge/embed";
import { createKnowledge as createCompanyKnowledge } from "./modules/knowledge/service";
import { audit } from "./modules/features/audit";
import { createOutputStyles } from "./modules/output-styles/service";
import { createMarket } from "./modules/skills/market";
import { createSkills } from "./modules/skills/service";
import { createPlayground } from "./modules/playground/service";
import { containerConfig, createContainerRunner } from "./modules/playground/runner-container";
import { createMemoryJobs } from "./modules/memory/jobs";
import { createMemoryAssist } from "./modules/memory/assist";
import { createMemoryGraph } from "./modules/memory/graph";
import { createMemory } from "./modules/memory/service";
import { createSearch } from "./modules/search/service";
import { createPreferenceStore } from "./modules/preferences/store";
import { createProfileStore } from "./modules/profile/store";
import { createTaskStore } from "./modules/tasks/store";
import { createArtifactStore } from "./modules/artifacts/store";
import { createAgendaScheduler } from "./modules/agenda/scheduler";
import { createDiscussionStore } from "./modules/discussions/store";
import { createTeamStore } from "./modules/teams/store";
import { createLoopDriver, createLoopStore } from "./modules/chat/loops";
import { createTaskHeartbeat } from "./modules/chat/task-heartbeat";
import { agentsPaused } from "./modules/preferences/agents-state";
import { createDiscussionWorker } from "./modules/discussions/worker";
import { createInbound } from "./modules/inbound/service";
import { createBotClaude } from "./modules/bot-claude/store";
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
import { events } from "./modules/events/bus";
import { work } from "./modules/events/work";
import { runsWork } from "./role";
import { memoizeSession } from "./session-memo";
import { createInvitationSignupPreflight } from "./modules/identity/signup-preflight";

// `bun --hot` re-runs this module on every edit: keep one connection pool per process instead of leaking a new one (100 connections
// fill up after a few dozen reloads).
const reloaded = globalThis as { zettaDb?: ReturnType<typeof createDb> };
export const db = (reloaded.zettaDb ??= createDb(ENV));
// `decisions` is created further down; the callback only runs on a later settings update, after it exists.
const installation = createInstallationService(db, (s) =>
  decisions.setMode(s.laya, {
    preload: true,
    variant: layaModelFor(s.layaLanguages),
    languages: s.layaLanguages,
  }),
);
// Network mode is read once at boot: it adds the public origin to every trusted-origin list and (in index.ts) opens the listener to the network.
const installed = await installation.load();
export const networkMode = installed.networkMode;
// Code access on the host runs the CLI as the server's own OS user, so one member's bot could read another member's files, VM tokens and browser
// profiles. Once Zetta is open to the network the CLI must run in the Docker runtime; ZETTA_CODE_ACCESS=host is the operator's explicit opt-out.
if (
  installed.networkMode === "network" &&
  process.env.ZETTA_HARNESS_RUNTIME !== "docker" &&
  process.env.ZETTA_CODE_ACCESS === undefined
) {
  process.env.ZETTA_CODE_ACCESS = "off";
  console.warn(
    "Code access is off: Zetta is open to the network and ZETTA_HARNESS_RUNTIME is not docker. Set ZETTA_HARNESS_RUNTIME=docker, or ZETTA_CODE_ACCESS=host to accept the risk.",
  );
}
export const trustedExtraOrigins = [
  ...desktopOrigins,
  ...(installed.networkMode === "network" && installed.publicUrl ? [installed.publicUrl] : []),
];
// The key typed in the browser at first run. A dedicated ZETTA_SETUP_KEY keeps the encryption key (ZETTA_CONNECTION_KEY) out of web forms,
// proxy logs and browser history; without it the connection key still works so existing installs keep booting.
const setupKey = process.env.ZETTA_SETUP_KEY?.trim() || ENV.ZETTA_CONNECTION_KEY;
if (setupKey === ENV.ZETTA_CONNECTION_KEY)
  console.warn(
    "ZETTA_SETUP_KEY is not set: first-run onboarding asks for ZETTA_CONNECTION_KEY. Set ZETTA_SETUP_KEY to a separate value.",
  );
/** For `GET /readyz`: the database answers. */
export const databaseReady = async () => {
  await db.execute(sql`select 1`);
  return true;
};
export const auth = memoizeSession(
  createAuth(ENV, db, trustedExtraOrigins, {
    invitationSignupVerifier: createInvitationSignupPreflight(db),
    firstAccount: createFirstAccountSetup(db, setupKey),
  }),
);
const membershipLookup = createMembershipLookup(db);
export const identity = {
  access: createIdentityAccess(auth, membershipLookup),
  enrollment: createEnrollmentService(db),
  setupOpen: createSetupState(db),
  verifySetupKey: (key: string) => matchesConnectionKey(key, setupKey),
};
export const eventServices = { access: identity.access, bus: events };
export const installationServices = {
  access: identity.access,
  installation,
  runningMode: installed.networkMode,
};

import { createFileStore } from "./modules/chat/files";

// Authorized server files live under ZETTA_FILES_ROOT (me/<userId>/… private, shared/… team-readable).
const files = createFileStore(process.env.ZETTA_FILES_ROOT ?? `${process.cwd()}/.zetta-files`);
const decisions = createDecisionService();
// Laya is a builtin plugin, on by default: the installation setting decides (an administrator can turn it off). The first boot downloads the weights.
// ZETTA_LAYA_PRELOAD=0 loads it on first use instead of at boot.
decisions.setMode(installed.laya, {
  preload: runsWork && process.env.ZETTA_LAYA_PRELOAD !== "0",
  variant: layaModelFor(installed.layaLanguages),
  languages: installed.layaLanguages,
});
// Persistent per-user VMs (docker/desktop image): enable with ZETTA_DESKTOP_RUNTIME=docker.
const vmDocker = dockerVmConfig();
const num = (v: string | undefined) => (v && /^\d+$/.test(v) ? Number(v) : undefined);
// An `api` process has no VMs: the worker owns them and the load balancer sends every /api/computer request there.
const vms =
  vmDocker && runsWork
    ? createVmService({
        store: createDbVmStore(db),
        docker: vmDocker,
        tokenRoot: process.env.ZETTA_VM_TOKEN_ROOT ?? `${process.cwd()}/.zetta-vm`,
        maxPerUser: num(process.env.ZETTA_VM_MAX_PER_USER),
        maxRunningPerUser: num(process.env.ZETTA_VM_MAX_RUNNING_PER_USER),
        maxRunning: num(process.env.ZETTA_VM_MAX_RUNNING),
        allowPrivate: process.env.ZETTA_ALLOW_PRIVATE_NETWORK === "1",
        vmDrivers: vmDriversFrom(process.env.ZETTA_VM_DRIVERS),
        vmOs: vmOsFrom(process.env.ZETTA_VM_OS),
        secrets: vmSecretsFrom(
          () => connections,
          (userId) => issueBackgroundActor(membershipLookup, userId),
        ),
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
// Machines (ssh, sftp, ftp) a bot reaches through the server. Secrets live in `connections`; this needs no state of its own.
const machines = createMachineService({
  db,
  connections,
  runner: createMachineRunner(),
  allowPrivate: process.env.ZETTA_ALLOW_PRIVATE_NETWORK === "1",
});
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
const teamStore = createTeamStore(db, discussions);
// Company knowledge: the user's Drive documents, indexed in Postgres (see modules/knowledge).
const embedder = createLocalEmbedder();
const companyKnowledge = createCompanyKnowledge(db, {
  plugins: mcp.plugins,
  lookup: membershipLookup,
  embedder,
});
// The operator's memory: pages all of a user's bots share (see modules/memory).
const memory = createMemory(db, { embedder });
// Decision-only bots (harness "decision") answer from the chosen option's text; the actor is rebuilt from the turn's authenticated user id.
const decisionRouting = createRouting(db, decisions, jev);
const turnRunner = createTurnRunner(
  db,
  undefined,
  undefined,
  memory,
  createAttention(decisions),
  (b, text, userId) =>
    decisionRouting.reply(b, text, userId ? { userId, isAdmin: false } : undefined),
);
// Bots learn from finished work and the chief reviews the memory, through the same turn runner as the chat.
const memoryJobs = createMemoryJobs(db, { memory, run: turnRunner, lookup: membershipLookup });
const agendaScheduler = createAgendaScheduler(db, mcp.plugins, membershipLookup);
const skillsLibrary = createSkills(db);
const containerConfigPlayground = containerConfig();
const playgroundContainers = containerConfigPlayground
  ? createContainerRunner(containerConfigPlayground)
  : undefined;
const playgrounds = createPlayground(db, {
  runners: playgroundContainers ? { container: playgroundContainers.run } : {},
});
const outputStyles = createOutputStyles(db);
const botClaude = createBotClaude(db);
const preferences = createPreferenceStore(db);
// The incoming-message service needs the chat service, which needs it back for its chief tools: a late-bound reference.
const inboundRef: { current?: ReturnType<typeof createInbound> } = {};
const skillsMarket = createMarket();
export const chatServices = {
  access: identity.access,
  chat: createChatService(
    db,
    turnRunner,
    files,
    computer,
    decisions,
    connections,
    { routine: features.routines.create as never, workflow: features.workflows.save as never },
    mcp,
    jev,
    undefined,
    vms,
    agenda,
    {
      discussions,
      loops,
      routines: features.routines,
      tasks,
      artifacts,
      playground: playgrounds,
      memory,
      skills: { skills: skillsLibrary, market: skillsMarket },
      teams: teamStore,
      outputStyles,
      features,
      botClaude,
      machines,
      preferences,
      sources: sources as never,
      knowledge: companyKnowledge,
      agendaScheduler,
      inbound: () => inboundRef.current,
      backgroundActor: (userId) => issueBackgroundActor(membershipLookup, userId),
    },
  ),
  files,
};
// Gmail and Home Assistant triggers poll with the owner's own plugin connections, the ones the bot's tools use.
features.routineTriggers.usePollers(
  createRoutinePollers(async (userId, pluginId) => {
    const actor = await issueBackgroundActor(membershipLookup, userId);
    if (!actor)
      throw new PluginError(
        "OWNER_INACTIVE",
        "The routine owner no longer has an active membership.",
      );
    return mcp.plugins.contextFor(actor, pluginId);
  }),
);
// Routines run as real chat turns (tools, computers, plugins) in their conversation, as the owner. A busy conversation (the owner is
// chatting in a routine that continues one chat) is retried for a while instead of failing the occurrence.
features.routines.useChat(async (userId, conversationId, prompt, requestKey, opts) => {
  const actor = await issueBackgroundActor(membershipLookup, userId);
  if (!actor) throw new Error("owner_inactive");
  for (let attempt = 0; ; attempt++) {
    try {
      const { follow } = await chatServices.chat.startTurn(actor, conversationId, {
        content: prompt,
        clientRequestId: requestKey,
        // A routine has one chat for all its runs; the bot gets only the run before this one.
        history: "previous_turn",
        // A run started by an outside event reads that event: the turn is tainted, so writes wait for the owner's approval.
        ...(opts?.untrusted ? { untrusted: true } : {}),
      });
      let saved: { status: string; content: string; meta?: unknown } | undefined;
      for await (const { event } of follow()) if (event.type === "message") saved = event.message;
      return {
        ok: saved?.status === "complete",
        text: saved?.content ?? "",
        error: (saved?.meta as { error?: string } | null | undefined)?.error,
      };
    } catch (e) {
      if (!(e instanceof TurnBusyError) || attempt >= 24) throw e;
      await Bun.sleep(5_000);
    }
  }
});
// The chief's memory review is a real chat turn too, in a conversation the lists leave out (see listConversations).
memoryJobs.useChat(async (userId, conversationId, prompt, requestKey) => {
  const actor = await issueBackgroundActor(membershipLookup, userId);
  if (!actor) return { ok: false, text: "", slugs: [], error: "OWNER_INACTIVE" };
  for (let attempt = 0; ; attempt++) {
    try {
      const { follow } = await chatServices.chat.startTurn(actor, conversationId, {
        content: prompt,
        clientRequestId: requestKey,
      });
      let saved: { status: string; content: string; meta?: unknown } | undefined;
      for await (const { event } of follow()) if (event.type === "message") saved = event.message;
      const meta = (saved?.meta ?? null) as {
        error?: string;
        receipts?: { kind: string; id: string }[];
      } | null;
      return {
        ok: saved?.status === "complete",
        text: saved?.content ?? "",
        slugs: (meta?.receipts ?? []).flatMap((r) => (r.kind === "memory" ? [r.id] : [])),
        error: meta?.error,
      };
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
    // A member's own loop wakes only that member and waits only for its turns; the facilitator's loop runs the whole room.
    const member = loop.botId !== room.createdByBotId ? loop.botId : undefined;
    const started = await discussions.startLoopStep(room.id, label, member);
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
      member,
    );
    // A resolved room ends a member's loop as cancelled: its goal was not checked by the done check.
    if (state === "resolved" && member)
      await loops.end(loop.id, "cancelled", "the room was resolved");
    else if (state === "resolved")
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
      let error: string | undefined;
      let detail: string | undefined;
      for await (const { event } of follow())
        if (event.type === "message") {
          status = event.message.status;
          error = (event.message.meta as { error?: string } | null)?.error;
          detail = status === "failed" ? event.message.content.slice(0, 500) : undefined;
        }
      return { status, error, detail };
    } catch (e) {
      if (!(e instanceof TurnBusyError) || attempt >= 60) throw e;
      await Bun.sleep(5_000);
    }
  }
});
// Task follow-up (chat/task-heartbeat.ts): a bot that took on a task is called back while the task is open. The check is a quiet turn in
// the task's chat (a `notice`: a short label in the chat, the hidden prompt for the bot), or in a room a wake-up of that one member.
const taskHeartbeat = createTaskHeartbeat({
  db,
  tasks,
  requestOf: (t) => tasks.requestOf(t),
  ownerPaused: (userId) => agentsPaused(db, userId),
  covered: async (t) => {
    const room = await discussions.byConversation(t.conversationId!);
    if (room?.status === "resolved" || room?.status === "cancelled") {
      await tasks.pauseFollowUp(t.id, "the room is closed");
      return true;
    }
    // A goal loop of this bot drives the work: the loop's steps are the follow-up.
    if (await loops.activeFor(t.conversationId!, t.botId!)) return true;
    if (room) return room.status === "paused";
    const actor = await issueBackgroundActor(membershipLookup, t.ownerUserId);
    return actor ? chatServices.chat.isBusy(actor, t.conversationId!) : false;
  },
  runTurn: async (task, label, prompt, requestKey) => {
    const actor = await issueBackgroundActor(membershipLookup, task.ownerUserId);
    if (!actor) throw new Error("owner_inactive");
    const room = await discussions.byConversation(task.conversationId!);
    if (room) {
      // Only the bot that owns the task is woken. Its prompt already lists its open tasks with their steps and progress.
      const started = await discussions.startLoopStep(
        room.id,
        `${label}\nDo the next open step, then update its steps and progress with zetta:task.`,
        task.botId!,
      );
      if (started.state !== "started")
        return { status: started.state === "cancelled" ? "cancelled" : "complete" };
      const { state } = await discussions.settle(
        room.id,
        started.since,
        async () => (await tasks.plan(task.id))?.task.followUp !== "auto",
        task.botId!,
      );
      return {
        status: state === "failed" ? "failed" : state === "cancelled" ? "cancelled" : "complete",
      };
    }
    for (let attempt = 0; ; attempt++) {
      try {
        const { follow } = await chatServices.chat.startTurn(actor, task.conversationId!, {
          content: label,
          clientRequestId: requestKey,
          notice: { prompt },
        });
        let status = "failed";
        let error: string | undefined;
        let detail: string | undefined;
        for await (const { event } of follow())
          if (event.type === "message") {
            status = event.message.status;
            error = (event.message.meta as { error?: string } | null)?.error;
            detail = status === "failed" ? event.message.content.slice(0, 500) : undefined;
          }
        return { status, error, detail };
      } catch (e) {
        if (!(e instanceof TurnBusyError) || attempt >= 60) throw e;
        await Bun.sleep(5_000);
      }
    }
  },
});
// A kick reaches the worker even when the request ran on an `api` process (over Postgres NOTIFY, see modules/events).
loops.onStart = (id) => work.kick("loop", id);
if (runsWork) work.on("loop", (id) => id && loopDriver.kick(id));
// A person moved, or deleted, a task a bot asked for: tell the bot with a turn in its chat. Best effort, after the change is saved.
tasks.onPersonTask = (e) => void chatServices.chat.notifyTask(e).catch(() => {});
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
export const taskFollowUp = { heartbeat: taskHeartbeat };
const discussionWorker = createDiscussionWorker(
  db,
  discussions,
  chatServices.chat,
  membershipLookup,
);
discussions.onEnqueue = () => work.kick("discussions");
if (runsWork) work.on("discussions", () => discussionWorker.kick());
export const discussionServices = {
  access: identity.access,
  store: discussions,
  worker: discussionWorker,
  chat: chatServices.chat,
};
export const botClaudeServices = { access: identity.access, db, claude: botClaude };
export const inboundServices = {
  access: identity.access,
  inbound: createInbound(db, mcp.plugins, chatServices.chat, membershipLookup),
};
inboundRef.current = inboundServices.inbound;
export const featureServices = { access: identity.access, features };
export const decisionServices = { access: identity.access, decisions };
export const computerServices = { access: identity.access, computer, vms, machines };
export const integrationServices = { access: identity.access, mcp, sources };
export const taskServices = { access: identity.access, tasks };
export const preferenceServices = {
  access: identity.access,
  preferences,
};
export const profileServices = {
  access: identity.access,
  profile: createProfileStore(db),
  // The session lookup is memoized per request, so this adds no query.
  currentSessionId: async (headers: Headers) =>
    (await auth.api.getSession({ headers }))?.session.id,
};
export const knowledgeServices = { access: identity.access, knowledge: companyKnowledge };
export const memoryServices = {
  access: identity.access,
  memory,
  jobs: memoryJobs,
  graph: createMemoryGraph(db),
  assist: createMemoryAssist(db, { memory }),
};
export const searchServices = { access: identity.access, search: createSearch(db) };
export const artifactServices = { access: identity.access, artifacts };
export const teamServices = { access: identity.access, store: teamStore };
export const outputStyleServices = { access: identity.access, styles: outputStyles };
export const skillServices = {
  access: identity.access,
  db,
  skills: skillsLibrary,
  market: skillsMarket,
};
export const playgroundServices = {
  access: identity.access,
  playground: playgrounds,
  containers: playgroundContainers,
};
export const zettaMcpServices = {
  auth,
  resource: mcpResource(ENV),
  actorFor: (userId: string) => issueBackgroundActor(membershipLookup, userId),
  chat: chatServices.chat,
  mcp,
  connections,
  features,
  memory,
  tasks,
  outputStyles: outputStyleServices.styles,
  audit: (ownerUserId: string, event: Parameters<typeof audit>[2]) => audit(db, ownerUserId, event),
};
export const agendaServices = {
  access: identity.access,
  agenda,
  scheduler: agendaScheduler,
};
