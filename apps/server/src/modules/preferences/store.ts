import type { Database } from "@zetta/db";
import { eq } from "@zetta/db/query";
import {
  SIDEBAR_LIMITS,
  userPreference,
  type AgentsState,
  type ApprovalMode,
  type RailMode,
  type SidebarSide,
  type MemberOnboarding,
  type NavMode,
  type Theme,
  type TimeFormat,
  type TextSize,
} from "@zetta/db/schema/preferences";
import { DEFAULT_PUSH_MODE, type PushMode } from "@zetta/core/push";
import type { ActiveActor } from "../identity/access";

export type Preferences = {
  railMode: RailMode;
  sidebarSide: SidebarSide;
  navMode: NavMode;
  /** `pending` until the person finished the first-run setup of their own Chief and engine (new accounts only). */
  memberOnboarding: MemberOnboarding;
  railWidth: number;
  listWidth: number;
  timeFormat: TimeFormat;
  textSize: TextSize;
  approvalMode: ApprovalMode;
  /** What may wake this person's phone with a push (`@zetta/core/push`). */
  pushMode: PushMode;
  theme: Theme | null;
  primaryColor: string | null;
  botOrder: string[];
  /** The bots this person pinned to the chat sidebar, in the order pinned. Empty: the sidebar picks its few bots by itself. */
  sidebarBots: string[];
  roomOrder: string[];
  /** Read-only here: it changes only through `PUT /api/agents/state`, which also stops the running turns. */
  agentsState: AgentsState;
};
export type PreferencesPatch = Partial<Omit<Preferences, "agentsState">>;

export function createPreferenceStore(db: Database) {
  const pick = (r: typeof userPreference.$inferSelect): Preferences => ({
    railMode: r.railMode,
    sidebarSide: r.sidebarSide,
    navMode: r.navMode,
    memberOnboarding: r.memberOnboarding,
    railWidth: r.railWidth,
    listWidth: r.listWidth,
    timeFormat: r.timeFormat,
    textSize: r.textSize,
    approvalMode: r.approvalMode,
    pushMode: r.pushMode,
    theme: r.theme,
    primaryColor: r.primaryColor,
    botOrder: r.botOrder,
    sidebarBots: r.sidebarBots,
    roomOrder: r.roomOrder,
    agentsState: r.agentsState,
  });
  return {
    /** No row yet means a person who never changed anything: the column defaults. */
    async get(a: ActiveActor): Promise<Preferences> {
      const [row] = await db
        .select()
        .from(userPreference)
        .where(eq(userPreference.ownerUserId, a.userId));
      return row
        ? pick(row)
        : {
            railMode: "expanded",
            sidebarSide: "left",
            navMode: "simple",
            memberOnboarding: "pending",
            railWidth: SIDEBAR_LIMITS.railWidth.fallback,
            listWidth: SIDEBAR_LIMITS.listWidth.fallback,
            timeFormat: "24h",
            textSize: "medium",
            approvalMode: "hold",
            pushMode: DEFAULT_PUSH_MODE,
            theme: null,
            primaryColor: null,
            botOrder: [],
            sidebarBots: [],
            roomOrder: [],
            agentsState: "running",
          };
    },
    async update(a: ActiveActor, patch: PreferencesPatch): Promise<Preferences> {
      const [row] = await db
        .insert(userPreference)
        .values({ ownerUserId: a.userId, ...patch })
        .onConflictDoUpdate({
          target: userPreference.ownerUserId,
          set: { ...patch, updatedAt: new Date() },
        })
        .returning();
      return pick(row!);
    },
  };
}
export type PreferenceStore = ReturnType<typeof createPreferenceStore>;
