import { createAuth, mcpResource } from "@zetta/auth";
import { createDb } from "@zetta/db";

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
import { createDbVmStore, createVmService, dockerVmConfig } from "./modules/computer/vm";
import { createFeaturesService } from "./modules/features/service";
import { createAgenda } from "./modules/agenda/service";
import { createLocalEmbedder } from "./modules/knowledge/embed";
import { createKnowledge as createCompanyKnowledge } from "./modules/knowledge/service";
import { audit } from "./modules/features/audit";
import { createOutputStyles } from "./modules/output-styles/service";
import { createMarket } from "./modules/skills/market";
import { createSkills } from "./modules/skills/service";
import { createWikiJobs } from "./modules/wiki/jobs";
import { createWikiAssist } from "./modules/wiki/assist";
import { createWikiGraph } from "./modules/wiki/graph";
import { createWiki } from "./modules/wiki/service";
import { createSearch } from "./modules/search/service";
import { createPreferenceStore } from "./modules/preferences/store";
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
// `decisions` is created further down; the callback only runs on a later settings update, after it exists.
const installation = createInstallationService(db, (s) =>
  decisions.setMode(s.laya, { preload: true, variant: layaModelFor(s.layaLanguages) }),
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
export const auth = createAuth(ENV, db, trustedExtraOrigins, {
  invitationSignupVerifier: createInvitationSignupPreflight(db),
  firstAccount: createFirstAccountSetup(db, setupKey),
});
const membershipLookup = createMembershipLookup(db);
export const identity = {
  access: createIdentityAccess(auth, membershipLookup),
  enrollment: createEnrollmentService(db),
  setupOpen: createSetupState(db),
  verifySetupKey: (key: string) => matchesConnectionKey(key, setupKey),
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
// Laya is a builtin plugin, off by default: the installation setting decides. ZETTA_LAYA_PRELOAD=0 loads it on first use instead of at boot.
decisions.setMode(installed.laya, {
  preload: process.env.ZETTA_LAYA_PRELOAD !== "0",
  variant: layaModelFor(installed.layaLanguages),
});
// Persistent per-user VMs (docker/desktop image): enable with ZETTA_DESKTOP_RUNTIME=docker.
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
// Company knowledge: the user's Drive documents, indexed in Postgres (see modules/knowledge).
const embedder = createLocalEmbedder();
const companyKnowledge = createCompanyKnowledge(db, {
  plugins: mcp.plugins,
  lookup: membershipLookup,
  embedder,
});
// The operator's wiki: pages all of a user's bots share (see modules/wiki).
const wiki = createWiki(db, { embedder });
// Decision-only bots (harness "decision") answer from the chosen option's text; the actor is rebuilt from the turn's authenticated user id.
const decisionRouting = createRouting(db, decisions, jev);
const turnRunner = createTurnRunner(
  db,
  undefined,
  undefined,
  wiki,
  createAttention(decisions),
  (b, text, userId) =>
    decisionRouting.reply(b, text, userId ? { userId, isAdmin: false } : undefined),
);
// Bots learn from finished work and the chief reviews the wiki, through the same turn runner as the chat.
const wikiJobs = createWikiJobs(db, { wiki, run: turnRunner, lookup: membershipLookup });
const skillsLibrary = createSkills(db);
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
      botDatabase,
      loops,
      routines: features.routines,
      tasks,
      artifacts,
      wiki,
      skills: { skills: skillsLibrary, market: skillsMarket },
      teams: teamStore,
      backgroundActor: (userId) => issueBackgroundActor(membershipLookup, userId),
    },
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
        // A routine has one chat for all its runs; the bot gets only the run before this one.
        history: "previous_turn",
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
// The chief's wiki review is a real chat turn too, in a conversation the lists leave out (see listConversations).
wikiJobs.useChat(async (userId, conversationId, prompt, requestKey) => {
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
        slugs: (meta?.receipts ?? []).flatMap((r) => (r.kind === "wiki" ? [r.id] : [])),
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
  chat: chatServices.chat,
};
export const botDatabaseServices = { access: identity.access, db, database: botDatabase };
export const botClaudeServices = { access: identity.access, db, claude: createBotClaude(db) };
export const inboundServices = {
  access: identity.access,
  inbound: createInbound(db, mcp.plugins, chatServices.chat, membershipLookup),
};
export const featureServices = { access: identity.access, features };
export const decisionServices = { access: identity.access, decisions };
export const computerServices = { access: identity.access, computer, vms };
export const integrationServices = { access: identity.access, mcp, sources };
export const taskServices = { access: identity.access, tasks };
export const preferenceServices = {
  access: identity.access,
  preferences: createPreferenceStore(db),
};
export const knowledgeServices = { access: identity.access, knowledge: companyKnowledge };
export const wikiServices = {
  access: identity.access,
  wiki,
  jobs: wikiJobs,
  graph: createWikiGraph(db),
  assist: createWikiAssist(db, { wiki }),
};
export const searchServices = { access: identity.access, search: createSearch(db) };
export const artifactServices = { access: identity.access, artifacts };
export const teamServices = { access: identity.access, store: teamStore };
export const outputStyleServices = { access: identity.access, styles: createOutputStyles(db) };
export const skillServices = {
  access: identity.access,
  db,
  skills: skillsLibrary,
  market: skillsMarket,
};
export const zettaMcpServices = {
  auth,
  resource: mcpResource(ENV),
  actorFor: (userId: string) => issueBackgroundActor(membershipLookup, userId),
  chat: chatServices.chat,
  mcp,
  connections,
  features,
  wiki,
  tasks,
  outputStyles: outputStyleServices.styles,
  audit: (ownerUserId: string, event: Parameters<typeof audit>[2]) => audit(db, ownerUserId, event),
};
export const agendaServices = {
  access: identity.access,
  agenda,
  scheduler: createAgendaScheduler(db, mcp.plugins, membershipLookup),
};
