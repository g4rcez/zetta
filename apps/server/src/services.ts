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
import { createEnrollmentService } from "./modules/identity/enrollment";
import { createIdentityAccess, createMembershipLookup } from "./modules/identity/access";
import { createFirstAccountSetup, createSetupState } from "./modules/identity/first-account";
import { createInvitationSignupPreflight } from "./modules/identity/signup-preflight";

export const db = createDb(ENV);
export const auth = createAuth(ENV, db, desktopOrigins, { invitationSignupVerifier: createInvitationSignupPreflight(db), firstAccount: createFirstAccountSetup(db) });
export const identity = { access: createIdentityAccess(auth, createMembershipLookup(db)), enrollment: createEnrollmentService(db), setupOpen: createSetupState(db) };

import { createFileStore } from "./modules/chat/files";

// Authorized server files live under ZETTA_FILES_ROOT (me/<userId>/… private, shared/… team-readable).
const files = createFileStore(process.env.ZETTA_FILES_ROOT ?? `${process.cwd()}/.zetta-files`);
const decisions = createDecisionService();
// Desktop control through Cua Spaces: enable with ZETTA_DESKTOP_RUNTIME=cua (needs the `cua` CLI; each user+profile gets its own local Linux container Space).
const cua = process.env.ZETTA_DESKTOP_RUNTIME === "cua" && Bun.which("cua") ? createCuaCall() : undefined;
const desktop = cua ? createDesktopService({ call: cua.call, close: cua.close }) : undefined;
// Persistent per-user VMs (docker/desktop image + cua-spacesd): enable with ZETTA_DESKTOP_RUNTIME=docker. Takes over desktop use from Cua Spaces.
const vmDocker = dockerVmConfig();
const num = (v: string | undefined) => (v && /^\d+$/.test(v) ? Number(v) : undefined);
const vms = vmDocker ? createVmService({ store: createDbVmStore(db), docker: vmDocker, tokenRoot: process.env.ZETTA_VM_TOKEN_ROOT ?? `${process.cwd()}/.zetta-vm`, maxPerUser: num(process.env.ZETTA_VM_MAX_PER_USER), maxRunningPerUser: num(process.env.ZETTA_VM_MAX_RUNNING_PER_USER), maxRunning: num(process.env.ZETTA_VM_MAX_RUNNING), allowPrivate: process.env.ZETTA_ALLOW_PRIVATE_NETWORK === "1" }) : undefined;
const computer = createComputerService({ docker: dockerBrowserConfig(), db, root: process.env.ZETTA_BROWSER_ROOT ?? `${process.cwd()}/.zetta-browser`, executablePath: process.env.ZETTA_CHROMIUM_PATH });

// Connections need ZETTA_CONNECTION_KEY (base64 of 32 random bytes: `openssl rand -base64 32`). Without it they stay disabled, never half-working.
let connectionStore: Awaited<ReturnType<typeof createConnectionStore>> | undefined;
if (process.env.ZETTA_CONNECTION_KEY) {
  try { connectionStore = await createConnectionStore(db, { configuration: { key: process.env.ZETTA_CONNECTION_KEY, keyId: process.env.ZETTA_CONNECTION_KEY_ID ?? "v1" }, allowedProviders: PROVIDERS, initializeEmpty: true }); }
  catch { console.warn("Connections disabled: ZETTA_CONNECTION_KEY does not match the stored key check."); }
}
const connections = createConnectionsService(db, connectionStore);
export const connectionServices = { access: identity.access, connections };
// Administrator opt-in: lets MCP servers and the WhatsApp (WAHA) plugin reach private/localhost addresses (e.g. a WAHA container). Off by default.
const mcp = createMcp(db, connections, { allowPrivate: process.env.ZETTA_ALLOW_PRIVATE_NETWORK === "1" });
const jev = createJevDecider((a) => connections.jevSecret(a));
const sources = createSources(db, computer, { connections: { list: (a) => connections.list(a) as never, secretFor: (a, id) => connections.secretFor(a, id) as never } });
const features = createFeaturesService(db, undefined, decisions, computer, sources as never);
export const chatServices = { access: identity.access, chat: createChatService(db, undefined, files, computer, decisions, connections, { routine: features.routines.create as never, workflow: features.workflows.save as never }, mcp, jev, desktop, vms), files };
export const featureServices = { access: identity.access, features };
export const decisionServices = { access: identity.access, decisions };
export const computerServices = { access: identity.access, computer, desktop, vms };
export const integrationServices = { access: identity.access, mcp, sources };
