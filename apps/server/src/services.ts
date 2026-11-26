import { setInstallMode } from "./modules/integrations/plugins/local-only";
import { createHostAgentDesktopDriver } from "./modules/computer/drivers/host-agent-desktop";
import { createHostCuaDriver } from "./modules/computer/drivers/host-cua";
import { connectStdio } from "./modules/computer/mcp-client";
import { ComputerError } from "./modules/computer/service";
import { createAuth, mcpResource } from "@zetta/auth";
import { createDb } from "@zetta/db";
import { type ResolvedDatabase, resolveDatabase } from "@zetta/db/embedded/resolve";
import { and, eq, sql } from "@zetta/db/query";
import { bot } from "@zetta/db/schema/chat";
import { installationIdentity } from "@zetta/db/schema/identity";
import { createDesktopLink } from "./modules/desktop-link/service";
import { createDeviceHub } from "./modules/devices/hub";
import { createDeviceService } from "./modules/devices/service";
import { connection as connectionTable } from "@zetta/db/schema/connections";

import { ENV, desktopOrigins } from "./env.server";
import { localOrigins } from "./local-origins";

import { layaModelFor } from "@zetta/core/laya-languages";
import { createAttention } from "./modules/chat/attention";
import { createRouting } from "./modules/chat/routing";
import { createTurnRunner } from "./modules/chat/pipeline";
import { createChatService } from "./modules/chat/service";
import { createDecisionService } from "./modules/decisions/service";
import { createJevDecider } from "./modules/decisions/jev";
import { createMcp } from "./modules/integrations/mcp";
import { createMailboxStore } from "./modules/mail/store";
import { createMailService } from "./modules/mail/service";
import { createMessageStore } from "./modules/mail/messages";
import { createMailProviderReader } from "./modules/mail/provider-config";
import { createProvisioning, withProvisioning } from "./modules/mail/provision";
import { createMailPoller } from "./modules/mail/poller";
import { configureBotMail } from "./modules/integrations/plugins/botmail";
import { createMailChat } from "./modules/mail/chat";
import { createSources } from "./modules/integrations/sources";
import { createConnectionStore } from "./modules/connections/store";
import { createConnectionsService, PROVIDERS } from "./modules/connections/service";
import {
  assertPublicUrl,
  createComputerService,
  dockerBrowserConfig,
} from "./modules/computer/service";
import { createMachineRunner } from "./modules/computer/machine-runner";
import { createMachineService } from "./modules/computer/machines";
import { vmSecretsFrom } from "./modules/computer/vm-secrets";
import { createDbVmStore, createVmService, dockerVmConfig } from "./modules/computer/vm";
import { createFeaturesService } from "./modules/features/service";
import { createRoutinePollers } from "./modules/features/routine-pollers";
import { getPlugin, PluginError } from "./modules/integrations/plugins/registry";
import { configureGoogleLoopback } from "./modules/integrations/plugins/google/loopback";
import { createAgenda } from "./modules/agenda/service";
import { createLocalEmbedder } from "./modules/knowledge/embed";
import { createKnowledge as createCompanyKnowledge } from "./modules/knowledge/service";
import { hkdfSync } from "node:crypto";
import { audit } from "./modules/features/audit";
import { createOutputStyles } from "./modules/output-styles/service";
import { createMarket } from "./modules/skills/market";
import { createSkills } from "./modules/skills/service";
import { createBotQuality } from "./modules/bot-quality/service";
import { createSummaries } from "./modules/chat/summary";
import { createTranscribe } from "./modules/transcribe/service";
import { createConfiguredSynthesizer } from "./modules/speech/configured";
import { createConfiguredTranscriber, NO_KEY } from "./modules/transcribe/configured";
import { configureVideoTranscribe } from "./modules/integrations/plugins/video-transcribe";
import { createLocalTranscriber } from "./modules/transcribe/transcriber";
import { createVoiceService } from "./modules/voice/service";
import { createVoiceReadiness } from "./modules/voice/ready";
import { createPhoneProviderReader } from "./modules/phone/config";
import { TELNYX_PLUGIN_ID, telnyxAccountOf } from "./modules/phone/telnyx-plugin";
import { TWILIO_PLUGIN_ID, twilioAccountOf } from "./modules/phone/twilio-plugin";
import { createPhoneService, withPhoneHold } from "./modules/phone/service";
import { createPhoneCalls } from "./modules/phone/calls";
import { configurePhoneOut } from "./modules/phone/outbound";
import { createOutboundFacts } from "./modules/phone/outbound-facts";
import { phoneNumber as phoneNumberTable } from "@zetta/db/schema/phone";
import { createReplayStore } from "./modules/phone/replay";
import { instanceId } from "./modules/runtime/instance";
import { createSkillReview } from "./modules/memory/skill-review";
import { createLearning } from "./modules/learning";
import { createUsefulness } from "./modules/learning/usefulness";
import { createLessons } from "./modules/learning/lessons";
import { createBatch } from "./modules/learning/batch";
import { createTrial } from "./modules/learning/trial";
import { createFindings } from "./modules/learning/findings";
import { createTidy } from "./modules/learning/tidy";
import { createForget } from "./modules/learning/forget";
import { createProgress } from "./modules/learning/progress";
import { createLessonTools } from "./modules/learning/workflow-tool";
import { createLessonWorkflow } from "./modules/learning/workflow-template";
import { withTokenAudit } from "./modules/learning/cli";
import { cliWith } from "./modules/chat/harness";
import { createAnalyzerFor } from "./modules/bots/import/analyze";
import { createGrokSource } from "./modules/bots/import/grok-source";
import { createBotImport } from "./modules/bots/import/service";
import { createPlayground } from "./modules/playground/service";
import { createCodeAccess } from "./modules/settings/code-access";
import { configureCodeAccess } from "./modules/chat/code-access";
import { createPrivateNetworkPolicy } from "./modules/settings/private-network";
import { checkInstallationServer } from "./modules/integrations/plugins/whatsapp";
import { createAppAuthor } from "./modules/apps/author";
import { createApps } from "./modules/apps/service";
import { configureApps } from "./modules/integrations/plugins/apps";
import { configureMailbox } from "./modules/integrations/plugins/mailbox";
import { createGoogleMailAccess } from "./modules/integrations/plugins/google/mail-access";
import { createMicrosoftMailAccess } from "./modules/integrations/plugins/microsoft/mail-access";
import { containerConfig, createContainerRunner } from "./modules/playground/runner-container";
import { createMemoryJobs } from "./modules/memory/jobs";
import { createMemoryScreen } from "./modules/memory/screen";
import { createMemoryAssist } from "./modules/memory/assist";
import { createMemoryGraph } from "./modules/memory/graph";
import { createMemory } from "./modules/memory/service";
import { createSearch } from "./modules/search/service";
import { createPreferenceStore } from "./modules/preferences/store";
import { createPeopleDirectory } from "./modules/people/directory";
import { currentBuild } from "./modules/updates/build-info";
import { syncUpdateCard } from "./modules/updates/card";
import { createUpdateChecker } from "./modules/updates/checker";
import { createProfileStore } from "./modules/profile/store";
import { createAvatarStore } from "./modules/avatars/store";
import { createTaskStore } from "./modules/tasks/store";
import { createOneShot } from "./modules/chat/one-shot";
import { createOrgStore } from "./modules/org/store";
import { createProjectDraft } from "./modules/projects/draft";
import { createProjectStore } from "./modules/projects/store";
import { createProjectWork } from "./modules/projects/work";
import { createWorkActions } from "./modules/work/actions";
import { createWorkScan } from "./modules/work/scan";
import { createCatchUpActions } from "./modules/catch-up/act";
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
  type ActiveActor,
} from "./modules/identity/access";
import { TurnBusyError } from "./modules/chat/turns";
import { createFirstAccountSetup, createSetupState } from "./modules/identity/first-account";
import { matchesConnectionKey } from "./modules/identity/setup-key";
import { createInstallationService } from "./modules/installation/service";
import { createSettingsService } from "./modules/settings/service";
import { importEnvSettings } from "./modules/settings/import-env";
import { importLegacyVoiceSettings } from "./modules/settings/import-legacy-voice";
import { createInstallationKeyReader } from "./modules/connections/installation-key";
import { createSpeechReader } from "./modules/installation/speech";
import { createPushReader } from "./modules/installation/push";
import { topics } from "@zetta/core/live-topics";
import { dataDir } from "@zetta/core/zetta-home";
import { events } from "./modules/events/bus";
import { work } from "./modules/events/work";
import { runsWork } from "./role";
import { memoizeSession } from "./session-memo";
import { createInvitationSignupPreflight } from "./modules/identity/signup-preflight";

// `bun --hot` re-runs this module on every edit: keep one connection pool per process instead of leaking a new one (100 connections
// fill up after a few dozen reloads).
const reloaded = globalThis as {
  zettaDb?: ReturnType<typeof createDb>;
  zettaDatabase?: ResolvedDatabase;
};
// An empty DATABASE_URL starts (or adopts) the Postgres that ships inside Zetta and applies pending migrations before anything reads it.
export const database = (reloaded.zettaDatabase ??= await resolveDatabase(ENV));
export const db = (reloaded.zettaDb ??= createDb({ DATABASE_URL: database.url }));
// `decisions` is created further down; the callback only runs on a later settings update, after it exists.
const installation = createInstallationService(db, (s) =>
  decisions.setMode(s.laya, {
    preload: true,
    variant: layaModelFor(s.layaLanguages),
    languages: s.layaLanguages,
  }),
);
// Server settings (modules/settings): the typed values of the registry in `@zetta/core/settings`, stored in `zetta.setting`. A variable that an
// administrator set before a setting moved to the database is imported once here; it writes only what is missing.
export const settings = createSettingsService({
  db,
  audit: (userId, c) =>
    void audit(db, userId, {
      kind: "setting",
      outcome: "ok",
      subjectId: c.key,
      detail: `${c.change}${c.scope === "organization" ? ":org" : ""}`,
    }),
});
await importEnvSettings({ db, env: process.env });
await importLegacyVoiceSettings({ db, env: process.env });
// The synchronous readers (`peek`: code access) start with the rows in hand; a database that does not answer leaves them closed.
await settings.warm().catch((e) => console.warn("settings could not be read at start:", e));
/** May the server call private, loopback and link-local addresses? The setting `allowPrivateNetwork`, asked at every check; a failed read is a no. */
export const privateNetwork = createPrivateNetworkPolicy(settings);
// Network mode is read once at boot: it adds the public origin to every trusted-origin list and (in index.ts) opens the listener to the network.
const installed = await installation.load();
export const networkMode = installed.networkMode;
// Plugins that act on this machine (Obsidian, Apple apps) work only on a local install.
setInstallMode(installed.networkMode);
// Code access on the host runs the CLI as the server's own OS user, so one member's bot could read another member's files, VM tokens and browser
// profiles. Once Zetta is open to the network the CLI must run in the Docker runtime, so code is off there whatever the setting `codeAccess`
// says (modules/settings/code-access.ts, decided at every call; nothing writes the process environment).
export const codeAccess = createCodeAccess({
  settings,
  networkMode: () => installed.networkMode,
  harnessRuntime: () => process.env.ZETTA_HARNESS_RUNTIME,
});
configureCodeAccess(codeAccess.allowed);
if (installed.networkMode === "network" && process.env.ZETTA_HARNESS_RUNTIME !== "docker")
  console.warn(
    "Code access is off: Zetta is open to the network and ZETTA_HARNESS_RUNTIME is not docker. Set ZETTA_HARNESS_RUNTIME=docker to let bots run code.",
  );
/** `ZETTA_EXTRA_ORIGINS`: comma-separated https origins that may also sign in (for example a Tailscale address). Anything else is dropped. */
const extraOrigins = (process.env.ZETTA_EXTRA_ORIGINS ?? "")
  .split(",")
  .map((o) => o.trim())
  .flatMap((o) => {
    try {
      const url = new URL(o);
      return url.protocol === "https:" ? [url.origin] : [];
    } catch {
      return [];
    }
  });
export const trustedExtraOrigins = [
  ...desktopOrigins,
  ...localOrigins(ENV.ZETTA_SERVER_URL),
  ...extraOrigins,
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
/** One public address: the API and the web app share the origin, so Better Auth's base URL and its trusted origin are the same. */
const authConfig = {
  BETTER_AUTH_URL: ENV.ZETTA_SERVER_URL,
  BETTER_AUTH_SECRET: ENV.BETTER_AUTH_SECRET,
  CORS_ORIGIN: ENV.ZETTA_SERVER_URL,
};
export const auth = memoizeSession(
  createAuth(authConfig, db, trustedExtraOrigins, {
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

import { createFileStore } from "./modules/chat/files";

// Authorized server files live under ZETTA_FILES_ROOT (me/<userId>/… private, shared/… team-readable).
const files = createFileStore(
  process.env.ZETTA_FILES_ROOT ?? dataDir("files", `${process.cwd()}/.zetta-files`),
);
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
// An `api` process has no VMs: the worker owns them and the load balancer sends every /api/computer request there.
// This machine's own desktop (target "local"): only on a local install, through agent-desktop on the host (computer/placement.ts).
/** Opens an address in the person's default browser, signed in as they are: macOS, Windows (`start` needs an empty title first), Linux. */
const openInBrowser = async (url: string) => {
  const cmd =
    process.platform === "darwin"
      ? ["open", url]
      : process.platform === "win32"
        ? ["cmd", "/c", "start", "", url]
        : ["xdg-open", url];
  const p = Bun.spawn(cmd, { stdout: "ignore", stderr: "ignore", stdin: "ignore" });
  if ((await p.exited) !== 0) throw new ComputerError("UNAVAILABLE");
};
const hostAgentDesktop =
  installed.networkMode === "local" && Bun.which("agent-desktop")
    ? () =>
        createHostAgentDesktopDriver(
          async (args, o) => {
            const p = Bun.spawn(["agent-desktop", ...args], {
              stdout: "pipe",
              stderr: "ignore",
              stdin: "ignore",
              ...(o?.signal ? { signal: o.signal } : {}),
            });
            const timer = o?.timeout ? setTimeout(() => p.kill(), o.timeout) : undefined;
            const stdout = await new Response(p.stdout).text();
            const code = await p.exited;
            clearTimeout(timer);
            return { code, stdout };
          },
          openInBrowser,
          // Linux (X11): keys and typing through xdotool when it is installed (see host-agent-desktop.ts).
          process.platform === "linux" && Bun.which("xdotool")
            ? {
                xdotool: async (args, o) => {
                  const p = Bun.spawn(["xdotool", ...args], {
                    stdout: "pipe",
                    stderr: "ignore",
                    stdin: "ignore",
                    ...(o?.signal ? { signal: o.signal } : {}),
                  });
                  const stdout = await new Response(p.stdout).text();
                  return { code: await p.exited, stdout };
                },
              }
            : {},
        )
    : undefined;
// The same desktop through cua-driver when it is installed (one MCP session on stdio for the server's life).
const cuaHost =
  installed.networkMode === "local" && Bun.which("cua-driver")
    ? connectStdio("cua-driver", ["mcp"])
    : undefined;
const hostDesktop =
  hostAgentDesktop || cuaHost
    ? {
        ...(hostAgentDesktop ? { "agent-desktop": hostAgentDesktop } : {}),
        ...(cuaHost
          ? {
              cua: () =>
                createHostCuaDriver(
                  async (tool, args, o) => (await cuaHost()).call(tool, args, o),
                  openInBrowser,
                ),
            }
          : {}),
      }
    : undefined;
const vms =
  (vmDocker || hostDesktop) && runsWork
    ? createVmService({
        store: createDbVmStore(db),
        // Without a container runtime the VM target is off (vmOn) and only this machine and remote computers are offered.
        docker: vmDocker ?? {
          bin: "docker",
          image: "zetta-desktop:latest",
          memory: "2g",
          cpus: "2",
          pids: 1024,
          shm: "1g",
        },
        vmOn: Boolean(vmDocker),
        install: installed.networkMode,
        ...(hostDesktop ? { host: hostDesktop } : {}),
        tokenRoot: process.env.ZETTA_VM_TOKEN_ROOT ?? dataDir("vm", `${process.cwd()}/.zetta-vm`),
        settings,
        allowPrivate: privateNetwork.allowed,
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
  // Open to the network: a bot's browser never runs on the server itself (see computer/placement.ts).
  install: installed.networkMode,
  docker: dockerBrowserConfig(),
  db,
  root: process.env.ZETTA_BROWSER_ROOT ?? dataDir("browser", `${process.cwd()}/.zetta-browser`),
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
// Computers paired through the desktop app: they connect here, and a bot calls them like a machine.
const deviceHub = createDeviceHub();
const devices = createDeviceService({ db, hub: deviceHub });
// Machines (ssh, sftp, ftp) a bot reaches through the server. Secrets live in `connections`; this needs no state of its own.
const machines = createMachineService({
  db,
  connections,
  runner: createMachineRunner(),
  allowPrivate: privateNetwork.allowed,
  devices,
});
/**
 * The speech-to-text key of the whole installation. An administrator saves it as a connection of their own (sealed like any other); the
 * installation settings record which one. Voice notes of outside people have no signed-in administrator, so the key is read here by the
 * connection's owner, at the moment it is used, and never leaves this file as anything but the buffer the caller zeroes.
 */
const connectionOwner = async (id: string) =>
  (
    await db
      .select({ owner: connectionTable.ownerUserId })
      .from(connectionTable)
      .where(eq(connectionTable.id, id))
  )[0]?.owner;
const transcribeKey = {
  async state(id: string | null): Promise<"none" | "set" | "unavailable"> {
    if (!id) return "none";
    const owner = await connectionOwner(id);
    const actor = owner ? await issueBackgroundActor(membershipLookup, owner) : null;
    if (!actor) return "unavailable";
    const mine = (await connections.list(actor).catch(() => [])).find((c) => c.id === id);
    return mine?.state === "active" ? "set" : "unavailable";
  },
  /** The key as bytes (the caller zeroes them), or undefined when there is none to use. */
  async secret(id: string | null): Promise<Buffer | undefined> {
    if (!id) return undefined;
    const owner = await connectionOwner(id);
    const actor = owner ? await issueBackgroundActor(membershipLookup, owner) : null;
    return actor ? Buffer.from(await connections.secretFor(actor, id)) : undefined;
  },
  /** Points the installation at a new key (or none) and revokes the one it had, whoever saved it. */
  async set(id: string | null) {
    const before = (await installation.load()).transcribeConnectionId;
    await installation.update({ transcribeConnectionId: id });
    if (!before || before === id) return;
    const owner = await connectionOwner(before);
    const actor = owner ? await issueBackgroundActor(membershipLookup, owner) : null;
    const old = actor
      ? (await connections.list(actor).catch(() => [])).find((c) => c.id === before)
      : undefined;
    if (actor && old?.state === "active")
      await connections.revoke(actor, before, old.revision).catch(() => undefined);
  },
};
/**
 * Read access to the other sealed keys of the installation (wave 2): the speech-out provider key and the private VAPID key of push. The
 * same in every ZETTA_ROLE (both read the database and share ZETTA_CONNECTION_KEY). Writing them is the feature's own route.
 */
const installationKeyDeps = {
  owner: connectionOwner,
  actorFor: (userId: string) => issueBackgroundActor(membershipLookup, userId),
  connections,
};
export const speechKey = createInstallationKeyReader(installationKeyDeps);
export const pushKey = createInstallationKeyReader(installationKeyDeps);
/** The key of the WhatsApp server every person shares (Studio > Plugins > WhatsApp > Server for everyone): a sealed connection of an administrator, recorded in the installation settings. */
export const wahaKey = createInstallationKeyReader(installationKeyDeps);
/** The shared WhatsApp server as the WhatsApp plugin reads it at every call: the setting `wahaUrl` and the sealed key (bytes; the plugin zeroes them). */
const wahaServer = async () => ({
  url: await settings.get("wahaUrl"),
  key: await wahaKey.secret((await installation.load()).wahaConnectionId),
});
export const speechReader = createSpeechReader({ load: () => installation.load(), key: speechKey });
export const pushReader = createPushReader({ load: () => installation.load(), key: pushKey });
/** The key of bot e-mail addresses (Studio > Plugins > Bot e-mail address): a sealed connection of an administrator, recorded in the installation settings. */
export const mailKey = createInstallationKeyReader(installationKeyDeps);
export const mailReader = createMailProviderReader({
  load: () => installation.load(),
  key: mailKey,
});
/** Points the installation at a new mail key (or none) and revokes the one it had, whoever saved it. Same as `transcribeKey.set`. */
export const mailKeyAdmin = {
  async set(id: string | null) {
    const before = (await installation.load()).mailConnectionId;
    await installation.update({ mailConnectionId: id });
    if (!before || before === id) return;
    const owner = await connectionOwner(before);
    const actor = owner ? await issueBackgroundActor(membershipLookup, owner) : null;
    const old = actor
      ? (await connections.list(actor).catch(() => [])).find((c) => c.id === before)
      : undefined;
    if (actor && old?.state === "active")
      await connections.revoke(actor, before, old.revision).catch(() => undefined);
  },
};
/** The key of the phone provider (Studio > Phone numbers): a sealed connection of an administrator, recorded in the installation settings. */
export const phoneKey = createInstallationKeyReader(installationKeyDeps);
/** The Auth Token of the Twilio account (Studio > Phone numbers): its own sealed connection, so both providers can be set up at once. */
export const phoneTwilioKey = createInstallationKeyReader(installationKeyDeps);
export const phoneReader = createPhoneProviderReader({
  load: () => installation.load(),
  key: phoneKey,
  twilioKey: phoneTwilioKey,
  // The Telnyx account of the number's owner: the Telnyx plugin's configuration (their own, else the administrator's team one).
  telnyxAccount: async (userId) => {
    const actor = await issueBackgroundActor(membershipLookup, userId);
    if (!actor) return undefined;
    return telnyxAccountOf((await mcp.plugins.contextFor(actor, TELNYX_PLUGIN_ID)).config);
  },
  twilioAccount: async (userId) => {
    const actor = await issueBackgroundActor(membershipLookup, userId);
    if (!actor) return undefined;
    return twilioAccountOf((await mcp.plugins.contextFor(actor, TWILIO_PLUGIN_ID)).config);
  },
});
/** Points the installation at a new WhatsApp server key (or none) and revokes the one it had, whoever saved it. Same as `mailKeyAdmin.set`. */
export const wahaKeyAdmin = {
  async set(id: string | null) {
    const before = (await installation.load()).wahaConnectionId;
    await installation.update({ wahaConnectionId: id });
    if (!before || before === id) return;
    const owner = await connectionOwner(before);
    const actor = owner ? await issueBackgroundActor(membershipLookup, owner) : null;
    const old = actor
      ? (await connections.list(actor).catch(() => [])).find((c) => c.id === before)
      : undefined;
    if (actor && old?.state === "active")
      await connections.revoke(actor, before, old.revision).catch(() => undefined);
  },
};
/** Points the installation at a new phone key (or none) and revokes the one it had, whoever saved it. Same as `mailKeyAdmin.set`. */
export const phoneKeyAdmin = {
  async set(id: string | null) {
    const before = (await installation.load()).phoneConnectionId;
    await installation.update({ phoneConnectionId: id });
    if (!before || before === id) return;
    const owner = await connectionOwner(before);
    const actor = owner ? await issueBackgroundActor(membershipLookup, owner) : null;
    const old = actor
      ? (await connections.list(actor).catch(() => [])).find((c) => c.id === before)
      : undefined;
    if (actor && old?.state === "active")
      await connections.revoke(actor, before, old.revision).catch(() => undefined);
  },
};
/** Points the installation at a new Twilio Auth Token (or none) and revokes the one it had. Same as `phoneKeyAdmin.set`. */
export const phoneTwilioKeyAdmin = {
  async set(id: string | null) {
    const before = (await installation.load()).phoneTwilioConnectionId;
    await installation.update({ phoneTwilioConnectionId: id });
    if (!before || before === id) return;
    const owner = await connectionOwner(before);
    const actor = owner ? await issueBackgroundActor(membershipLookup, owner) : null;
    const old = actor
      ? (await connections.list(actor).catch(() => [])).find((c) => c.id === before)
      : undefined;
    if (actor && old?.state === "active")
      await connections.revoke(actor, before, old.revision).catch(() => undefined);
  },
};
/** Phone numbers of bots (modules/phone): asking, approval, review, hold and release. Calls are a later step. */
export const phone = createPhoneService({
  db,
  reader: phoneReader,
  audit: async (e) => {
    const [b] = e.botId
      ? await db.select({ owner: bot.ownerUserId }).from(bot).where(eq(bot.id, e.botId))
      : [];
    const owner = e.actor ?? b?.owner;
    if (owner)
      await audit(db, owner, { kind: "connection", outcome: "ok", botId: e.botId, detail: e.kind });
  },
});
/** Points the installation at a new text-to-speech key (or none) and revokes the one it had, whoever saved it. Same as `transcribeKey.set`. */
export const speechKeyAdmin = {
  async set(id: string | null) {
    const before = (await installation.load()).speechConnectionId;
    await installation.update({ speechConnectionId: id });
    if (!before || before === id) return;
    const owner = await connectionOwner(before);
    const actor = owner ? await issueBackgroundActor(membershipLookup, owner) : null;
    const old = actor
      ? (await connections.list(actor).catch(() => [])).find((c) => c.id === before)
      : undefined;
    if (actor && old?.state === "active")
      await connections.revoke(actor, before, old.revision).catch(() => undefined);
  },
};
export const connectionServices = {
  access: identity.access,
  connections,
  transcribeKey,
  speechKey: speechKeyAdmin,
  mailKey: mailKeyAdmin,
  phoneKey: phoneKeyAdmin,
  phoneTwilioKey: phoneTwilioKeyAdmin,
  wahaKey: wahaKeyAdmin,
};
// Mailboxes: read live from the person's mail server, the password a sealed connection. Any instance may serve the reads (the IMAP pool is per process).
const mailboxStore = createMailboxStore(db);
// A Google account connected in the Google plugin is a mailbox too: its token is borrowed from the plugin per request, never copied (mail/drivers/google.ts).
const mailMessages = createMessageStore(db);
const mailService = createMailService({
  store: mailboxStore,
  secrets: connections,
  // Bot addresses: the mail is in Postgres, the provider is the one the administrator chose (nothing without a key).
  provisioned: {
    messages: mailMessages,
    provider: () => mailReader.provider(),
    displayName: async (botId, fallback) => {
      const [row] = botId
        ? await db.select({ name: bot.name }).from(bot).where(eq(bot.id, botId))
        : [];
      return row?.name ?? fallback;
    },
  },
  google: createGoogleMailAccess({
    context: (a) => mcp.plugins.ownContextFor(a, "google"),
  }),
  // The same for an Outlook.com or Microsoft 365 account connected in the Microsoft plugin (mail/drivers/microsoft.ts).
  microsoft: createMicrosoftMailAccess({
    context: (a) => mcp.plugins.ownContextFor(a, "microsoft"),
  }),
});
/** The mailbox rows with the Google accounts among them, for the readers that take a row (the bots' plugin, the MCP server). */
const mailboxRows = {
  list: async (a: ActiveActor, f: { botId?: string } = {}) =>
    (await mailService.rows(a)).filter((m) => !f.botId || m.botId === f.botId),
};
/** Gives a bot its address when it is created and retires it when it is archived (best effort, outside the bot's own transaction). */
export const mailProvisioning = createProvisioning({ db, store: mailboxStore, reader: mailReader });
export const mailServices = {
  access: identity.access,
  mail: mailService,
  provisioning: mailProvisioning,
  chat: createMailChat({
    db,
    store: mailboxStore,
    // The chat service is built further down; it is only used when a request arrives.
    chiefOf: async (a) => {
      const chief = await chatServices.chat.ensureChief(a);
      if (!chief) throw new Error("No Chief for this person.");
      return chief;
    },
    created: (a) => events.publish([a.userId], topics.conversations),
  }),
};
// Bots read the mail of the mailboxes they own (the Chief: the unowned ones), only in a chat no one but the owner can read (mail/access.ts).
configureMailbox({
  store: mailboxRows,
  mail: mailService,
  // Signs the mail a card shows: derived from the installation key and the person, so a card nobody here signed sends nothing.
  sealKey: (userId) =>
    Buffer.from(
      hkdfSync(
        "sha256",
        Buffer.from(ENV.ZETTA_CONNECTION_KEY, "base64"),
        Buffer.alloc(0),
        `zetta.mailbox.send-approval.v1:${userId}`,
        32,
      ),
    ).toString("base64"),
  // Closed tokens and ids only (the trail takes nothing else): the mailbox, the tool, what happened and how many people.
  audit: (userId, e) =>
    void audit(db, userId, {
      kind: "tool_call",
      outcome: e.outcome,
      botId: e.botId,
      subjectId: e.subjectId,
      detail: e.detail,
    }),
  actorFor: (userId) => issueBackgroundActor(membershipLookup, userId),
  async botOf(userId, botId) {
    const [row] = await db
      .select({ id: bot.id, kind: bot.kind, ownerUserId: bot.ownerUserId })
      .from(bot)
      .where(and(eq(bot.id, botId), eq(bot.ownerUserId, userId), eq(bot.archived, false)));
    return row ?? null;
  },
});
// The reply door of a bot's own address, offered only in the turns an allowed outside sender starts (plugins/botmail.ts).
configureBotMail({
  mail: mailService,
  mailboxOf: (a, botId) => mailboxStore.provisionedOf(a, botId),
  latestFrom: (mailboxId, address) => mailMessages.latestFrom(mailboxId, address),
  actorFor: (userId) => issueBackgroundActor(membershipLookup, userId),
  audit: (userId, e) =>
    void audit(db, userId, {
      kind: "tool_call",
      outcome: e.outcome,
      botId: e.botId,
      subjectId: e.subjectId,
      detail: e.detail,
    }),
});
// Administrator opt-in: lets MCP servers and the WhatsApp (WAHA) plugin reach private/localhost addresses (e.g. a WAHA container). Off by default.
const mcp = createMcp(db, connections, {
  allowPrivate: privateNetwork.allowed,
  wahaServer,
  settings,
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
const projects = createProjectStore(db);
const org = createOrgStore(db);
const profileStore = createProfileStore(db);
const avatarStore = createAvatarStore(db);
const artifacts = createArtifactStore(db, undefined, settings);
const loops = createLoopStore(db);
const discussions = createDiscussionStore(db, files, loops, settings);
const teamStore = createTeamStore(db, discussions);
// Company knowledge: the user's Drive documents, indexed in Postgres (see modules/knowledge).
const embedder = createLocalEmbedder({ settings });
const companyKnowledge = createCompanyKnowledge(db, {
  plugins: mcp.plugins,
  lookup: membershipLookup,
  embedder,
});
// The operator's memory: pages all of a user's bots share (see modules/memory).
const memory = createMemory(db, { embedder });
// Decision-only bots (harness "decision") answer from the chosen option's text; the actor is rebuilt from the turn's authenticated user id.
const decisionRouting = createRouting(db, decisions, jev);
// Claude Code live input, light runs and host skills are settings read on every run: the CLI functions carry the settings service.
const harnessCli = cliWith(settings);
const turnRunner = createTurnRunner(
  db,
  harnessCli.run,
  harnessCli.stream,
  memory,
  createAttention(decisions),
  (b, text, userId) =>
    decisionRouting.reply(b, text, userId ? { userId, isAdmin: false } : undefined),
  settings,
);
// Bots learn from finished work and the chief reviews the memory, through the same turn runner as the chat.
const memoryJobs = createMemoryJobs(db, {
  memory,
  run: turnRunner,
  lookup: membershipLookup,
  // A source added to the memory is checked by the person's chief before a bot reads it, and a web address is read in the browser
  // profile "memory" (the same guarded reader the chat's /browse uses).
  screen: createMemoryScreen(db),
  readPage: (owner, url) => computer.read(owner, "memory", url),
  settings,
});
const agendaScheduler = createAgendaScheduler(db, mcp.plugins, membershipLookup);
// "Agenda cannot sync" and "Company knowledge cannot read your Drive" cards stay until the next sync works: after Google is connected, sync now.
mcp.plugins.onConnected(async (actor, id) => {
  if (id !== "google") return;
  await Promise.allSettled([
    agendaScheduler.syncIfEnabled(actor),
    companyKnowledge.syncUser(actor), // refuses by itself when company knowledge is not turned on
  ]);
});
const skillsLibrary = createSkills(db);
// Autolearn: after a correction or a method that worked, a review may save what the bot learned as one of its own skills.
export const skillReview = createSkillReview(db, skillsLibrary);
/** What each reply had in front of it and whether the person had to step in afterwards (modules/learning). */
export const learning = createLearning(db);
/** The lessons of the bots (modules/learning): built early because the Chief's `zetta:lessons` block and the chat prompt use them. */
export const lessons = createLessons(db, { memory });
export const lessonProgress = createProgress(db);
// The `lessons` tool of a workflow's `zetta` step, and of the Chief's `zetta:lessons` block (modules/learning/workflow-tool.ts).
const lessonTools = createLessonTools({ lessons, progress: lessonProgress });
/** Speech to text on this machine (modules/transcribe): the web microphone, and voice notes of outside people (inbound). */
export const transcriber = createConfiguredTranscriber({
  settings: () => installation.load(),
  local: createLocalTranscriber(),
  key: async (id) => {
    const secret = await transcribeKey.secret(id);
    if (!secret && id) throw NO_KEY;
    return secret;
  },
  allowPrivate: privateNetwork.allowed,
});
export const transcribe = createTranscribe(transcriber);
// The video transcription plugin sends a video's sound to the same recognizer, and reads the Voice switch on every call.
configureVideoTranscribe({
  transcriber,
  speechOn: async () => (await installation.load()).transcribeProvider !== "off",
});
/** Text to speech (modules/speech): the "Listen" button of a bot message, and later the voice conversation. Read per call, like speech to text. */
export const synthesizer = createConfiguredSynthesizer({
  settings: () => speechReader.settings(),
  key: () => speechReader.secret(),
  allowPrivate: privateNetwork.allowed,
});
/**
 * The daily "newer version" check (modules/updates). Its ticker is in index.ts and only the process that runs work raises the Catch up card;
 * an `api` process answers from its own check when asked.
 */
export const updateChecker = createUpdateChecker({
  build: currentBuild(),
  feedUrl: process.env.ZETTA_UPDATE_FEED,
  operatorOff: process.env.ZETTA_UPDATE_CHECK === "off",
  mode: async () => (await installation.load()).updateCheck,
  allowPrivate: privateNetwork.allowed,
  assertPublic: assertPublicUrl,
  ...(runsWork ? { onVerdict: (v) => syncUpdateCard(db, v) } : { lazy: true }),
});
export const settingsServices = { access: identity.access, settings };
export const installationServices = {
  access: identity.access,
  installation,
  runningMode: installed.networkMode,
  transcriber,
  transcribeKey,
  speech: { synthesizer, key: speechKey },
  mail: { reader: mailReader, key: mailKey },
  phone: { reader: phoneReader, key: phoneKey, twilioKey: phoneTwilioKey },
  waha: { key: wahaKey, check: checkInstallationServer },
  allowPrivate: privateNetwork.allowed,
  updates: updateChecker,
};
/** The rolling summary of long chats (chat/summary.ts); its refresh job runs on the ticker in index.ts. */
export const chatSummaries = createSummaries(db, createOneShot(db));
const containerConfigPlayground = containerConfig();
const playgroundContainers = containerConfigPlayground
  ? createContainerRunner(containerConfigPlayground)
  : undefined;
const playgrounds = createPlayground(db, {
  hostCode: codeAccess.hostRunner,
  runners: playgroundContainers ? { container: playgroundContainers.run } : {},
});
// Zetta Apps: published code whose tools bots call through the built-in `apps` plugin (docs/decisions/apps.md).
export const apps = createApps(db, {
  hostCode: codeAccess.hostRunner,
  runners: playgroundContainers ? { container: playgroundContainers.run } : {},
});
const appAuthor = createAppAuthor({ apps, playgrounds });
configureApps({
  apps,
  actorFor: (userId) => issueBackgroundActor(membershipLookup, userId),
});
const outputStyles = createOutputStyles(db);
const botClaude = createBotClaude(db, { settings });
const preferences = createPreferenceStore(db);
// The incoming-message service needs the chat service, which needs it back for its chief tools: a late-bound reference.
const inboundRef: { current?: ReturnType<typeof createInbound> } = {};
const skillsMarket = createMarket();
// The Grok Bot marketplace reader and the analyzer that writes an import's missing playbooks: shared by the import routes and Chief.
const grokSource = createGrokSource();
const botImportAnalyzer = createAnalyzerFor(db);
export const chatServices = {
  access: identity.access,
  avatars: avatarStore,
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
      // Lessons come from the daily pass over the chats, never from one message (modules/learning/batch.ts): a correction no longer
      // starts a skill review of its own.
      afterTurn: (t) => {
        void inboundRef.current?.deliverConversation(t.conversationId).catch(() => {});
        return chatSummaries.afterTurn(t);
      },
      learning,
      lessons: { tools: lessonTools, list: (owner, q) => lessons.list(owner, q) },
      mail: mailService,
      provisioning: mailProvisioning,
      phone,
      settings,
      settingsReader: settings,
      summaries: chatSummaries,
      install: installed.networkMode,
      discussions,
      loops,
      routines: features.routines,
      tasks,
      artifacts,
      playground: playgrounds,
      appAuthor,
      memory,
      skills: { skills: skillsLibrary, market: skillsMarket },
      botImport: { source: grokSource, analyzer: botImportAnalyzer },
      teams: teamStore,
      org,
      outputStyles,
      features,
      botClaude,
      machines,
      preferences,
      profile: profileStore,
      projects,
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
// A Google "Desktop app" sign-in ends on 127.0.0.1: when the browser is on this computer the plugin's loopback listener finishes it, as the
// person who started it, with a fresh plugin context (never one kept from the start of the sign-in).
configureGoogleLoopback({
  webOrigin: ENV.ZETTA_SERVER_URL,
  complete: async (userId, params) => {
    const actor = await issueBackgroundActor(membershipLookup, userId);
    if (!actor)
      throw new PluginError("OWNER_INACTIVE", "This account no longer has an active membership.");
    await mcp.plugins.callback(actor, "google", params);
  },
});
// Stopping a routine run is the chat's Stop on that run's conversation: the reply, its followed tasks and the rooms it opened.
features.routines.useStop(async (userId, conversationId) => {
  const actor = await issueBackgroundActor(membershipLookup, userId);
  if (actor) await chatServices.chat.cancelTurn(actor, conversationId);
});
// A workflow's `tool` step calls a plugin, an MCP server or an app with the grants of the bot it names, as the owner. What a tool may
// change is guarded by the approval step the workflow must have before it (checked when the workflow is saved).
const appText = (r: Awaited<ReturnType<typeof apps.call>>): string => {
  if (r.status === "ok") return typeof r.value === "string" ? r.value : JSON.stringify(r.value);
  if (r.status === "denied") throw new Error("denied");
  if (r.status === "failed") throw new Error(r.error.code);
  throw new Error("approval_required");
};
features.workflows.useTools({
  async call(userId, c) {
    const actor = await issueBackgroundActor(membershipLookup, userId);
    if (!actor) throw new Error("owner_inactive");
    if (c.kind === "plugin") return mcp.plugins.callTool(actor, c.botId, c.target, c.tool, c.args);
    if (c.kind === "zetta") {
      if (c.target !== "lessons") throw new Error("unknown_target");
      return lessonTools.call(userId, c.tool, c.args);
    }
    if (c.kind === "mcp") return mcp.callTool(actor, c.botId, c.target, c.tool, c.args);
    const r = await apps.call(actor, {
      app: c.target,
      tool: c.tool,
      input: c.args,
      source: "workflow",
      botId: c.botId,
    });
    // The workflow's approval step was the yes; the app's own question for the same call is answered with it.
    return appText(
      r.status === "approval_required" ? await apps.answer(actor, r.callId, "accept") : r,
    );
  },
  async effect(userId, c) {
    if (c.kind === "zetta") return c.target === "lessons" ? lessonTools.effect(c.tool) : "write";
    if (c.kind === "plugin")
      // Only "read" is a read: "write", "send" (mail in the person's name) and a tool with no effect all count as writes.
      return getPlugin(c.target)?.tools?.find((t) => t.name === c.tool)?.effect === "read"
        ? "read"
        : "write";
    if (c.kind === "app") {
      const actor = await issueBackgroundActor(membershipLookup, userId);
      const detail = actor ? await apps.get(actor, c.target).catch(() => undefined) : undefined;
      return detail?.manifest?.tools.find((t) => t.name === c.tool)?.kind === "query"
        ? "read"
        : "write";
    }
    return "write";
  },
});
// A routine's bot may need the owner's own accounts: only one that is not connected keeps the routine from running.
features.routines.useAccounts(async (userId, botId) => {
  const actor = await issueBackgroundActor(membershipLookup, userId);
  return actor ? connections.status(actor, botId).catch(() => undefined) : undefined;
});
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
        status: saved?.status,
      };
    } catch (e) {
      if (!(e instanceof TurnBusyError) || attempt >= 24) throw e;
      await Bun.sleep(5_000);
    }
  }
});
// The chief's memory review is a real chat turn too, in a conversation the lists leave out (see listConversations).
memoryJobs.useChat(async (userId, conversationId, prompt, requestKey, opts) => {
  const actor = await issueBackgroundActor(membershipLookup, userId);
  if (!actor) return { ok: false, text: "", slugs: [], error: "OWNER_INACTIVE" };
  for (let attempt = 0; ; attempt++) {
    try {
      // An ingest's source goes in as an attached file: the chat shows it as one, and the bot is told it is outside data.
      const attachmentIds: string[] = [];
      for (const a of opts?.attachments ?? [])
        attachmentIds.push(
          (
            await chatServices.chat.addAttachment(actor, {
              name: a.name,
              mimeType: "text/plain",
              text: a.text,
              conversationId,
            })
          ).id,
        );
      const { follow } = await chatServices.chat.startTurn(actor, conversationId, {
        content: prompt,
        clientRequestId: requestKey,
        ...(attachmentIds.length ? { attachmentIds } : {}),
        // A memory job's own writes apply at once; the memory enforces what each item allows (see Converse.memoryJob).
        ...(opts?.memoryJob ? { memoryJob: opts.memoryJob } : {}),
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
// Work cards (modules/work): a task that stopped, is blocked or went quiet reaches the right person with next steps to pick from.
const workActions = createWorkActions({ db, tasks, chat: chatServices.chat, discussions });
const workScan = createWorkScan({ db, ownerPaused: (userId) => agentsPaused(db, userId) });
tasks.onBlocked = (t) => void workActions.blocked(t.id).catch(() => {});
const taskHeartbeat = createTaskHeartbeat({
  db,
  tasks,
  stopped: (taskId, reason) => workActions.stopped(taskId, reason),
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
// A loop's status or step count changed (also with no message written): the banner of that chat refetches.
loops.onChange = (conversationId, ownerUserId) =>
  events.publish([ownerUserId], topics.conversation(conversationId));
if (runsWork) work.on("loop", (id) => id && loopDriver.kick(id));
// A person moved, or deleted, a task a bot asked for: tell the bot with a turn in its chat. Best effort, after the change is saved.
tasks.onPersonTask = (e) => void chatServices.chat.notifyTask(e).catch(() => {});
// Any task write, by a person or a bot, refreshes the board and the "working on" line of the bots on every open page of the owner.
tasks.onChange = (userIds) => events.publish(userIds, topics.tasks, topics.botStatus);
projects.onChange = (userIds) => events.publish(userIds, topics.projects);
org.onChange = (userIds) => events.publish(userIds, topics.org);
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
export const workServices = { scan: workScan };
const discussionWorker = createDiscussionWorker(
  db,
  discussions,
  chatServices.chat,
  membershipLookup,
  { settings },
);
discussions.onEnqueue = () => work.kick("discussions");
if (runsWork) work.on("discussions", () => discussionWorker.kick());
// A person's post in a room reaches the bots working there now. The route may be served by a process that runs no turns, so the
// poke travels as a work kick to the one that does.
discussions.onPersonPost = (userId, conversationId) =>
  work.kick("poke", `${userId}:${conversationId}`);
if (runsWork)
  work.on("poke", (key) => {
    const at = key?.indexOf(":") ?? -1;
    if (key && at > 0) chatServices.chat.poke(key.slice(0, at), key.slice(at + 1));
  });
export const discussionServices = {
  access: identity.access,
  store: discussions,
  worker: discussionWorker,
  chat: chatServices.chat,
};
export const botClaudeServices = { access: identity.access, db, claude: botClaude };
export const inboundServices = {
  access: identity.access,
  inbound: createInbound(db, mcp.plugins, chatServices.chat, membershipLookup, transcribe),
};
inboundRef.current = inboundServices.inbound;
withProvisioning(chatServices.chat, mailProvisioning);
/** An archived bot's number is held for 30 days (best effort, after the archive itself). */
withPhoneHold(chatServices.chat, phone);
/** Incoming phone calls (modules/phone/calls.ts): the provider's webhook and media socket. They run in the worker (worker-only.ts). */
export const phoneCalls = createPhoneCalls({
  db,
  phone,
  reader: phoneReader,
  replay: createReplayStore(db),
  chat: chatServices.chat,
  lookup: membershipLookup,
  transcriber,
  synthesizer,
  defaultLanguage: async () => (await installation.load()).transcribeLanguage || undefined,
  instance: instanceId,
});
export const phoneServices = { access: identity.access, phone, calls: phoneCalls };
/** Bots place calls from their own number (modules/phone/outbound.ts): the server decides each call, the person's card or request approves it. */
configurePhoneOut({
  facts: createOutboundFacts({ db, reader: phoneReader }),
  place: phoneCalls.place,
  // Signs the call a card shows: derived from the installation key and the person, so a card nobody here signed places nothing.
  sealKey: (userId) =>
    Buffer.from(
      hkdfSync(
        "sha256",
        Buffer.from(ENV.ZETTA_CONNECTION_KEY, "base64"),
        Buffer.alloc(0),
        `zetta.phone.call-approval.v1:${userId}`,
        32,
      ),
    ).toString("base64"),
  offered: async (userId, botId) => {
    if (!(await phoneReader.offer()).on) return false;
    const rows = await db
      .select({ id: phoneNumberTable.id })
      .from(phoneNumberTable)
      .where(
        and(
          eq(phoneNumberTable.botId, botId),
          eq(phoneNumberTable.ownerUserId, userId),
          eq(phoneNumberTable.status, "active"),
          eq(phoneNumberTable.outbound, "on"),
        ),
      );
    return rows.length > 0;
  },
  audit: (userId, e) =>
    void audit(db, userId, {
      kind: "voice_call",
      outcome: e.outcome,
      botId: e.botId,
      detail: e.detail,
    }),
});
/** The poller of bot addresses' mail; the ticker in index.ts runs it in the one process that does background work. */
export const mailPoller = createMailPoller({
  db,
  store: mailboxStore,
  messages: mailMessages,
  reader: mailReader,
  inbound: inboundServices.inbound,
});
export const featureServices = { access: identity.access, features };
export const decisionServices = { access: identity.access, decisions };
export const computerServices = { access: identity.access, computer, vms, machines };
export const integrationServices = { access: identity.access, mcp, sources };
// Only when the desktop app that runs this server started it with a link token (ZETTA_DESKTOP_LINK_TOKEN): see modules/desktop-link.
const desktopLinkToken = process.env.ZETTA_DESKTOP_LINK_TOKEN?.trim();
export const desktopLinkServices =
  desktopLinkToken && desktopLinkToken.length >= 32
    ? {
        token: desktopLinkToken,
        link: createDesktopLink({
          db,
          connections,
          mcp,
          admin: async () => {
            const [row] = await db
              .select({ id: installationIdentity.adminUserId })
              .from(installationIdentity)
              .where(eq(installationIdentity.id, 1));
            return row?.id ? issueBackgroundActor(membershipLookup, row.id) : null;
          },
        }),
      }
    : undefined;
export const taskServices = { access: identity.access, tasks, work: workActions };
export const projectServices = {
  access: identity.access,
  projects,
  work: createProjectWork({ db, tasks, chat: chatServices.chat }),
  draft: createProjectDraft(createOneShot(db)),
};
export const orgServices = { access: identity.access, org };
export const transcribeServices = { access: identity.access, transcribe };
export const speechServices = {
  access: identity.access,
  speech: synthesizer,
  /** The voice saved on a bot: its owner's, or a team bot's (anyone who may talk to it may hear it). */
  botVoice: async (userId: string, botId: string) => {
    const [b] = await db
      .select({
        voice: bot.voice,
        language: bot.voiceLanguage,
        owner: bot.ownerUserId,
        visibility: bot.visibility,
      })
      .from(bot)
      .where(eq(bot.id, botId));
    if (!b || (b.owner !== userId && b.visibility !== "team")) return undefined;
    return { voice: b.voice || undefined, language: b.language || undefined };
  },
};
/** Spoken conversations with a bot (modules/voice): the same chat service as a typed message, with speech in and out on the sides. */
export const voice = createVoiceService({
  db,
  chat: chatServices.chat,
  transcriber,
  synthesizer,
  ready: createVoiceReadiness({
    settings: () => installation.load(),
    transcribeKey: (id) => transcribeKey.state(id),
    speechKey: () => speechReader.keyState(),
  }),
  defaultLanguage: async () => (await installation.load()).transcribeLanguage || undefined,
  // The browser's own voice cannot be heard on a phone line: phone is offered only with a voice the server makes.
  phoneOn: async () =>
    (await phoneReader.offer()).on &&
    ["local", "remote"].includes(await synthesizer.mode().catch(() => "off")),
  instance: instanceId,
});
export const voiceServices = { access: identity.access, voice };
export const botQualityServices = {
  access: identity.access,
  quality: createBotQuality(db, { chat: chatServices.chat, learning }),
};
export const catchUpServices = {
  access: identity.access,
  catchUp: { db, listProposals: chatServices.chat.listProposals, work: workActions },
  actions: createCatchUpActions({
    db,
    work: workActions,
    tasks,
    loops,
    discussions,
    memory,
    chat: chatServices.chat,
    features,
    inbound: inboundServices.inbound,
  }),
};
export const preferenceServices = {
  access: identity.access,
  preferences,
};
export const profileServices = {
  access: identity.access,
  profile: profileStore,
  avatars: avatarStore,
  people: createPeopleDirectory(db),
  // The session lookup is memoized per request, so this adds no query.
  currentSessionId: async (headers: Headers) =>
    (await auth.api.getSession({ headers }))?.session.id,
};
export const avatarServices = { access: identity.access, avatars: avatarStore };
export const knowledgeServices = { access: identity.access, knowledge: companyKnowledge };
export const memoryServices = {
  access: identity.access,
  memory,
  jobs: memoryJobs,
  graph: createMemoryGraph(db),
  assist: createMemoryAssist(db, { memory }),
};
/** Which memory items and skills are worth keeping (modules/learning/usefulness.ts). */
export const learningServices = {
  access: identity.access,
  usefulness: createUsefulness(db, { memory, skills: skillsLibrary }),
};
/** What bots learned from their owners: the daily pass over the chats, and the trial that keeps or drops them (modules/learning). */
export const lessonBatch = createBatch(db, {
  lessons,
  cli: withTokenAudit(db, harnessCli.run, "batch"),
  settings,
});
export const lessonTrial = createTrial(db, { lessons });
export const lessonFindings = createFindings(db, { lessons, memory });
export const lessonTidy = createTidy(db, { lessons, findings: lessonFindings });
export const lessonForget = createForget(db, { lessons });
export const lessonServices = {
  access: identity.access,
  lessons,
  batch: lessonBatch,
  findings: lessonFindings,
  progress: lessonProgress,
  workflow: createLessonWorkflow(db, { save: (a, v) => features.workflows.save(a, v) }),
};
export const searchServices = { access: identity.access, search: createSearch(db) };
export const artifactServices = { access: identity.access, artifacts };
export const teamServices = { access: identity.access, store: teamStore };
export const outputStyleServices = { access: identity.access, styles: outputStyles };
export const skillServices = {
  access: identity.access,
  db,
  skills: skillsLibrary,
  review: skillReview,
  market: skillsMarket,
  claude: botClaude,
};
export const botImportServices = {
  access: identity.access,
  db,
  botImport: createBotImport({
    db,
    chat: chatServices.chat,
    skills: skillsLibrary,
    memory,
    routines: features.routines,
    source: grokSource,
    analyzer: botImportAnalyzer,
  }),
};
export const playgroundServices = {
  access: identity.access,
  playground: playgrounds,
  containers: playgroundContainers,
};
export const appsServices = { access: identity.access, apps };
export const deviceServices = {
  access: identity.access,
  devices,
  hub: deviceHub,
  auth,
  resource: mcpResource(authConfig),
  actorFor: (userId: string) => issueBackgroundActor(membershipLookup, userId),
};
export const zettaMcpServices = {
  auth,
  resource: mcpResource(authConfig),
  actorFor: (userId: string) => issueBackgroundActor(membershipLookup, userId),
  chat: chatServices.chat,
  mcp,
  connections,
  features,
  memory,
  tasks,
  outputStyles: outputStyleServices.styles,
  org,
  lessons: { tools: lessonTools },
  mailboxes: mailboxRows,
  mail: mailService,
  phone,
  audit: (ownerUserId: string, event: Parameters<typeof audit>[2]) => audit(db, ownerUserId, event),
};
export const agendaServices = {
  access: identity.access,
  agenda,
  scheduler: agendaScheduler,
};
