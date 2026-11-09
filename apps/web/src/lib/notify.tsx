import { Notifications, useNotification } from "@g4rcez/components/notifications";
import { useLayoutEffect, type ReactNode } from "react";

/**
 * Toasts from the design system (`@g4rcez/components` Notifications). The library only gives a hook, so a small component under
 * `<NotificationsProvider>` keeps the hook's `notify` function here, and `toast` can be called from any callback, effect or module
 * (the same shape as the `sonner` function it replaces). Without a provider mounted (a test, the first paint) a call does nothing.
 */
type Notify = ReturnType<typeof useNotification>;
type Theme = "default" | "info" | "success" | "warn" | "danger";
type Options = {
  /** A toast with the same id updates instead of piling up (a load error that retries). */
  id?: string;
  /** Milliseconds before it closes. A toast with an `action` stays at least 10 seconds. */
  duration?: number;
  /** A short title above the message. */
  title?: ReactNode;
  action?: { label: string; onClick: () => void };
};

let current: Notify | undefined;

function show(theme: Theme) {
  return (message: ReactNode, options: Options = {}) => {
    const { id, duration, title, action } = options;
    return current?.(message, {
      theme,
      ...(id !== undefined && { id }),
      ...(duration !== undefined && { timeout: duration }),
      ...(title !== undefined && { title }),
      ...(action !== undefined && { action }),
    });
  };
}

export const toast = Object.assign(show("default"), {
  success: show("success"),
  error: show("danger"),
  warning: show("warn"),
  info: show("info"),
});

/** Hands the hook's `notify` function to `toast`. Render it once, inside `<Notifications>`. */
function NotifyBridge() {
  const notify = useNotification();
  useLayoutEffect(() => {
    current = notify;
    return () => {
      if (current === notify) current = undefined;
    };
  }, [notify]);
  return null;
}

/** The toast stack and the `toast` function: mount it once around the app. */
export function NotificationsProvider({ children }: { children: ReactNode }) {
  return (
    <Notifications>
      <NotifyBridge />
      {children}
    </Notifications>
  );
}
