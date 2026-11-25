import { ActionHint } from "@/components/action-hint";
import { Link } from "@tanstack/react-router";
import { ArrowSquareOutIcon, DownloadSimpleIcon, XIcon } from "@phosphor-icons/react";
import { useQuery } from "@tanstack/react-query";
import { useRef } from "react";

import { Button } from "@/components/ui";

import { artifactsApi, contentUrl, kindLabel, type Artifact } from "../artifacts/artifacts-api";
import { OutlineMenu, ReadingBody, ReadingProgress, ReadingTime } from "../artifacts/reading-aids";
import { useReading } from "../artifacts/use-reading";
import { CopyContentButton } from "../artifacts/viewers";
import { Badge, Empty } from "../shared/ui";

const iconButton =
  "flex size-7 shrink-0 items-center justify-center rounded-md text-muted-foreground hover:bg-muted hover:text-foreground focus-visible:outline-2 focus-visible:outline-ring";

/** A file a bot published, opened beside the chat so the conversation stays in view. The full page stays one link away. */
export function ArtifactPanel({ id, onClose }: { id: string; onClose: () => void }) {
  const { data, isError } = useQuery({
    queryKey: ["artifacts", id],
    queryFn: () => artifactsApi.get(id),
    retry: false,
  });
  // `undefined` while loading, `null` when it is gone.
  const artifact: Artifact | null | undefined = isError ? null : data;
  const scroll = useRef<HTMLDivElement>(null);
  const reading = useReading(artifact, scroll);
  return (
    <section
      aria-label="Artifact"
      className="@container/artifact flex h-full min-h-0 flex-col bg-background"
    >
      <header className="flex h-12 shrink-0 items-center gap-2 border-b px-4">
        <div className="flex min-w-0 flex-1 items-center gap-2">
          <h2 className="min-w-0 truncate text-base font-bold leading-tight">
            {artifact?.title ?? "Artifact"}
          </h2>
          {artifact && (
            // On a phone the title needs this room more than the kind does.
            <span className="shrink-0 @max-[24rem]/artifact:hidden">
              <Badge>{kindLabel(artifact.kind)}</Badge>
            </span>
          )}
          {reading.minutes !== undefined && (
            <ReadingTime
              minutes={reading.minutes}
              className="hidden @min-[32rem]/artifact:inline"
            />
          )}
        </div>
        {reading.outline.items.length > 0 && (
          <OutlineMenu outline={reading.outline} className="@min-[60rem]/artifact:!hidden" />
        )}
        {artifact && <CopyContentButton a={artifact} />}
        {artifact && (
          <ActionHint label="Download">
            <a
              href={contentUrl(artifact.id, true)}
              aria-label="Download"

              className={iconButton}
            >
              <DownloadSimpleIcon aria-hidden="true" className="size-4" />
            </a>
          </ActionHint>
        )}
        <ActionHint label="Open full page">
          <Link
            to="/artifacts/$artifactId"
            params={{ artifactId: id }}
            aria-label="Open full page"

            className={iconButton}
          >
            <ArrowSquareOutIcon aria-hidden="true" className="size-4" />
          </Link>
        </ActionHint>
        <ActionHint label="Close artifact">
          <Button size="icon-sm" variant="ghost" aria-label="Close artifact" onClick={onClose}>
            <XIcon />
          </Button>
        </ActionHint>
      </header>
      {reading.text !== undefined && <ReadingProgress scroll={scroll} text={reading.text} />}
      <div
        ref={scroll}
        className="min-h-0 flex-1 overflow-y-auto px-4 py-6 @min-[32rem]/artifact:px-6 @min-[32rem]/artifact:py-8"
      >
        {artifact === undefined ? (
          <p role="status" className="text-sm text-muted-foreground">
            Loading…
          </p>
        ) : artifact === null ? (
          <Empty>This artifact does not exist or was deleted.</Empty>
        ) : (
          <ReadingBody artifact={artifact} outline={reading.outline} />
        )}
      </div>
    </section>
  );
}
