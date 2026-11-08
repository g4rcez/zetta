import { queryOptions, useQuery } from "@tanstack/react-query";
import { useEffect, useRef, useState } from "react";
import {
  CaretLeftIcon,
  CaretRightIcon,
  DownloadSimpleIcon,
  ImageBrokenIcon,
  XIcon,
} from "@phosphor-icons/react";

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
      const r = await fetch(new URL(`/api/attachments/${id}/content`, ENV.VITE_SERVER_URL), {
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
    <button
      type="button"
      onClick={onOpen}
      aria-label={`Open ${pic.name}`}
      className="block max-w-full cursor-zoom-in overflow-hidden rounded-lg border bg-muted/30 outline-offset-2 focus-visible:outline-2"
    >
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

/** Full-size viewer in a native dialog. Arrow keys move between the message's pictures, Escape or a click outside closes it. */
export function ImageViewer({
  pics,
  start,
  onClose,
}: {
  pics: Pic[];
  start: number;
  onClose: () => void;
}) {
  const ref = useRef<HTMLDialogElement>(null);
  const [index, setIndex] = useState(start);
  const pic = pics[index]!;
  const src = useAttachmentSrc(pic.id);
  useEffect(() => {
    const d = ref.current;
    if (d && !d.open) d.showModal();
  }, []);
  const step = (d: number) => setIndex((i) => (i + d + pics.length) % pics.length);
  return (
    <dialog
      ref={ref}
      aria-label={pic.name}
      onClose={onClose}
      onClick={(e) => {
        if (e.target === ref.current) ref.current?.close();
      }}
      onKeyDown={(e) => {
        if (pics.length > 1 && (e.key === "ArrowRight" || e.key === "ArrowLeft")) {
          e.preventDefault();
          step(e.key === "ArrowRight" ? 1 : -1);
        }
      }}
      className="m-auto max-h-[94vh] w-[min(1200px,96vw)] max-w-none overflow-hidden rounded-2xl border bg-background p-0 text-foreground shadow-2xl backdrop:bg-black/70"
    >
      <div className="flex items-center gap-2 border-b px-4 py-2 text-sm">
        <span className="min-w-0 flex-1 truncate font-medium">{pic.name}</span>
        {pics.length > 1 && (
          <span className="text-xs text-muted-foreground">
            {index + 1} / {pics.length}
          </span>
        )}
        {src && (
          <a
            href={src}
            download={pic.name}
            aria-label="Download"
            className="rounded p-1.5 hover:bg-muted"
          >
            <DownloadSimpleIcon className="size-4" />
          </a>
        )}
        <button
          type="button"
          aria-label="Close"
          onClick={() => ref.current?.close()}
          className="rounded p-1.5 hover:bg-muted"
        >
          <XIcon className="size-4" />
        </button>
      </div>
      <div className="relative flex max-h-[calc(94vh-3rem)] min-h-48 items-center justify-center bg-black/80 p-2">
        {src ? (
          <img
            src={src}
            alt={pic.name}
            className="max-h-[calc(94vh-4rem)] max-w-full object-contain"
          />
        ) : src === null ? (
          <span className="text-sm text-white/70">Image unavailable</span>
        ) : (
          <Skeleton as="div" decorative className="size-64!" />
        )}
        {pics.length > 1 && (
          <>
            <button
              type="button"
              aria-label="Previous image"
              onClick={() => step(-1)}
              className="absolute left-3 rounded-full bg-background/80 p-2 hover:bg-background"
            >
              <CaretLeftIcon className="size-5" />
            </button>
            <button
              type="button"
              aria-label="Next image"
              onClick={() => step(1)}
              className="absolute right-3 rounded-full bg-background/80 p-2 hover:bg-background"
            >
              <CaretRightIcon className="size-5" />
            </button>
          </>
        )}
      </div>
    </dialog>
  );
}
