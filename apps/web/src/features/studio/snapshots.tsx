import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useState } from "react";

import { authClient } from "@/lib/auth-client";
import { ApiError, call, errorMessage } from "../chat/chat-client";
import { Markdown } from "../chat/markdown";
import { ConfirmButton, Empty, list, useList } from "../shared/ui";
import { Alert } from "@g4rcez/components/alert";
import { useTimeFormat } from "@/features/preferences/preferences";
import { formatDateTime } from "@/features/preferences/time-format";

type Snap = { id: string; title: string; botName: string; createdAt: string; ownerUserId?: string };
type Part = {
  seq: number;
  role: string;
  author?: string;
  content: string;
  thread?: number;
  attachments?: string[];
  reactions?: Record<string, number>;
};
type Full = {
  title: string;
  botName: string;
  content: Part[];
  ownerUserId?: string;
  createdAt: string;
  revokedAt: string | null;
};

export function Snapshots({ onError }: { onError: (m: string) => void }) {
  const tf = useTimeFormat();
  const qc = useQueryClient();
  const [rows] = useList<Snap>("/api/snapshots", "snapshots", onError);
  const [openId, setOpenId] = useState<string>();
  const { data: session } = authClient.useSession();
  const me = session?.user.id;
  const detail = useQuery({
    queryKey: ["snapshots", openId],
    queryFn: () => call<{ snapshot: Full }>(`/api/snapshots/${openId}`).then((r) => r.snapshot),
    enabled: !!openId,
  });
  const gone = detail.error instanceof ApiError && detail.error.status === 404;
  const failed = detail.isError && !gone;
  useEffect(() => {
    if (!failed) return;
    setOpenId(undefined);
    onError(errorMessage(detail.error, "Could not open it."));
    // Only a new failure matters.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [detail.error]);
  const open = openId ? { id: openId, snap: detail.data, gone } : undefined;
  async function revoke(id: string) {
    try {
      await call(`/api/snapshots/${id}`, "DELETE");
      await Promise.all([
        qc.invalidateQueries({ queryKey: ["snapshots", id] }),
        qc.invalidateQueries({ queryKey: ["list", "/api/snapshots"] }),
      ]);
    } catch (e) {
      onError(errorMessage(e));
    }
  }
  const s = open?.snap;
  return (
    <section aria-label="Team snapshots" className="space-y-3">
      {rows?.length === 0 && (
        <Empty>No one has published a conversation yet. Publish one from Chat.</Empty>
      )}
      <ul className={list}>
        {rows?.map((r) => (
          <li key={r.id}>
            <button
              className={`flex w-full min-w-0 items-baseline justify-between gap-3 px-4 py-3 text-left text-sm transition-colors hover:bg-muted/60 focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-ring ${open?.id === r.id ? "bg-accent" : ""}`}
              aria-current={open?.id === r.id}
              onClick={() => setOpenId(r.id)}
            >
              <span className="min-w-0 break-words">
                <span className="font-medium">{r.title}</span>
                <span className="text-muted-foreground"> · {r.botName}</span>
              </span>
              <time
                dateTime={r.createdAt}
                className="shrink-0 text-xs tabular-nums text-muted-foreground"
              >
                {new Date(r.createdAt).toLocaleDateString()}
              </time>
            </button>
          </li>
        ))}
      </ul>
      {open?.gone && (
        <Alert theme="warn">
          This snapshot is no longer available. It may have been taken down by its owner.
        </Alert>
      )}
      {open && !open.snap && !open.gone && (
        <p role="status" className="text-sm">
          Loading…
        </p>
      )}
      {s && (
        <article
          aria-label={s.title}
          className="min-w-0 space-y-3 rounded-xl border bg-card p-5 text-sm"
        >
          <h3 className="text-base font-semibold tracking-tight">
            {s.title} <span className="font-normal text-muted-foreground">· with {s.botName}</span>
          </h3>
          <Alert theme="info">
            Read-only copy published {formatDateTime(s.createdAt, tf)}. Later messages in the
            original chat are not part of it.
          </Alert>
          {s.revokedAt && (
            <Alert theme="danger">
              This snapshot was taken down on {formatDateTime(s.revokedAt, tf)} and is no longer
              shared.
            </Alert>
          )}
          {!s.revokedAt && (
            <ol className="space-y-2">
              {s.content.map((p) => (
                <li
                  key={p.seq}
                  className={`min-w-0 rounded-lg p-3 ${p.role === "user" ? "bg-muted/60" : "border bg-background"}`}
                >
                  <p className="text-xs font-semibold">
                    #{p.seq} {p.role === "user" ? "User" : (p.author ?? "Bot")}
                    {p.thread ? (
                      <span className="font-normal"> · ↳ reply to #{p.thread}</span>
                    ) : null}
                  </p>
                  <div className="min-w-0 break-words">
                    <Markdown source={p.content} />
                  </div>
                  {p.attachments?.length ? (
                    <p className="text-xs text-muted-foreground">
                      Attached files (names only): {p.attachments.join(", ")}
                    </p>
                  ) : null}
                  {p.reactions && Object.keys(p.reactions).length ? (
                    <p className="text-xs">
                      {Object.entries(p.reactions)
                        .map(([e, n]) => `${e} ${n}`)
                        .join("  ")}
                    </p>
                  ) : null}
                </li>
              ))}
            </ol>
          )}
          {!s.revokedAt && me && s.ownerUserId === me && (
            <div className="pt-1">
              <ConfirmButton
                label="Take down"
                question="Stop sharing this snapshot with your team?"
                confirmLabel="Take down"
                onConfirm={() => revoke(open!.id)}
              />
            </div>
          )}
        </article>
      )}
    </section>
  );
}
