import { createFileRoute } from "@tanstack/react-router";

import { WikiDraftPage } from "@/features/wiki/draft-page";

export const Route = createFileRoute("/_auth/wiki-draft")({
  validateSearch: (search: Record<string, unknown>): { d?: string } =>
    typeof search.d === "string" || typeof search.d === "number" ? { d: String(search.d) } : {},
  component: RouteComponent,
});

function RouteComponent() {
  const { d } = Route.useSearch();
  return <WikiDraftPage d={d} />;
}
