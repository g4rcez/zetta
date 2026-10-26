import { createFileRoute, redirect } from "@tanstack/react-router";

import { StudioPage } from "@/features/studio/studio-page";
import { isStudioTab } from "@/features/studio/studio-tabs";

export const Route = createFileRoute("/_auth/studio/$tab")({
  validateSearch: (search: Record<string, unknown>) => search,
  beforeLoad: ({ params, search }) => {
    if (!isStudioTab(params.tab)) throw redirect({ to: "/studio/$tab", params: { tab: "routines" }, search, replace: true });
  },
  component: StudioPage,
});
