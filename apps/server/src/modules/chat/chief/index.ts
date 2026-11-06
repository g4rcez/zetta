import { applyArtifacts, runArtifacts } from "./artifacts";
import { applyBot, runBot } from "./bot";
import { applyClaude, runClaude } from "./claude";
import { runAdmin } from "./admin";
import { applyBrowserProfile, applyDecision, runBrowserProfile, runDecision } from "./decision";
import { applyHook, runHook } from "./hook";
import { applyInboundRoute, runInboundRoute } from "./inbound-route";
import { applyConnection, runConnection, applyAgendaSync, runAgendaSync } from "./accounts";
import {
  applyAttention,
  applyConversation,
  applyPreferences,
  runAttention,
  runConversation,
  runPreferences,
} from "./personal";
import {
  applyCompanyDocs,
  applyComputer,
  applySnapshot,
  applySource,
  applyMemoryAdmin,
  applyWorkflow,
  runCompanyDocs,
  runComputer,
  runSnapshot,
  runSource,
  runMemoryAdmin,
  runWorkflow,
} from "./work";
import { applyMcpServer, runMcpServer } from "./mcp-server";
import { applyPlugins, runPlugins } from "./plugins";
import { applyRoom, runRoom } from "./room";
import { applySkillLibrary, runSkillLibrary } from "./skill-library";
import { applyRoutine, runRoutine } from "./routine";
import type { ChiefKind } from "./schemas";
import { applyStyle, runStyle } from "./style";
import { applyTask, runTaskRemove } from "./tasks";
import { applyTeam, runTeam } from "./team";
import type { Applied, ApplyCtx, ChiefCtx, ChiefDeps, ChiefPatch, Outcome } from "./types";
import { applyFolder, runFolder } from "./folder";

export { AUTO_APPLY, CHIEF_KINDS, CHIEF_PROPOSAL, isChiefCall, isChiefWrite } from "./kinds";
export { chiefSchemas, type ChiefKind } from "./schemas";
export { formBlock, FORMS, type FormCardBody, type FormName } from "./forms";
export type { ChiefDeps, ChiefPatch, Outcome } from "./types";

/**
 * The chief's management tools. `run` turns a block into a read result or a plan; the chat service stores a plan as a proposal.
 * `apply` runs when the user approves, through the same services the web app's routes call, so their checks and audit stay in force.
 */
export function createChief(deps: ChiefDeps) {
  return {
    async run(
      actor: ChiefCtx["actor"],
      who: ChiefCtx["who"],
      kind: ChiefKind | "task",
      args: unknown,
    ): Promise<Outcome> {
      const ctx: ChiefCtx = { deps, actor, who };
      switch (kind) {
        case "bot":
          return runBot(ctx, args as never);
        case "folder":
          return runFolder(ctx, args as never);
        case "routine":
          return runRoutine(ctx, args as never);
        case "team":
          return runTeam(ctx, args as never);
        case "output_style":
          return runStyle(ctx, args as never);
        case "artifacts":
          return runArtifacts(ctx, args as never);
        case "plugins":
          return runPlugins(ctx, args as never);
        case "mcp_server":
          return runMcpServer(ctx, args as never);
        case "skill_library":
          return runSkillLibrary(ctx, args as never);
        case "hook":
          return runHook(ctx, args as never);
        case "claude":
          return runClaude(ctx, args as never);
        case "room":
          return runRoom(ctx, args as never);
        case "preferences":
          return runPreferences(ctx, args as never);
        case "conversation":
          return runConversation(ctx, args as never);
        case "attention":
          return runAttention(ctx, args as never);
        case "workflow":
          return runWorkflow(ctx, args as never);
        case "computer":
          return runComputer(ctx, args as never);
        case "snapshot":
          return runSnapshot(ctx, args as never);
        case "source":
          return runSource(ctx, args as never);
        case "company_docs":
          return runCompanyDocs(ctx, args as never);
        case "connection":
          return runConnection(ctx, args as never);
        case "agenda_sync":
          return runAgendaSync(ctx, args as never);
        case "memory_admin":
          return runMemoryAdmin(ctx, args as never);
        case "admin":
          return runAdmin(ctx, args as never);
        case "inbound_route":
          return runInboundRoute(ctx, args as never);
        case "browser_profile":
          return runBrowserProfile(ctx, args as never);
        case "decision":
          return runDecision(ctx, args as never);
        case "task":
          return runTaskRemove(ctx, (args as { id: string }).id);
      }
    },
    async apply(actor: ApplyCtx["actor"], patch: ChiefPatch): Promise<Applied> {
      const ctx: ApplyCtx = { deps, actor };
      switch (patch.tool) {
        case "bot":
          return applyBot(ctx, patch);
        case "folder":
        case "workspace":
          return applyFolder(ctx, patch);
        case "routine":
          return applyRoutine(ctx, patch);
        case "team":
          return applyTeam(ctx, patch);
        case "output_style":
          return applyStyle(ctx, patch);
        case "artifacts":
          return applyArtifacts(ctx, patch);
        case "plugins":
          return applyPlugins(ctx, patch);
        case "mcp_server":
          return applyMcpServer(ctx, patch);
        case "skill_library":
          return applySkillLibrary(ctx, patch);
        case "hook":
          return applyHook(ctx, patch);
        case "claude":
          return applyClaude(ctx, patch);
        case "room":
          return applyRoom(ctx, patch);
        case "preferences":
          return applyPreferences(ctx, patch);
        case "conversation":
          return applyConversation(ctx, patch);
        case "attention":
          return applyAttention(ctx, patch);
        case "workflow":
          return applyWorkflow(ctx, patch);
        case "computer":
          return applyComputer(ctx, patch);
        case "snapshot":
          return applySnapshot(ctx, patch);
        case "source":
          return applySource(ctx, patch);
        case "company_docs":
          return applyCompanyDocs(ctx, patch);
        case "connection":
          return applyConnection(ctx, patch);
        case "agenda_sync":
          return applyAgendaSync(ctx, patch);
        case "memory_admin":
          return applyMemoryAdmin(ctx, patch);
        case "inbound_route":
          return applyInboundRoute(ctx, patch);
        case "browser_profile":
          return applyBrowserProfile(ctx, patch);
        case "decision":
          return applyDecision(ctx, patch);
        case "task":
          return applyTask(ctx, patch);
        default:
          throw new Error(`unknown chief tool ${patch.tool}`);
      }
    },
  };
}
export type Chief = ReturnType<typeof createChief>;
