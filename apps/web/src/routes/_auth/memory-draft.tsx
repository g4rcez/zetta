import { createFileRoute } from "@tanstack/react-router";

import { MemoryDraftPage } from "@/features/memory/draft-page";

export const Route = createFileRoute("/_auth/memory-draft")({
  validateSearch: (search: Record<string, unknown>): { d?: string } =>
    typeof search.d === "string" || typeof search.d === "number" ? { d: String(search.d) } : {},
  component: RouteComponent,
});

function RouteComponent() {
  const { d } = Route.useSearch();
  return <MemoryDraftPage d={d} />;
}
