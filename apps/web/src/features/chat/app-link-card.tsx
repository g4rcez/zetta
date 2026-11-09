import { ArrowRightIcon, SquaresFourIcon } from "@phosphor-icons/react";
import { useQuery } from "@tanstack/react-query";
import { Link } from "@tanstack/react-router";
import { ARTIFACT_HTML_CSP } from "@zetta/core/artifact-csp";
import { useEffect, useRef, useState } from "react";

import { APP_FRAME_SANDBOX } from "../apps/app-frame";
import { appsQueries } from "../apps/apps-api";
import { Badge } from "../shared/ui";
import type { AppLinkData } from "./app-link-data";

/** The size the page is laid out at, and the box it is scaled into. The page is drawn small, as a picture. */
const PAGE = { w: 960, h: 540 };
const BOX = { w: 288, h: 162 };
const SCALE = BOX.w / PAGE.w;

/**
 * A small preview of an app with a link that opens it. The page is drawn inert (no host, so it cannot call a tool from the chat; no
 * clicks, no focus) and only once the card is on screen. Everything shown is read with the viewer's own session, so a block a bot wrote
 * cannot show more than the viewer may already open.
 */
export function AppLinkCard({ data }: { data: AppLinkData }) {
  const app = useQuery(appsQueries.detail(data.app));
  const title = app.data?.name ?? data.name ?? data.app;
  if (app.isError || (!app.isPending && !app.data))
    return (
      <div className="flex max-w-sm items-center gap-2 rounded-lg border bg-card p-3 text-sm text-muted-foreground">
        <SquaresFourIcon aria-hidden="true" />
        <span className="min-w-0 truncate">
          <strong className="text-foreground">{title}</strong> is no longer available.
        </span>
      </div>
    );
  const detail = app.data;
  return (
    <div className="flex w-full max-w-sm min-w-0 flex-col gap-2 overflow-hidden rounded-lg border bg-card p-3 text-sm">
      {detail?.ui ? (
        <Preview appRef={data.app} />
      ) : (
        <div
          aria-hidden="true"
          className="flex items-center justify-center rounded border bg-muted/40 text-muted-foreground"
          style={{ height: BOX.h }}
        >
          <SquaresFourIcon size={32} />
        </div>
      )}
      <div className="min-w-0">
        <div className="flex flex-wrap items-center gap-2">
          <strong className="min-w-0 truncate">{title}</strong>
          {detail?.version != null && <Badge>v{detail.version}</Badge>}
          {detail && (
            <span className="text-xs text-muted-foreground">
              {detail.tools} tool{detail.tools === 1 ? "" : "s"}
            </span>
          )}
        </div>
        {detail?.description && (
          <p className="mt-1 line-clamp-2 text-muted-foreground">{detail.description}</p>
        )}
      </div>
      <Link
        to="/apps/$ref"
        params={{ ref: data.app }}
        className="inline-flex items-center gap-1 self-start font-medium text-primary hover:underline"
      >
        Open {title}
        <ArrowRightIcon aria-hidden="true" />
      </Link>
    </div>
  );
}

/** The page as a picture. It is fetched and drawn only when the card scrolls into view. */
function Preview({ appRef }: { appRef: string }) {
  const box = useRef<HTMLDivElement>(null);
  const [visible, setVisible] = useState(false);
  useEffect(() => {
    const el = box.current;
    if (!el) return;
    // No IntersectionObserver (old browser, test DOM): draw at once.
    if (typeof IntersectionObserver === "undefined") return setVisible(true);
    const io = new IntersectionObserver((entries) => {
      if (entries.some((e) => e.isIntersecting)) {
        setVisible(true);
        io.disconnect();
      }
    });
    io.observe(el);
    return () => io.disconnect();
  }, []);
  const page = useQuery({ ...appsQueries.ui(appRef), enabled: visible });
  return (
    <div
      ref={box}
      aria-hidden="true"
      className="relative overflow-hidden rounded border bg-background"
      style={{ width: BOX.w, height: BOX.h, maxWidth: "100%" }}
    >
      {page.data && (
        <iframe
          title={`Preview of ${page.data.name}`}
          srcDoc={page.data.html}
          sandbox={APP_FRAME_SANDBOX}
          {...{ csp: ARTIFACT_HTML_CSP }}
          tabIndex={-1}
          loading="lazy"
          className="pointer-events-none absolute top-0 left-0 origin-top-left border-0"
          style={{ width: PAGE.w, height: PAGE.h, transform: `scale(${SCALE})` }}
        />
      )}
    </div>
  );
}
