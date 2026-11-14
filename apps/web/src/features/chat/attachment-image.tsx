import { ActionHint } from "@/components/action-hint";
import { queryOptions, useQuery } from "@tanstack/react-query";
import { useEffect, useRef, useState } from "react";
import { ImageBrokenIcon } from "@phosphor-icons/react";
import { ImageLightbox } from "@/components/zoom-image";

import { Skeleton } from "@g4rcez/components";
import { cn } from "@zetta/ui/lib/utils";
import { ENV } from "../../env";

export type Pic = { id: string; name: string };

/** Resolved URLs and natural sizes, read synchronously so a picture seen before renders at its final size on the first frame. */
const urls = new Map<string, string>();
const sizes = new Map<string, { w: number; h: number }>();

/**
 * One object URL per stored picture for the whole session: the cache never expires an entry, and the server serves each file with an immutable cache header too.
 * The object URLs live as long as the session on purpose: every message that shows a picture shares them, so none is revoked on unmount.
 */
const attachmentSrc = (id: string) =>
  queryOptions({
    queryKey: ["attachments", id, "content"],
    queryFn: async () => {
      const r = await fetch(new URL(`/api/attachments/${id}/content`, ENV.ZETTA_SERVER_URL), {
        credentials: "include",
      });
      if (!r.ok) throw new Error("image");
      const url = URL.createObjectURL(await r.blob());
      urls.set(id, url);
      return url;
    },
    staleTime: Infinity,
    gcTime: Infinity,
    retry: false,
  });

/** `undefined` while loading, `null` when the picture is gone. */
export function useAttachmentSrc(id: string, enabled = true) {
  const { data, isError } = useQuery({ ...attachmentSrc(id), enabled });
  return isError ? null : data;
}

export function AttachmentImage({
  pic,
  className,
  onOpen,
}: {
  pic: Pic;
  className?: string;
  onOpen: () => void;
}) {
  // Fetch only once the tile is near the viewport: a long history does not download every picture on open.
  const [near, setNear] = useState(urls.has(pic.id));
  const tile = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const el = tile.current;
    if (near || !el) return;
    const io = new IntersectionObserver(
      ([e]) => {
        if (e?.isIntersecting) setNear(true);
      },
      { rootMargin: "400px" },
    );
    io.observe(el);
    return () => io.disconnect();
  }, [near]);
  const src = useAttachmentSrc(pic.id, near);
  if (src === undefined)
    return (
      <div ref={tile} className={className}>
        <Skeleton as="div" decorative className="size-40! rounded-lg!" />
      </div>
    );
  if (src === null)
    return (
      <span
        className={cn(
          "inline-flex size-40 flex-col items-center justify-center gap-1 rounded-lg border bg-muted/40 text-xs text-muted-foreground",
          className,
        )}
      >
        <ImageBrokenIcon className="size-5" aria-hidden="true" />
        Image unavailable
      </span>
    );
  return (
    <ActionHint label={`Open ${pic.name}`}>
      <button
        type="button"
        onClick={onOpen}
        aria-label={`Open ${pic.name}`}
        className="block max-w-full cursor-zoom-in overflow-hidden rounded-lg border bg-muted/30 outline-offset-2 focus-visible:outline-2"
      >
        {/* No zoom: the tile is a button that opens `ImageViewer`, which zooms. */}
        <img
          src={src}
          alt={pic.name}
          width={sizes.get(pic.id)?.w}
          height={sizes.get(pic.id)?.h}
          onLoad={(e) =>
            sizes.set(pic.id, { w: e.currentTarget.naturalWidth, h: e.currentTarget.naturalHeight })
          }
          className={cn("block h-auto max-h-[360px] max-w-full object-contain", className)}
        />
      </button>
    </ActionHint>
  );
}

/** Slack-style picture block under a message: one picture large, several as a grid of tiles. */
export function PictureStrip({ pics }: { pics: Pic[] }) {
  const [open, setOpen] = useState<number>();
  if (!pics.length) return null;
  const many = pics.length > 1;
  return (
    <>
      <div
        className={cn("flex flex-wrap gap-2", many ? "max-w-xl" : "max-w-sm")}
        aria-label="Images"
      >
        {pics.map((p, i) => (
          <AttachmentImage
            key={p.id}
            pic={p}
            onOpen={() => setOpen(i)}
            className={many ? "size-40 max-h-40 object-cover" : "max-w-sm"}
          />
        ))}
      </div>
      {open !== undefined && (
        <ImageViewer pics={pics} start={open} onClose={() => setOpen(undefined)} />
      )}
    </>
  );
}

/** Fullscreen viewer with zoom (`ImageLightbox`). Arrow keys move between the message's pictures, Escape closes it. */
export function ImageViewer({
  pics,
  start,
  onClose,
}: {
  pics: Pic[];
  start: number;
  onClose: () => void;
}) {
  const [index, setIndex] = useState(start);
  const pic = pics[index]!;
  const src = useAttachmentSrc(pic.id);
  return (
    <ImageLightbox
      name={pic.name}
      src={src}
      index={index}
      count={pics.length}
      onStep={(d) => setIndex((i) => (i + d + pics.length) % pics.length)}
      onClose={onClose}
    />
  );
}
