import { Link } from "@tanstack/react-router";
import { ArrowSquareOutIcon, DownloadSimpleIcon, XIcon } from "@phosphor-icons/react";
import { useEffect, useState } from "react";

import { Button } from "@zetta/ui/components/button";

import { artifactsApi, contentUrl, kindLabel, type Artifact } from "../artifacts/artifacts-api";
import { ArtifactViewer } from "../artifacts/viewers";
import { Badge, Empty } from "../shared/ui";

const iconButton =
  "flex size-7 shrink-0 items-center justify-center rounded-md text-muted-foreground hover:bg-muted hover:text-foreground focus-visible:outline-2 focus-visible:outline-ring";

/** A file a bot published, opened beside the chat so the conversation stays in view. The full page stays one link away. */
export function ArtifactPanel({ id, onClose }: { id: string; onClose: () => void }) {
  // `undefined` while loading, `null` when it is gone.
  const [artifact, setArtifact] = useState<Artifact | null>();
  useEffect(() => {
    setArtifact(undefined);
    artifactsApi.get(id).then(setArtifact, () => setArtifact(null));
  }, [id]);
  return (
    <section aria-label="Artifact" className="flex h-full min-h-0 flex-col bg-background">
      <header className="flex h-12 shrink-0 items-center gap-2 border-b px-4">
        <div className="flex min-w-0 flex-1 items-center gap-2">
          <h2 className="min-w-0 truncate text-base font-bold leading-tight">
            {artifact?.title ?? "Artifact"}
          </h2>
          {artifact && <Badge>{kindLabel(artifact.kind)}</Badge>}
        </div>
        {artifact && (
          <a
            href={contentUrl(artifact.id, true)}
            aria-label="Download"
            title="Download"
            className={iconButton}
          >
            <DownloadSimpleIcon aria-hidden="true" className="size-4" />
          </a>
        )}
        <Link
          to="/artifacts/$artifactId"
          params={{ artifactId: id }}
          aria-label="Open full page"
          title="Open full page"
          className={iconButton}
        >
          <ArrowSquareOutIcon aria-hidden="true" className="size-4" />
        </Link>
        <Button size="icon-sm" variant="ghost" aria-label="Close artifact" onClick={onClose}>
          <XIcon />
        </Button>
      </header>
      <div className="min-h-0 flex-1 overflow-y-auto p-4">
        {artifact === undefined ? (
          <p role="status" className="text-sm text-muted-foreground">
            Loading…
          </p>
        ) : artifact === null ? (
          <Empty>This artifact does not exist or was deleted.</Empty>
        ) : (
          <ArtifactViewer a={artifact} />
        )}
      </div>
    </section>
  );
}
