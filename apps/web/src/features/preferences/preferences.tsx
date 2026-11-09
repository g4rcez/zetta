import { useQuery, useQueryClient } from "@tanstack/react-query";
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { toast } from "@/lib/notify";

import { ApiError, call } from "../chat/chat-client";
import { useTheme } from "@/components/theme-provider";
import { saveLocal } from "@/lib/local-storage";
import { applyTheme, type Theme } from "./theme";
import { DEFAULT_TIME_FORMAT, type TimeFormat } from "./time-format";

export type RailMode = "expanded" | "collapsed";
/** The edge of the window the app sidebar sits on. */
export type SidebarSide = "left" | "right";
export const DEFAULT_SIDEBAR_SIDE: SidebarSide = "left";
/** Same values as the server (packages/db/src/schema/preferences.ts), which rejects anything else. */
export const SIDEBAR_SIDES: readonly SidebarSide[] = ["left", "right"];
export const SIDEBAR_SIDE_LABEL: Record<SidebarSide, string> = {
  left: "Left (default)",
  right: "Right",
};
/** `hold`: an approval that widens what a bot may do needs a press and hold. `click`: one click is enough. */
export type ApprovalMode = "hold" | "click";
export const DEFAULT_APPROVAL_MODE: ApprovalMode = "hold";
/** "Pause everything": while `paused`, none of this person's agents starts work. Same values as the server. */
export type AgentsState = "running" | "paused";
/** `botOrder`: the person's sidebar order of bots (ids, first on top); the chief is always first and never listed. */
export type Preferences = {
  railMode: RailMode;
  sidebarSide: SidebarSide;
  railWidth: number;
  listWidth: number;
  /** How hours show everywhere in the app. */
  timeFormat: TimeFormat;
  approvalMode: ApprovalMode;
  /** Null = never chosen on the account: the device keeps its own light/dark choice. */
  theme: Theme | null;
  /** `#rrggbb`. Null = the theme's own main color. */
  primaryColor: string | null;
  botOrder: string[];
  /** Read-only here: it changes only through `setAgentsState`, which also stops the turns running now. */
  agentsState: AgentsState;
};
/** What `set` may change. The agents state has its own route; the server refuses it in a patch. */
export type PreferencesPatch = Partial<Omit<Preferences, "agentsState">>;

/** Same limits as the server (packages/db/src/schema/preferences.ts), which rejects anything outside them. */
export const SIDEBAR_LIMITS = {
  railWidth: { min: 192, max: 360, fallback: 224 },
  listWidth: { min: 240, max: 560, fallback: 320 },
} as const;

const DEFAULTS: Preferences = {
  railMode: "expanded",
  sidebarSide: DEFAULT_SIDEBAR_SIDE,
  railWidth: SIDEBAR_LIMITS.railWidth.fallback,
  listWidth: SIDEBAR_LIMITS.listWidth.fallback,
  timeFormat: DEFAULT_TIME_FORMAT,
  approvalMode: DEFAULT_APPROVAL_MODE,
  theme: null,
  primaryColor: null,
  botOrder: [],
  agentsState: "running",
};
// The server is the source of truth. This copy only stops the layout from jumping while the first request is in flight.
const CACHE_KEY = "zetta:preferences";
const SAVE_DELAY_MS = 400;

/** The layout cache never keeps the agents state: a stale "paused" would show for a moment on the next visit. */
const cacheable = (p: Preferences) => ({ ...p, agentsState: undefined });

const readCache = (): Preferences => {
  try {
    const raw: unknown = JSON.parse(localStorage.getItem(CACHE_KEY) ?? "null");
    return raw && typeof raw === "object"
      ? { ...DEFAULTS, ...raw, agentsState: "running" }
      : DEFAULTS;
  } catch {
    return DEFAULTS;
  }
};

type Value = {
  preferences: Preferences;
  set: (patch: PreferencesPatch) => void;
  /** Pauses or resumes every agent. Resolves with how many running turns the pause stopped. */
  setAgentsState: (state: AgentsState) => Promise<{ stopped: number }>;
};
const Ctx = createContext<Value | null>(null);

/** The signed-in person's layout preferences. A change shows at once and is saved to their account after a short pause. */
export function PreferencesProvider({ children }: { children: ReactNode }) {
  const qc = useQueryClient();
  const [preferences, setPreferences] = useState(readCache);
  const pending = useRef<PreferencesPatch>({});
  const timer = useRef<ReturnType<typeof setTimeout>>(undefined);

  // Read once per visit: the cache entry is kept in step with every change below, so a remount does not ask again.
  // Signed out or offline: the query fails and the cached layout stays.
  const { data: saved } = useQuery({
    queryKey: ["preferences"],
    queryFn: () =>
      call<{ preferences: Preferences }>("/api/preferences").then((r) => r.preferences),
    staleTime: Infinity,
    retry: false,
  });
  useEffect(() => {
    if (!saved) return;
    // A change made before the answer arrived is newer than what the server holds.
    const next = { ...saved, ...pending.current };
    setPreferences(next);
    saveLocal(CACHE_KEY, cacheable(next));
  }, [saved]);

  const set = useCallback(
    (patch: PreferencesPatch) => {
      setPreferences((current) => {
        const next = { ...current, ...patch };
        saveLocal(CACHE_KEY, cacheable(next));
        qc.setQueryData(["preferences"], next);
        return next;
      });
      pending.current = { ...pending.current, ...patch };
      clearTimeout(timer.current);
      timer.current = setTimeout(() => {
        const body = pending.current;
        pending.current = {};
        call("/api/preferences", "PATCH", body).catch((e) => {
          // Signed out (the public pages): the choice stays on this device through the cache, so there is nothing to report.
          if (e instanceof ApiError && e.status === 401) return;
          toast.error("Could not save your preferences. They will reset on your next visit.");
        });
      }, SAVE_DELAY_MS);
    },
    [qc],
  );

  const setAgentsState = useCallback(
    async (state: AgentsState) => {
      const done = await call<{ agentsState: AgentsState; stopped: number }>(
        "/api/agents/state",
        "PUT",
        { state },
      );
      setPreferences((current) => {
        const next = { ...current, agentsState: done.agentsState };
        qc.setQueryData(["preferences"], next);
        return next;
      });
      return { stopped: done.stopped };
    },
    [qc],
  );

  // The theme is a preference, so it follows the person to any device. next-themes only applies the light/dark base.
  const { setTheme } = useTheme();
  useEffect(
    () =>
      applyTheme(document.documentElement, preferences.theme, preferences.primaryColor, setTheme),
    [preferences.theme, preferences.primaryColor, setTheme],
  );

  const value = useMemo(
    () => ({ preferences, set, setAgentsState }),
    [preferences, set, setAgentsState],
  );
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

/** The chosen hour format. Outside the provider (tests, public pages) it falls back to the default. */
export const useTimeFormat = (): TimeFormat =>
  useContext(Ctx)?.preferences.timeFormat ?? DEFAULT_TIME_FORMAT;

/** The edge the sidebar sits on. Outside the provider (tests, public pages) it is the default: left. */
export const useSidebarSide = (): SidebarSide =>
  useContext(Ctx)?.preferences.sidebarSide ?? DEFAULT_SIDEBAR_SIDE;

/** How this person confirms the approvals that ask for a hold. Outside the provider (tests, public pages) it is the default: hold. */
export const useApprovalMode = (): ApprovalMode =>
  useContext(Ctx)?.preferences.approvalMode ?? DEFAULT_APPROVAL_MODE;

/** Whether this person's agents are paused. Outside the provider (tests, public pages) they are running. */
export const useAgentsState = (): AgentsState =>
  useContext(Ctx)?.preferences.agentsState ?? "running";

export function usePreferences(): Value {
  const value = useContext(Ctx);
  if (!value) throw new Error("usePreferences must be used inside PreferencesProvider");
  return value;
}
