import { useEffect, useRef, useState } from "react";

/**
 * Copies text to the clipboard. `copied` is true for a moment after a success. A clipboard that is missing (a page that is not secure) or
 * that refuses calls `onFail`, so the person is told instead of seeing nothing.
 */
export function useCopy(onFail: () => void) {
  const [copied, setCopied] = useState(false);
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  useEffect(() => () => clearTimeout(timer.current), []);
  const copy = async (text: string) => {
    try {
      await navigator.clipboard.writeText(text);
      setCopied(true);
      clearTimeout(timer.current);
      timer.current = setTimeout(() => setCopied(false), 1500);
    } catch {
      setCopied(false);
      onFail();
    }
  };
  return { copied, copy };
}
