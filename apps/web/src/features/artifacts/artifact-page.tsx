import { Link, useNavigate } from "@tanstack/react-router";
import {
  ArrowLeftIcon,
  DownloadSimpleIcon,
  ArrowSquareOutIcon,
  ChatIcon,
} from "@phosphor-icons/react";
import { useEffect, useState } from "react";
import { toast } from "sonner";

import { BotIdentity } from "@/components/bot-identity";
import { chatClient, errorMessage, type Bot } from "../chat/chat-client";
import { CopyButton } from "../chat/chat-copy";
import { Badge, ConfirmButton, Empty } from "../shared/ui";
import {
  ago,
  artifactsApi,
  contentUrl,
  formatSize,
  kindLabel,
  type Artifact,
} from "./artifacts-api";
import { ArtifactViewer } from "./viewers";

const action =
  "inline-flex items-center gap-1.5 rounded-md border px-3 py-1.5 text-sm hover:bg-muted";

/** One artifact: who made it and when, the actions, and a built-in preview chosen by its file type. */
export function ArtifactPage({ id }: { id: string }) {
  const navigate = useNavigate();
  const [artifact, setArtifact] = useState<Artifact | null>();
  const [bot, setBot] = useState<Bot>();

  useEffect(() => {
    setArtifact(undefined);
    artifactsApi.get(id).then(setArtifact, () => setArtifact(null));
  }, [id]);
  const botId = artifact?.botId;
  useEffect(() => {
    if (botId)
      chatClient.bots().then(
        (all) => setBot(all.find((b) => b.id === botId)),
        () => {},
      );
  }, [botId]);

  const remove = () =>
    artifactsApi.remove(id).then(
      () => void navigate({ to: "/artifacts" }),
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
                    title={new Date(artifact.createdAt).toLocaleString()}
                  >
                    {ago(artifact.createdAt)}
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
