import { useEffect, useState, useSyncExternalStore } from "react";

import { saveLocal } from "./local-storage";

/**
 * Keep the screen awake (Screen Wake Lock API). A wake lock belongs to one browser, so the choice is per device and lives in
 * this browser's storage, not on the account. `all`: while the app is open. `chats`: only while a chat that asked for it is open.
 */
export type KeepAwake = "chats" | "all";
export const KEEP_AWAKE_VALUES: readonly KeepAwake[] = ["chats", "all"];
export const KEEP_AWAKE_LABEL: Record<KeepAwake, string> = {
  chats: "Only in chats where I turn it on (default)",
  all: "Whenever Zetta is open",
};
/** Per chat: `on` holds the screen awake while this chat is open. */
export type ChatKeepAwake = "off" | "on";

const MODE_KEY = "zetta:keep-awake";
const CHATS_KEY = "zetta:keep-awake-chats";
const CHANGE = "zetta:keep-awake-change";

const readMode = (): KeepAwake => {
  try {
    const raw = localStorage.getItem(MODE_KEY);
    return KEEP_AWAKE_VALUES.find((v) => v === raw) ?? "chats";
  } catch {
    return "chats";
  }
};

const readChats = (): string => {
  try {
    return localStorage.getItem(CHATS_KEY) ?? "[]";
  } catch {
    return "[]";
  }
};

const parseChats = (raw: string): string[] => {
  try {
    const list: unknown = JSON.parse(raw);
    return Array.isArray(list) ? list.filter((id): id is string => typeof id === "string") : [];
  } catch {
    return [];
  }
};

const subscribe = (notify: () => void) => {
  window.addEventListener(CHANGE, notify);
  window.addEventListener("storage", notify); // another tab of this browser
  return () => {
    window.removeEventListener(CHANGE, notify);
    window.removeEventListener("storage", notify);
  };
};

export const setKeepAwake = (mode: KeepAwake) => {
  saveLocal(MODE_KEY, mode);
  window.dispatchEvent(new window.Event(CHANGE));
};

export const setChatKeepAwake = (chatId: string, value: ChatKeepAwake) => {
  const rest = parseChats(readChats()).filter((id) => id !== chatId);
  saveLocal(CHATS_KEY, value === "on" ? [...rest, chatId] : rest);
  window.dispatchEvent(new window.Event(CHANGE));
};

/** The device-wide choice. */
export const useKeepAwake = (): KeepAwake =>
  useSyncExternalStore(subscribe, readMode, () => "chats");

/** This chat's own switch. */
export const useChatKeepAwake = (chatId: string | undefined): ChatKeepAwake => {
  const raw = useSyncExternalStore(subscribe, readChats, () => "[]");
  return chatId && parseChats(raw).includes(chatId) ? "on" : "off";
};

export const wakeLockSupported = () => typeof navigator !== "undefined" && "wakeLock" in navigator;

/** `held`: the screen stays on. `waiting`: wanted, but the page is hidden or the browser has not answered yet. `denied`: the browser said no (low battery, battery saver). */
export type WakeLockState = "idle" | "held" | "waiting" | "denied" | "unsupported";

/**
 * Holds a screen wake lock while `active`. The browser drops the lock whenever the tab is hidden, so it is asked for again when
 * the tab comes back. The lock is released when `active` turns off and when the component unmounts.
 */
export function useWakeLock(active: boolean): WakeLockState {
  const [state, setState] = useState<WakeLockState>("idle");
  useEffect(() => {
    if (!active) {
      setState("idle");
      return;
    }
    if (!wakeLockSupported()) {
      setState("unsupported");
      return;
    }
    let sentinel: WakeLockSentinel | null = null;
    let stopped = false;
    setState("waiting");
    const acquire = async () => {
      if (stopped || sentinel || document.visibilityState !== "visible") return;
      try {
        const lock = await navigator.wakeLock.request("screen");
        if (stopped) {
          // Turned off while the request was in flight (React runs effects twice in dev): give it straight back.
          void lock.release().catch(() => undefined);
          return;
        }
        sentinel = lock;
        setState("held");
        lock.addEventListener("release", () => {
          if (sentinel !== lock) return;
          sentinel = null;
          if (!stopped) setState("waiting");
        });
      } catch {
        if (!stopped) setState("denied");
      }
    };
    const onVisible = () => void acquire();
    document.addEventListener("visibilitychange", onVisible);
    void acquire();
    return () => {
      stopped = true;
      document.removeEventListener("visibilitychange", onVisible);
      const held = sentinel;
      sentinel = null;
      void held?.release().catch(() => undefined);
    };
  }, [active]);
  return state;
}

/** Mounted once in the app frame: holds the lock for the device-wide `all` choice. */
export function useDeviceWakeLock() {
  useWakeLock(useKeepAwake() === "all");
}
