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
import { createAgendaScheduler } from "./modules/agenda/scheduler";
import { createDiscussionStore } from "./modules/discussions/store";
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
import { createInvitationSignupPreflight } from "./modules/identity/signup-preflight";

// `bun --hot` re-runs this module on every edit: keep one connection pool per process instead of leaking a new one (100 connections
// fill up after a few dozen reloads).
const reloaded = globalThis as { zettaDb?: ReturnType<typeof createDb> };
export const db = (reloaded.zettaDb ??= createDb(ENV));
export const auth = createAuth(ENV, db, desktopOrigins, {
  invitationSignupVerifier: createInvitationSignupPreflight(db),
  firstAccount: createFirstAccountSetup(db),
});
const membershipLookup = createMembershipLookup(db);
export const identity = {
  access: createIdentityAccess(auth, membershipLookup),
  enrollment: createEnrollmentService(db),
  setupOpen: createSetupState(db),
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

// Connections need ZETTA_CONNECTION_KEY (base64 of 32 random bytes: `openssl rand -base64 32`). Without it they stay disabled, never half-working.
let connectionStore: Awaited<ReturnType<typeof createConnectionStore>> | undefined;
if (process.env.ZETTA_CONNECTION_KEY) {
  // A busy or still-starting database (or another server opening the store at the same moment) must not disable secrets until the next restart.
  for (let attempt = 1; !connectionStore && attempt <= 5; attempt++) {
    try {
      connectionStore = await createConnectionStore(db, {
        configuration: {
          key: process.env.ZETTA_CONNECTION_KEY,
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
const discussions = createDiscussionStore(db);
// Each bot's private Postgres schema (modules/bot-database). Bot passwords are derived from this key; the app's database user needs CREATEROLE.
const botDbKey = process.env.ZETTA_BOT_DATABASE_KEY || process.env.ZETTA_CONNECTION_KEY;
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
    { discussions, botDatabase },
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
export const agendaServices = {
  access: identity.access,
  agenda,
  scheduler: createAgendaScheduler(db, mcp.plugins, membershipLookup),
};
