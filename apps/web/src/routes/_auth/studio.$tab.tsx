import { createFileRoute, redirect } from "@tanstack/react-router";

import { StudioPage } from "@/features/studio/studio-page";
import { isStudioTab } from "@/features/studio/studio-tabs";

export const Route = createFileRoute("/_auth/studio/$tab")({
  validateSearch: (search: Record<string, unknown>) => search,
  beforeLoad: ({ params, search }) => {
    // The wiki left Studio. Links saved in attention items still point here, so they go to the item (or the explorer).
    // Drive documents and feeds moved into the Wiki page with the rest of what the bots know.
    if (params.tab === "knowledge") throw redirect({ to: "/memory", replace: true });
    if (params.tab === "wiki") {
      const page = typeof search.page === "string" ? search.page.slice(0, 80) : "";
      throw page
        ? redirect({ to: "/memory/$slug", params: { slug: page }, replace: true })
        : redirect({ to: "/memory", replace: true });
    }
    // Routines left Studio for their own page. Links saved before (and attention cards) may still point here.
    if (params.tab === "routines")
      throw redirect({
        to: "/routines",
        search: typeof search.routine === "string" ? { routine: search.routine } : {},
        replace: true,
      });
    if (!isStudioTab(params.tab))
      throw redirect({
        to: "/studio/$tab",
        params: { tab: "overview" },
        search,
        replace: true,
      });
  },
  component: StudioPage,
});
