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

import { call } from "../chat/chat-client";

export type RailMode = "expanded" | "collapsed";
export type Preferences = { railMode: RailMode; railWidth: number; listWidth: number };

/** Same limits as the server (packages/db/src/schema/preferences.ts), which rejects anything outside them. */
export const SIDEBAR_LIMITS = {
  railWidth: { min: 192, max: 360, fallback: 224 },
  listWidth: { min: 240, max: 560, fallback: 320 },
} as const;

const DEFAULTS: Preferences = {
  railMode: "expanded",
  railWidth: SIDEBAR_LIMITS.railWidth.fallback,
  listWidth: SIDEBAR_LIMITS.listWidth.fallback,
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
const writeCache = (value: Preferences) => {
  try {
    localStorage.setItem(CACHE_KEY, JSON.stringify(value));
  } catch {
    // Storage unavailable (private mode): the layout just loads from the server next time.
  }
};

type Value = { preferences: Preferences; set: (patch: Partial<Preferences>) => void };
const Ctx = createContext<Value | null>(null);

/** The signed-in person's layout preferences. A change shows at once and is saved to their account after a short pause. */
export function PreferencesProvider({ children }: { children: ReactNode }) {
  const [preferences, setPreferences] = useState(readCache);
  const pending = useRef<Partial<Preferences>>({});
  const timer = useRef<ReturnType<typeof setTimeout>>(undefined);

  useEffect(() => {
    void call<{ preferences: Preferences }>("/api/preferences")
      .then(({ preferences: saved }) => {
        // A change made before the answer arrived is newer than what the server holds.
        const next = { ...saved, ...pending.current };
        setPreferences(next);
        writeCache(next);
      })
      .catch(() => {}); // Signed out or offline: keep the cached layout.
  }, []);

  const set = useCallback((patch: Partial<Preferences>) => {
    setPreferences((current) => {
      const next = { ...current, ...patch };
      writeCache(next);
      return next;
    });
    pending.current = { ...pending.current, ...patch };
    clearTimeout(timer.current);
    timer.current = setTimeout(() => {
      const body = pending.current;
      pending.current = {};
      call("/api/preferences", "PATCH", body).catch(() =>
        toast.error("Could not save your layout. It will reset on your next visit."),
      );
    }, SAVE_DELAY_MS);
  }, []);

  const value = useMemo(() => ({ preferences, set }), [preferences, set]);
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function usePreferences(): Value {
  const value = useContext(Ctx);
  if (!value) throw new Error("usePreferences must be used inside PreferencesProvider");
  return value;
}
