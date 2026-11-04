import { useCallback, useEffect, useRef, useState } from "react";

const PREFIX = "zetta:chat-draft:";
const DEBOUNCE_MS = 300;

/** Storage key for a composer: one draft per conversation, or per bot while no conversation exists yet. */
export const draftKey = (botId?: string, chatId?: string) =>
  chatId ? `c:${chatId}` : botId ? `b:${botId}` : undefined;

type Store = Pick<Storage, "getItem" | "setItem" | "removeItem">;
const store = (): Store | undefined => {
  try {
    return typeof localStorage === "undefined" ? undefined : localStorage;
  } catch {
    return undefined;
  }
};

export function readDraft(key: string | undefined, from: Store | undefined = store()): string {
  if (!key) return "";
  try {
    return from?.getItem(PREFIX + key) ?? "";
  } catch {
    return "";
  }
}
export function writeDraft(
  key: string | undefined,
  value: string,
  to: Store | undefined = store(),
): void {
  if (!key) return;
  try {
    if (value) to?.setItem(PREFIX + key, value);
    else to?.removeItem(PREFIX + key);
  } catch {
    /* storage unavailable or full: the draft just isn't persisted */
  }
}

/**
 * Composer text that survives reloads and chat/bot switches. Writes are debounced and flushed when the key changes or the page unmounts.
 * `adopt()` carries the current text over to the next key (a first message creates the conversation, which changes the key mid-send).
 */
export function useDraft(key: string | undefined) {
  const [value, setValue] = useState(() => readDraft(key));
  const keyRef = useRef(key),
    valueRef = useRef(value),
    dirty = useRef(false),
    timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined),
    adopting = useRef(false);

  const flush = useCallback(() => {
    clearTimeout(timer.current);
    if (dirty.current) {
      writeDraft(keyRef.current, valueRef.current);
      dirty.current = false;
    }
  }, []);

  useEffect(() => {
    if (key === keyRef.current) return;
    flush();
    const previous = keyRef.current;
    keyRef.current = key;
    if (adopting.current) {
      adopting.current = false;
      writeDraft(previous, "");
      writeDraft(key, valueRef.current);
      return;
    }
    const next = readDraft(key);
    valueRef.current = next;
    setValue(next);
  }, [key, flush]);
  useEffect(() => {
    const onHide = () => flush();
    window.addEventListener("pagehide", onHide);
    return () => {
      window.removeEventListener("pagehide", onHide);
      flush();
    };
  }, [flush]);

  const set = useCallback(
    (next: string) => {
      valueRef.current = next;
      dirty.current = true;
      setValue(next);
      clearTimeout(timer.current);
      timer.current = setTimeout(flush, DEBOUNCE_MS);
    },
    [flush],
  );
  const clear = useCallback(() => {
    clearTimeout(timer.current);
    dirty.current = false;
    valueRef.current = "";
    setValue("");
    writeDraft(keyRef.current, "");
  }, []);
  const adopt = useCallback(() => {
    adopting.current = true;
  }, []);
  return { value, set, clear, adopt } as const;
}
