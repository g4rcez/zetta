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
import { toast } from "sonner";

import { ApiError, call } from "../chat/chat-client";
import { useTheme } from "@/components/theme-provider";
import { saveLocal } from "@/lib/local-storage";
import { applyTheme, type Theme } from "./theme";
import { DEFAULT_TIME_FORMAT, type TimeFormat } from "./time-format";

export type RailMode = "expanded" | "collapsed";
/** `botOrder`: the person's sidebar order of bots (ids, first on top); the chief is always first and never listed. */
export type Preferences = {
  railMode: RailMode;
  railWidth: number;
  listWidth: number;
  /** How hours show everywhere in the app. */
  timeFormat: TimeFormat;
  /** Null = never chosen on the account: the device keeps its own light/dark choice. */
  theme: Theme | null;
  /** `#rrggbb`. Null = the theme's own main color. */
  primaryColor: string | null;
  botOrder: string[];
};

/** Same limits as the server (packages/db/src/schema/preferences.ts), which rejects anything outside them. */
export const SIDEBAR_LIMITS = {
  railWidth: { min: 192, max: 360, fallback: 224 },
  listWidth: { min: 240, max: 560, fallback: 320 },
} as const;

const DEFAULTS: Preferences = {
  railMode: "expanded",
  railWidth: SIDEBAR_LIMITS.railWidth.fallback,
  listWidth: SIDEBAR_LIMITS.listWidth.fallback,
  timeFormat: DEFAULT_TIME_FORMAT,
  theme: null,
  primaryColor: null,
  botOrder: [],
};
// The server is the source of truth. This copy only stops the layout from jumping while the first request is in flight.
const CACHE_KEY = "zetta:preferences";
const SAVE_DELAY_MS = 400;

const readCache = (): Preferences => {
  try {
    const raw: unknown = JSON.parse(localStorage.getItem(CACHE_KEY) ?? "null");
    return raw && typeof raw === "object" ? { ...DEFAULTS, ...raw } : DEFAULTS;
  } catch {
    return DEFAULTS;
  }
};

type Value = { preferences: Preferences; set: (patch: Partial<Preferences>) => void };
const Ctx = createContext<Value | null>(null);

/** The signed-in person's layout preferences. A change shows at once and is saved to their account after a short pause. */
export function PreferencesProvider({ children }: { children: ReactNode }) {
  const qc = useQueryClient();
  const [preferences, setPreferences] = useState(readCache);
  const pending = useRef<Partial<Preferences>>({});
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
    saveLocal(CACHE_KEY, next);
  }, [saved]);

  const set = useCallback(
    (patch: Partial<Preferences>) => {
      setPreferences((current) => {
        const next = { ...current, ...patch };
        saveLocal(CACHE_KEY, next);
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

  // The theme is a preference, so it follows the person to any device. next-themes only applies the light/dark base.
  const { setTheme } = useTheme();
  useEffect(
    () =>
      applyTheme(document.documentElement, preferences.theme, preferences.primaryColor, setTheme),
    [preferences.theme, preferences.primaryColor, setTheme],
  );

  const value = useMemo(() => ({ preferences, set }), [preferences, set]);
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

/** The chosen hour format. Outside the provider (tests, public pages) it falls back to the default. */
export const useTimeFormat = (): TimeFormat =>
  useContext(Ctx)?.preferences.timeFormat ?? DEFAULT_TIME_FORMAT;

export function usePreferences(): Value {
  const value = useContext(Ctx);
  if (!value) throw new Error("usePreferences must be used inside PreferencesProvider");
  return value;
}
