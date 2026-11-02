import { Link } from "@tanstack/react-router";
import { ArrowsClockwiseIcon } from "@phosphor-icons/react";
import { useEffect, useState } from "react";

import { Button, Checkbox, Select } from "@/components/ui";

import { errorMessage } from "../chat/chat-client";
import { pluginsApi } from "../plugins/plugins-api";
import { agendaApi, type AgendaSync } from "./agenda-api";
import { useTimeFormat } from "@/features/preferences/preferences";
import { formatTime } from "@/features/preferences/time-format";

type Google = "loading" | "missing" | "no-calendar" | "read-only" | "ok";
/** Google accounts that can create events, as the Google plugin reports them. */
type Writer = { email: string };

/** Google Calendar sync settings for the Agenda. Connecting Google itself stays in Studio > Plugins. */
export function AgendaSyncPanel({
  sync,
  onSync,
  onSynced,
  onError,
}: {
  sync: AgendaSync | undefined;
  onSync: (s: AgendaSync) => void;
  onSynced: () => void;
  onError: (m: string) => void;
}) {
  const tf = useTimeFormat();
  const [google, setGoogle] = useState<Google>("loading");
  const [busy, setBusy] = useState(false);
  const [writers, setWriters] = useState<Writer[]>([]);
  useEffect(() => {
    let alive = true;
    (async () => {
      const installed = await pluginsApi.installed().catch(() => []);
      if (!installed.some((p) => p.id === "google")) return "missing" as const;
      const t = await pluginsApi.test("google").catch(() => undefined);
      if (t?.status.state !== "connected") return "missing" as const;
      const scopes = (t.status.info?.scopes ?? []) as string[];
      const accounts = (t.status.info?.accounts ?? []) as {
        email: string;
        state: string;
        scopes: string[];
      }[];
      setWriters(
        accounts.filter((a) => a.state === "connected" && a.scopes.includes("calendar.events")),
      );
      return scopes.includes("calendar.events")
        ? ("ok" as const)
        : scopes.includes("calendar.events.readonly")
          ? ("read-only" as const)
          : ("no-calendar" as const);
    })().then((g) => {
      if (alive) setGoogle(g);
    });
    return () => {
      alive = false;
    };
  }, []);

  const set = async (v: Partial<Pick<AgendaSync, "enabled" | "pushByDefault" | "pushAccount">>) => {
    setBusy(true);
    try {
      onSync(await agendaApi.setSync(v));
      if (v.enabled) onSynced();
    } catch (e) {
      onError(errorMessage(e));
    } finally {
      setBusy(false);
    }
  };
  const now = async () => {
    setBusy(true);
    try {
      const r = await agendaApi.syncNow();
      onSync(r.sync);
      if (!r.result.ok && r.result.error) onError(r.result.error);
      onSynced();
    } catch (e) {
      onError(errorMessage(e));
    } finally {
      setBusy(false);
    }
  };

  if (google === "loading" || !sync)
    return <p className="text-xs text-muted-foreground">Checking Google Calendar…</p>;
  if (google === "missing" || google === "no-calendar")
    return (
      <p className="text-xs text-muted-foreground">
        {google === "missing" ? "Connect Google" : "Give Google Calendar access"} in{" "}
        <Link
          to="/studio/$tab"
          params={{ tab: "plugins" }}
          search={{ plugin: "google" } as never}
          className="underline"
        >
          Studio › Plugins
        </Link>{" "}
        to sync your Agenda with Google Calendar.
      </p>
    );
  return (
    <div className="flex flex-wrap items-center gap-x-4 gap-y-2 text-sm">
      <Checkbox
        checked={sync.enabled}
        disabled={busy}
        onChange={(e) => void set({ enabled: e.target.checked })}
      >
        Keep in sync with Google Calendar
      </Checkbox>
      {sync.enabled && google === "ok" && (
        <Checkbox
          checked={sync.pushByDefault}
          disabled={busy}
          onChange={(e) => void set({ pushByDefault: e.target.checked })}
        >
          Send new items to Google
        </Checkbox>
      )}
      {sync.enabled && google === "ok" && writers.length > 1 && (
        <Select
          title="New items go to"
          required={false}
          value={sync.pushAccount ?? ""}
          disabled={busy}
          onChange={(e) => void set({ pushAccount: e.target.value || null })}
          options={[
            { value: "", label: "First account that can write" },
            ...writers.map((w) => ({ value: w.email, label: w.email })),
          ]}
        />
      )}
      {sync.enabled && (
        <Button type="button" variant="ghost" size="sm" disabled={busy} onClick={() => void now()}>
          <ArrowsClockwiseIcon
            className={`size-4 ${busy ? "animate-spin" : ""}`}
            aria-hidden="true"
          />{" "}
          Sync now
        </Button>
      )}
      {sync.enabled && (
        <span className="text-xs text-muted-foreground" aria-live="polite">
          {google === "read-only" ? "Import only (Google was connected read-only). " : ""}
          {sync.lastError ? (
            <span className="text-destructive">{sync.lastError}</span>
          ) : sync.lastSyncedAt ? (
            `Synced ${formatTime(sync.lastSyncedAt, tf)}`
          ) : (
            "Not synced yet"
          )}
        </span>
      )}
    </div>
  );
}
