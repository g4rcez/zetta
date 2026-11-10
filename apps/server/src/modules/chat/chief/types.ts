import type { Database } from "@zetta/db";
import type { bot } from "@zetta/db/schema/chat";

import type { ArtifactStore } from "../../artifacts/store";
import type { BotClaude } from "../../bot-claude/store";
import type { DiscussionStore } from "../../discussions/store";
import type { FeaturesService } from "../../features/service";
import type { Mcp } from "../../integrations/mcp";
import type { AgendaScheduler } from "../../agenda/scheduler";
import type { AgendaService } from "../../agenda/service";
import type { ConnectionsService } from "../../connections/service";
import type { InboundService } from "../../inbound/service";
import type { Sources } from "../../integrations/sources";
import type { Knowledge } from "../../knowledge/service";
import type { PreferenceStore } from "../../preferences/store";
import type { Skills } from "../../skills/service";
import type { VmService } from "../../computer/vm";
import type { ComputerService } from "../../computer/service";
import type { Memory } from "../../memory/service";
import type { createRouting } from "../routing";
import type { Routines } from "../../features/routines";
import type { ActiveActor } from "../../identity/access";
import type { OutputStyles } from "../../output-styles/service";
import type { TaskStore } from "../../tasks/store";
import type { TeamStore } from "../../teams/store";
import type { Analyzer } from "../../bots/import/analyze";
import type { GrokSource } from "../../bots/import/grok-source";
import type { BotInput } from "../service";
import type { FormCardBody } from "./forms";

/** One line of the card the user sees before approving: what changes, from what, to what. */
export type DiffLine = { field: string; from: unknown; to: unknown };

/** What a chief block turned into: text for the bot (a read), a change waiting for the user's approval, or a reason it cannot be done. */
export type Outcome =
  | { read: string }
  | {
      plan: {
        /** One line for the attention item and the receipt. */
        title: string;
        diff: DiffLine[];
        /** Resolved ids and values; `apply` reads it back when the user approves. Never user-typed secrets. */
        patch: Record<string, unknown>;
        /** The version of the thing the plan was made against; the proposal is stale when it moved. */
        baseVersion?: number;
      };
    }
  /** A form the person fills in (a secret, a sign-in): the server draws the card, the chief only gets `text`. Nothing is proposed. */
  | { card: FormCardBody; text: string }
  | { error: string };

/** The chat service methods the chief tools call (the same ones the routes call), kept narrow so this folder does not import the service. */
export type ChiefChat = {
  updateBot(
    actor: ActiveActor,
    id: string,
    expectedVersion: number,
    patch: Partial<BotInput>,
  ): Promise<unknown>;
  archiveBot(actor: ActiveActor, id: string): Promise<unknown>;
  createBot(
    actor: ActiveActor,
    input: BotInput,
  ): Promise<{ id: string; name: string; slug: string } | undefined>;
  moveBot(actor: ActiveActor, botId: string, folderId: string | null): Promise<unknown>;
  listConversations(
    actor: ActiveActor,
    botId?: string,
    kind?: "chat" | "discussion" | "inbound",
    archived?: boolean,
  ): Promise<{ id: string; title: string; botId: string; pinned: boolean; favorite: boolean }[]>;
  updateConversation(
    actor: ActiveActor,
    id: string,
    patch: { title?: string; pinned?: boolean; favorite?: boolean; archived?: boolean },
  ): Promise<unknown>;
  deleteConversation(actor: ActiveActor, id: string): Promise<unknown>;
  createConversation(actor: ActiveActor, botId: string): Promise<unknown>;
  listFolders(actor: ActiveActor): Promise<{ id: string; name: string; parentId: string | null }[]>;
  createFolder(actor: ActiveActor, name: string, parentId?: string): Promise<unknown>;
  renameFolder(actor: ActiveActor, id: string, name: string): Promise<unknown>;
  deleteFolder(actor: ActiveActor, id: string): Promise<unknown>;
};

export type ChiefDeps = {
  db: Database;
  chat: ChiefChat;
  routines?: Routines | undefined;
  teams?:
    | Pick<
        TeamStore,
        | "list"
        | "roles"
        | "save"
        | "archive"
        | "startRoom"
        | "createRole"
        | "updateRole"
        | "deleteRole"
        | "setRoomTeam"
      >
    | undefined;
  outputStyles?: OutputStyles | undefined;
  artifacts?: ArtifactStore | undefined;
  tasks?: TaskStore | undefined;
  mcp?: Mcp | undefined;
  skills?: Skills | undefined;
  features?:
    | Pick<
        FeaturesService,
        | "listHooks"
        | "addHook"
        | "updateHook"
        | "deleteHook"
        | "dryRunHooks"
        | "listAttention"
        | "attentionAction"
        | "workflows"
        | "snapshots"
      >
    | undefined;
  botClaude?: BotClaude | undefined;
  discussions?:
    | Pick<
        DiscussionStore,
        "setStatus" | "silence" | "stopGoals" | "setRequireApproval" | "setPeers"
      >
    | undefined;
  preferences?: Pick<PreferenceStore, "get" | "update"> | undefined;
  /** A getter, because the inbound service is built after the chat service it needs. */
  inbound?:
    | (() => Pick<InboundService, "listRoutes" | "setRoute" | "pollNow"> | undefined)
    | undefined;
  computer?: Pick<ComputerService, "profiles" | "reset" | "revokeProfile"> | undefined;
  routing?: Pick<ReturnType<typeof createRouting>, "get" | "set" | "preview"> | undefined;
  vms?: Pick<VmService, "list" | "start" | "stop" | "remove" | "keyboard"> | undefined;
  sources?: Pick<Sources, "list" | "add" | "remove" | "briefing"> | undefined;
  knowledge?: Pick<Knowledge, "status" | "enable" | "disable" | "syncUser"> | undefined;
  connections?: Pick<ConnectionsService, "configured" | "list" | "revoke"> | undefined;
  agenda?: Pick<AgendaService, "setSyncSettings"> | undefined;
  agendaScheduler?: Pick<AgendaScheduler, "syncUser"> | undefined;
  memory?:
    | Pick<Memory, "suggestions" | "decide" | "restore" | "setStatus" | "remember">
    | undefined;
  /** The Grok Bot marketplace reader and the analyzer that writes an imported bot's missing playbooks. */
  botImport?: { source: GrokSource; analyzer: Analyzer } | undefined;
};

export type ChiefCtx = {
  deps: ChiefDeps;
  actor: ActiveActor;
  who: typeof bot.$inferSelect;
};

/** What `apply` may report back: a line for the user when the change worked only in part. */
export type Applied = string | void;
export type ChiefPatch = { tool: string; [k: string]: unknown };

/** `apply` needs no asking bot: the plan already holds every resolved id. */
export type ApplyCtx = Pick<ChiefCtx, "deps" | "actor">;
