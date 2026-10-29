import { Link } from "@tanstack/react-router";
import { useState } from "react";
import { Button } from "@/components/ui";

import {
  enableNativeNotifications,
  nativeNotificationState,
  refreshAttention,
} from "../attention/summary";
import { call, errorMessage, type Bot } from "../chat/chat-client";
import { Badge, Empty, useList, when } from "../shared/ui";

type Status = "open" | "acknowledged" | "resolved" | "cancelled";
type Action = "read" | "acknowledge" | "resolve" | "cancel" | "reopen";
type Item = {
  id: string;
  title: string;
  detail: string;
  nextAction: string;
  resultLink: string | null;
  status: Status;
  occurrences: number;
  readAt: string | null;
  completed: string;
  remaining: string;
  botId: string | null;
  updatedAt?: string;
};

const COLUMNS: {
  status: Exclude<Status, "cancelled">;
  label: string;
  hint: string;
  dot: string;
}[] = [
  {
    status: "open",
    dot: "bg-destructive",
    label: "Needs you",
    hint: "Something is waiting for you. It stays here until you act on it.",
  },
  {
    status: "acknowledged",
    dot: "bg-amber-500",
    label: "Seen",
    hint: "You have seen it. It is still not fixed.",
  },
];
/** Only a safe, same-purpose link: web addresses or paths inside the app. */
const safeLink = (l: string) => /^(https?:\/\/|\/)/.test(l) && !l.startsWith("//");

function Card({
  item,
  botName,
  busy,
  onAction,
}: {
  item: Item;
  botName?: string | undefined;
  busy: boolean;
  onAction: (a: Action) => void;
}) {
  const unread = !item.readAt && item.status === "open";
  const btn = (label: string, action: Action, variant: "outline" | "default" = "outline") => (
    <Button size="sm" variant={variant} disabled={busy} onClick={() => onAction(action)}>
      {label}
    </Button>
  );
  return (
    <article
      className="min-w-0 space-y-1.5 rounded-lg border bg-card p-3 text-sm shadow-xs"
      aria-label={item.title}
    >
      <p className={unread ? "font-bold" : "font-medium"}>
        {unread && (
          <span
            className="mr-1 inline-block size-2 rounded-full bg-destructive align-middle"
            aria-hidden
          />
        )}
        {item.title}
        {unread && <span className="sr-only"> (unread)</span>}
      </p>
      {botName && <p className="text-xs text-muted-foreground">From {botName}</p>}
      {item.occurrences > 1 && <Badge tone="warning">Happened {item.occurrences} times</Badge>}
      {item.detail && (
        <p className="whitespace-pre-wrap break-words text-muted-foreground">
          {item.detail.slice(0, 300)}
        </p>
      )}
      {item.completed && (
        <p className="break-words">
          <span className="font-medium">Done so far:</span> {item.completed}
        </p>
      )}
      {item.remaining && (
        <p className="break-words">
          <span className="font-medium">Still to do:</span> {item.remaining}
        </p>
      )}
      {item.nextAction && <p className="break-words">Next: {item.nextAction}</p>}
      {item.resultLink &&
        safeLink(item.resultLink) &&
        (item.resultLink.startsWith("/") ? (
          <Link
            className="font-medium text-primary underline-offset-2 hover:underline"
            to={item.resultLink as never}
          >
            Open result
          </Link>
        ) : (
          <a
            className="font-medium text-primary underline-offset-2 hover:underline"
            href={item.resultLink}
            target="_blank"
            rel="noopener noreferrer"
          >
            Open result
          </a>
        ))}
      <div className="flex flex-wrap gap-1 pt-1">
        {item.status === "open" && (
          <>
            {btn("Resolve", "resolve", "default")}
            {btn("I've seen this", "acknowledge")}
          </>
        )}
        {item.status === "acknowledged" && (
          <>
            {btn("Resolve", "resolve", "default")}
            {btn("Reopen", "reopen")}
          </>
        )}
        {btn("Dismiss", "cancel")}
      </div>
    </article>
  );
}

export function Attention({ bots, onError }: { bots: Bot[]; onError: (m: string) => void }) {
  const [rows, reload] = useList<Item>("/api/attention", "items", onError);
  const [busy, setBusy] = useState<string>();
  const [permission, setPermission] = useState(nativeNotificationState);
  async function act(id: string, action: Action) {
    setBusy(id);
    try {
      await call(`/api/attention/${id}/action`, "POST", { action });
      await reload();
      void refreshAttention();
    } catch (e) {
      onError(errorMessage(e, "Could not update the card."));
    } finally {
      setBusy(undefined);
    }
  }
  const nameOf = (id: string | null) => (id ? bots.find((b) => b.id === id)?.name : undefined);
  return (
    <section aria-label="Notifications" className="space-y-4">
      <p className="text-sm text-muted-foreground">
        Things bots and routines want you to look at. Open the result, then resolve or dismiss it.
        Seeing something does not fix it.
      </p>
      {permission === "default" && (
        <Button
          size="sm"
          variant="outline"
          onClick={() => void enableNativeNotifications().then((r) => setPermission(r))}
        >
          Enable desktop notifications
        </Button>
      )}
      {permission === "denied" && (
        <p className="text-xs text-muted-foreground">
          Desktop notifications are blocked. Allow them in the browser site settings.
        </p>
      )}
      <div className="grid items-start gap-4 lg:grid-cols-2">
        {COLUMNS.map((c) => {
          const items = rows?.filter((i) => i.status === c.status) ?? [];
          return (
            <div
              key={c.status}
              className="min-w-0 space-y-2.5 rounded-xl bg-muted/40 p-3"
              role="group"
              aria-label={`${c.label} (${items.length})`}
            >
              <div>
                <h3 className="flex items-center gap-2 text-sm font-semibold">
                  <span aria-hidden className={`size-2 rounded-full ${c.dot}`} />
                  {c.label}
                  <span className="font-normal tabular-nums text-muted-foreground">
                    {items.length}
                  </span>
                </h3>
                <p className="mt-0.5 text-xs text-pretty text-muted-foreground">{c.hint}</p>
              </div>
              {items.map((i) => (
                <Card
                  key={i.id}
                  item={i}
                  botName={nameOf(i.botId)}
                  busy={busy === i.id}
                  onAction={(a) => void act(i.id, a)}
                />
              ))}
              {rows && items.length === 0 && <Empty>Nothing here.</Empty>}
            </div>
          );
        })}
      </div>
      {rows?.some((i) => i.updatedAt) && (
        <p className="text-xs text-muted-foreground">
          Last change{" "}
          {when(rows.reduce((a, i) => ((i.updatedAt ?? "") > a ? (i.updatedAt ?? a) : a), ""))}
        </p>
      )}
    </section>
  );
}
