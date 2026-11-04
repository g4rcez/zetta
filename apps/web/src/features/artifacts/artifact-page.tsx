import { Link, useNavigate } from "@tanstack/react-router";
import {
  ArrowLeftIcon,
  DownloadSimpleIcon,
  ArrowSquareOutIcon,
  ChatIcon,
} from "@phosphor-icons/react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";

import { BotIdentity } from "@/components/bot-identity";
import { errorMessage } from "../chat/chat-client";
import { chatQueries } from "../chat/chat-queries";
import { CopyButton } from "../chat/chat-copy";
import { Badge, ConfirmButton, Empty } from "../shared/ui";
import {
  artifactsApi,
  artifactsQueries,
  contentUrl,
  formatSize,
  kindLabel,
  type Artifact,
} from "./artifacts-api";
import { relativeTime } from "../shared/relative-time";
import { ArtifactViewer } from "./viewers";
import { useTimeFormat } from "@/features/preferences/preferences";
import { formatDateTime } from "@/features/preferences/time-format";

const action =
  "inline-flex items-center gap-1.5 rounded-md border px-3 py-1.5 text-sm hover:bg-muted";

/** One artifact: who made it and when, the actions, and a built-in preview chosen by its file type. */
export function ArtifactPage({ id }: { id: string }) {
  const tf = useTimeFormat();
  const navigate = useNavigate();
  const qc = useQueryClient();
  const query = useQuery(artifactsQueries.detail(id));
  const artifact: Artifact | null | undefined = query.isError && !query.data ? null : query.data;
  const botId = artifact?.botId;
  const bots = useQuery({ ...chatQueries.bots(), enabled: !!botId }).data;
  const bot = botId ? bots?.find((b) => b.id === botId) : undefined;

  const remove = () =>
    artifactsApi.remove(id).then(
      () => {
        // Stale only: this page still shows the artifact until the router leaves, and a refetch would answer 404.
        void qc.invalidateQueries({ queryKey: ["artifacts"], refetchType: "none" });
        void navigate({ to: "/artifacts" });
      },
      (e) => void toast.error(errorMessage(e)),
    );

  return (
    <div className="h-full overflow-y-auto">
      <div className="mx-auto flex w-full max-w-6xl flex-col gap-5 p-4 md:p-8">
        <Link
          to="/artifacts"
          className="inline-flex w-fit items-center gap-1 text-sm text-muted-foreground hover:text-foreground"
        >
          <ArrowLeftIcon aria-hidden="true" className="size-4" />
          Artifacts
        </Link>
        {artifact === undefined ? (
          <p className="text-sm text-muted-foreground">Loading…</p>
        ) : artifact === null ? (
          <Empty>This artifact does not exist or was deleted.</Empty>
        ) : (
          <>
            <header className="flex flex-wrap items-start gap-x-6 gap-y-3">
              <div className="min-w-0 flex-1 space-y-1">
                <h1 className="flex flex-wrap items-center gap-2 text-lg">
                  <span className="min-w-0 break-words">{artifact.title}</span>
                  <Badge>{kindLabel(artifact.kind)}</Badge>
                  {artifact.routineRunId && <Badge tone="info">Routine</Badge>}
                </h1>
                {artifact.description && (
                  <p className="text-sm text-muted-foreground">{artifact.description}</p>
                )}
                <p className="text-xs text-muted-foreground">
                  {artifact.fileName} · {formatSize(artifact.size)} · {artifact.mimeType} ·{" "}
                  <time
                    dateTime={artifact.createdAt}
                    title={formatDateTime(artifact.createdAt, tf)}
                  >
                    {relativeTime(artifact.createdAt)}
                  </time>
                </p>
              </div>
              {artifact.botId && (
                <BotIdentity
                  bot={bot ?? { id: artifact.botId, name: "Deleted bot" }}
                  size={32}
                  sub="Author"
                  className="w-48"
                />
              )}
            </header>
            <div className="flex flex-wrap items-center gap-2">
              <a href={contentUrl(artifact.id, true)} className={action}>
                <DownloadSimpleIcon aria-hidden="true" className="size-4" />
                Download
              </a>
              <a
                href={contentUrl(artifact.id)}
                target="_blank"
                rel="noopener noreferrer"
                className={action}
              >
                <ArrowSquareOutIcon aria-hidden="true" className="size-4" />
                Open in a new tab
              </a>
              <CopyButton text={window.location.href} label="Copy link" />
              {artifact.conversationId && (
                <Link
                  to="/chat/{-$chatId}"
                  params={{ chatId: artifact.conversationId }}
                  className={action}
                >
                  <ChatIcon aria-hidden="true" className="size-4" />
                  Open the chat
                </Link>
              )}
              <span className="ml-auto">
                <ConfirmButton
                  label="Delete"
                  question="Delete this file for good?"
                  confirmLabel="Delete"
                  variant="destructive"
                  onConfirm={remove}
                />
              </span>
            </div>
            <ArtifactViewer a={artifact} />
          </>
        )}
      </div>
    </div>
  );
}
