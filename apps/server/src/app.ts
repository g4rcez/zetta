import { cors } from "@elysiajs/cors";
import { Elysia } from "elysia";
import { createAuthMiddleware, type BetterAuthInstance } from "evlog/better-auth";
import { evlog, type EvlogElysiaOptions } from "evlog/elysia";

import { stampClientIp } from "./client-ip";
import { responseEncoding } from "./response-encoding";
import { healthRoutes } from "./health";
import { metaRoutes } from "./modules/meta/routes";
import type { Role } from "./role";
import { workerOnlyGuard } from "./worker-only";
import { createChatRoutes, type ChatServices } from "./modules/chat/routes";
import { createEventRoutes, type EventServices } from "./modules/events/routes";
import { createComputerRoutes, type ComputerServices } from "./modules/computer/routes";
import { createInstallationRoutes, type InstallationServices } from "./modules/installation/routes";
import { createConnectionRoutes, type ConnectionServices } from "./modules/connections/routes";
import { createIntegrationRoutes, type IntegrationServices } from "./modules/integrations/routes";
import { createDecisionRoutes, type DecisionServices } from "./modules/decisions/routes";
import { createFeatureRoutes, type FeatureServices } from "./modules/features/routes";
import { createAgendaRoutes, type AgendaServices } from "./modules/agenda/routes";
import { createKnowledgeRoutes, type KnowledgeServices } from "./modules/knowledge/routes";
import { createMemoryRoutes, type MemoryServices } from "./modules/memory/routes";
import { createOutputStyleRoutes, type OutputStyleServices } from "./modules/output-styles/routes";
import { createSkillRoutes, type SkillServices } from "./modules/skills/routes";
import { createBotImportRoutes, type BotImportServices } from "./modules/bot-import/routes";
import { createPlaygroundRoutes, type PlaygroundServices } from "./modules/playground/routes";
import { createAppsRoutes, type AppsServices } from "./modules/apps/routes";
import { createSearchRoutes, type SearchServices } from "./modules/search/routes";
import { createPreferenceRoutes, type PreferenceServices } from "./modules/preferences/routes";
import { createProfileRoutes, type ProfileServices } from "./modules/profile/routes";
import { createTaskRoutes, type TaskServices } from "./modules/tasks/routes";
import { createArtifactRoutes, type ArtifactServices } from "./modules/artifacts/routes";
import { createDiscussionRoutes, type DiscussionServices } from "./modules/discussions/routes";
import { createTeamRoutes, type TeamServices } from "./modules/teams/routes";
import { createInboundRoutes, type InboundServices } from "./modules/inbound/routes";
import { createIdentityRoutes, type IdentityServices } from "./modules/identity/routes";
import { createBotClaudeRoutes, type BotClaudeServices } from "./modules/bot-claude/routes";
import { createZettaMcpRoutes, type ZettaMcpRouteServices } from "./modules/zetta-mcp/routes";

export interface AppAuth extends BetterAuthInstance {
  handler: (request: Request) => Response | Promise<Response>;
}

export type CreateAppOptions = {
  auth: AppAuth;
  identity?: IdentityServices;
  installation?: InstallationServices;
  chat?: ChatServices;
  events?: EventServices;
  features?: FeatureServices;
  decisions?: DecisionServices;
  computer?: ComputerServices;
  connections?: ConnectionServices;
  integrations?: IntegrationServices;
  agenda?: AgendaServices;
  tasks?: TaskServices;
  preferences?: PreferenceServices;
  profile?: ProfileServices;
  search?: SearchServices;
  knowledge?: KnowledgeServices;
  memory?: MemoryServices;
  outputStyles?: OutputStyleServices;
  skills?: SkillServices;
  botImport?: BotImportServices;
  playground?: PlaygroundServices;
  apps?: AppsServices;
  artifacts?: ArtifactServices;
  discussions?: DiscussionServices;
  teams?: TeamServices;
  inbound?: InboundServices;
  botClaude?: BotClaudeServices;
  zettaMcp?: ZettaMcpRouteServices;
  webOrigin: string;
  /** Where this server's API answers, for `GET /api/meta`. Defaults to `webOrigin`. */
  apiOrigin?: string;
  desktopOrigins: readonly string[];
  /** Optional; without it evlog writes plain console logs. */
  drain?: EvlogElysiaOptions["drain"];
  /** `api` refuses the requests only the worker can serve (see worker-only.ts). Default `all`: one process does everything. */
  role?: Role;
  /** Readiness for a load balancer: true when this instance can serve (the database answers). `GET /readyz` is 503 otherwise. */
  ready?: () => Promise<boolean>;
};

export function createApp({
  auth,
  identity,
  installation,
  chat,
  events,
  features,
  decisions,
  computer,
  connections,
  integrations,
  agenda,
  tasks,
  preferences,
  profile,
  search,
  knowledge,
  memory,
  outputStyles,
  skills,
  botImport,
  playground,
  apps,
  artifacts,
  discussions,
  teams,
  inbound,
  botClaude,
  zettaMcp,
  webOrigin,
  apiOrigin = webOrigin,
  desktopOrigins,
  drain,
  role = "all",
  ready,
}: CreateAppOptions) {
  // Telemetry must never receive private auth/driver exceptions. Authorization
  // uses the original auth service independently and still fails closed.
  const identifyUser = createAuthMiddleware(
    {
      api: {
        async getSession(input) {
          try {
            return await auth.api.getSession(input);
          } catch {
            return null;
          }
        },
      },
    },
    {
      exclude: ["/api/auth/**", "/healthz", "/readyz"],
      maskEmail: true,
    },
  );

  // systemRouter: false keeps routing in Elysia's own fetch handler. With Bun's native route table (`Bun.serve({ routes })`), Bun
  // 1.3.14 segfaults in routeListGetCached while serving a request under `bun --hot` (crash report decoded 2026-10-26), taking
  // the API and every live VNC session down with it.
  return (
    new Elysia({ systemRouter: false })
      .mapResponse({ as: "global" }, ({ response, set }) => {
        if (response instanceof Response) set.status = response.status;
      })
      .use(evlog({ ...(drain ? { drain } : {}), exclude: ["/healthz", "/readyz"] }))
      .derive(async ({ request, log }) => {
        await identifyUser(log, request.headers, new URL(request.url).pathname);
        return {};
      })
      .use(
        cors({
          origin: [webOrigin, ...desktopOrigins],
          methods: ["GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"],
          allowedHeaders: ["Content-Type", "Authorization"],
          credentials: true,
        }),
      )
      .use(responseEncoding())
      // Typed as a plain Elysia: one more fully typed `.use` makes this chain too complex for the compiler.
      .use(role === "api" ? (workerOnlyGuard() as unknown as Elysia) : new Elysia())
      .use(healthRoutes(ready) as unknown as Elysia)
      .use(metaRoutes(webOrigin, apiOrigin) as unknown as Elysia)
      .all("/api/auth/*", async (context) => {
        const { request, status, server } = context;
        if (["POST", "GET"].includes(request.method)) {
          stampClientIp(request, server?.requestIP(request)?.address);
          return auth.handler(request);
        }
        return status(405);
      })
      .use(zettaMcp ? createZettaMcpRoutes(zettaMcp, auth.handler) : new Elysia())
      .use(identity ? createIdentityRoutes(identity, [webOrigin, ...desktopOrigins]) : new Elysia())
      .use(
        installation
          ? createInstallationRoutes(installation, [webOrigin, ...desktopOrigins])
          : new Elysia(),
      )
      .use(chat ? createChatRoutes(chat, [webOrigin, ...desktopOrigins]) : new Elysia())
      // Typed as a plain Elysia: one more fully typed `.use` makes this chain too complex for the compiler.
      .use(
        events
          ? (createEventRoutes(events, [webOrigin, ...desktopOrigins]) as unknown as Elysia)
          : new Elysia(),
      )
      .use(features ? createFeatureRoutes(features, [webOrigin, ...desktopOrigins]) : new Elysia())
      .use(
        decisions ? createDecisionRoutes(decisions, [webOrigin, ...desktopOrigins]) : new Elysia(),
      )
      .use(computer ? createComputerRoutes(computer, [webOrigin, ...desktopOrigins]) : new Elysia())
      .use(
        connections
          ? createConnectionRoutes(connections, [webOrigin, ...desktopOrigins])
          : new Elysia(),
      )
      .use(
        integrations
          ? createIntegrationRoutes(integrations, [webOrigin, ...desktopOrigins])
          : new Elysia(),
      )
      .use(agenda ? createAgendaRoutes(agenda, [webOrigin, ...desktopOrigins]) : new Elysia())
      .use(tasks ? createTaskRoutes(tasks, [webOrigin, ...desktopOrigins]) : new Elysia())
      .use(
        preferences
          ? createPreferenceRoutes(preferences, [webOrigin, ...desktopOrigins])
          : new Elysia(),
      )
      .use(profile ? createProfileRoutes(profile, [webOrigin, ...desktopOrigins]) : new Elysia())
      .use(search ? createSearchRoutes(search) : new Elysia())
      .use(
        knowledge ? createKnowledgeRoutes(knowledge, [webOrigin, ...desktopOrigins]) : new Elysia(),
      )
      .use(memory ? createMemoryRoutes(memory, [webOrigin, ...desktopOrigins]) : new Elysia())
      .use(
        outputStyles
          ? createOutputStyleRoutes(outputStyles, [webOrigin, ...desktopOrigins])
          : new Elysia(),
      )
      .use(skills ? createSkillRoutes(skills, [webOrigin, ...desktopOrigins]) : new Elysia())
      .use(
        botImport ? createBotImportRoutes(botImport, [webOrigin, ...desktopOrigins]) : new Elysia(),
      )
      .use(
        playground
          ? createPlaygroundRoutes(playground, [webOrigin, ...desktopOrigins])
          : new Elysia(),
      )
      .use(apps ? createAppsRoutes(apps, [webOrigin, ...desktopOrigins]) : new Elysia())
      .use(
        artifacts ? createArtifactRoutes(artifacts, [webOrigin, ...desktopOrigins]) : new Elysia(),
      )
      .use(
        discussions
          ? createDiscussionRoutes(discussions, [webOrigin, ...desktopOrigins])
          : new Elysia(),
      )
      .use(teams ? createTeamRoutes(teams, [webOrigin, ...desktopOrigins]) : new Elysia())
      .use(inbound ? createInboundRoutes(inbound, [webOrigin, ...desktopOrigins]) : new Elysia())
      .use(
        botClaude ? createBotClaudeRoutes(botClaude, [webOrigin, ...desktopOrigins]) : new Elysia(),
      )
      .get("/", () => "OK")
  );
}
