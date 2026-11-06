import type { Database } from "@zetta/db";
import { eq } from "@zetta/db/query";
import {
  SIDEBAR_LIMITS,
  userPreference,
  type RailMode,
  type SidebarSide,
  type Theme,
  type TimeFormat,
} from "@zetta/db/schema/preferences";
import type { ActiveActor } from "../identity/access";

export type Preferences = {
  railMode: RailMode;
  sidebarSide: SidebarSide;
  railWidth: number;
  listWidth: number;
  timeFormat: TimeFormat;
  approvalMode: ApprovalMode;
  theme: Theme | null;
  primaryColor: string | null;
  botOrder: string[];
};
export type PreferencesPatch = Partial<Preferences>;

export function createPreferenceStore(db: Database) {
  const pick = (r: typeof userPreference.$inferSelect): Preferences => ({
    railMode: r.railMode,
    sidebarSide: r.sidebarSide,
    railWidth: r.railWidth,
    listWidth: r.listWidth,
    timeFormat: r.timeFormat,
    approvalMode: r.approvalMode,
    theme: r.theme,
    primaryColor: r.primaryColor,
    botOrder: r.botOrder,
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
            railWidth: SIDEBAR_LIMITS.railWidth.fallback,
            listWidth: SIDEBAR_LIMITS.listWidth.fallback,
            timeFormat: "24h",
            approvalMode: "hold",
            theme: null,
            primaryColor: null,
            botOrder: [],
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
