import { useCallback, useEffect, useState } from "react";
import { Button } from "@/components/ui";

import { call, errorMessage } from "../chat/chat-client";
import { Badge, ConfirmButton, Panel, when } from "../shared/ui";

type DocsStatus = {
  enabled: boolean;
  status: "idle" | "syncing" | "error" | "needs_auth";
  docs: number;
  pending: number;
  chunks: number;
  lastSyncedAt: string | null;
  lastError: string | null;
};

const STATE: Record<
  DocsStatus["status"],
  { label: string; tone: "success" | "info" | "danger" | "warning" }
> = {
  idle: { label: "Up to date", tone: "success" },
  syncing: { label: "Reading your files", tone: "info" },
  error: { label: "Could not sync", tone: "danger" },
  needs_auth: { label: "Needs Google sign-in", tone: "warning" },
};

/** Turns on the index of the user's Google Drive documents. Bots then answer from them and cite them; only this user's chats can read them. */
export function CompanyDocs({ onError }: { onError: (m: string) => void }) {
  const [s, setS] = useState<DocsStatus>();
  const [busy, setBusy] = useState(false);
  const load = useCallback(
    () => call<DocsStatus>("/api/knowledge").then(setS, (e) => onError(errorMessage(e))),
    [onError],
  );
  useEffect(() => {
    void load();
  }, [load]);
  // While files are being read, keep the counts moving.
  useEffect(() => {
    if (!s?.enabled || (s.status !== "syncing" && !s.pending)) return;
    const t = setInterval(() => void load(), 5000);
    return () => clearInterval(t);
  }, [s?.enabled, s?.status, s?.pending, load]);
  const act = async (path: string, method: "PUT" | "DELETE" | "POST") => {
    setBusy(true);
    try {
      setS(await call<DocsStatus>(path, method, method === "DELETE" ? undefined : {}));
    } catch (e) {
      onError(errorMessage(e));
    } finally {
      setBusy(false);
    }
  };
  return (
    <Panel
      title="Company documents"
      description="Index your Google Drive documents so bots can answer from them and cite the file. The index is private to you: it is built with your own Google account and only your chats read it."
    >
      {s && !s.enabled && (
        <Button disabled={busy} onClick={() => void act("/api/knowledge", "PUT")}>
          Index my Drive
        </Button>
      )}
      {s?.enabled && (
        <div className="space-y-3">
          <p className="flex flex-wrap items-center gap-2 text-sm">
            <Badge tone={STATE[s.status].tone}>{STATE[s.status].label}</Badge>
            <span>
              {s.docs} {s.docs === 1 ? "document" : "documents"} indexed
              {s.pending ? `, ${s.pending} waiting` : ""}
            </span>
            {s.lastSyncedAt && (
              <span className="text-muted-foreground">Last read {when(s.lastSyncedAt)}</span>
            )}
          </p>
          {s.lastError && (
            <p role="alert" className="text-sm text-destructive">
              {s.status === "needs_auth"
                ? "Google access is missing. Reconnect Google in Plugins with Drive read access."
                : "The last sync failed. It will try again shortly."}
            </p>
          )}
          <div className="flex flex-wrap gap-2">
            <Button
              size="sm"
              variant="outline"
              disabled={busy || s.status === "syncing"}
              onClick={() => void act("/api/knowledge/sync", "POST")}
            >
              Sync now
            </Button>
            <ConfirmButton
              label="Remove index"
              question="Delete the copy of your documents?"
              confirmLabel="Delete"
              variant="destructive"
              onConfirm={() => act("/api/knowledge", "DELETE")}
            />
          </div>
        </div>
      )}
    </Panel>
  );
}
