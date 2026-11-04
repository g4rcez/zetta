import { createFileRoute } from "@tanstack/react-router";

import { WikiItemPage } from "@/features/wiki/item-page";

export const Route = createFileRoute("/_auth/memory/$slug")({
  validateSearch: (
    search: Record<string, unknown>,
  ): { edit?: "1"; assist?: "links" | "tags" | "tidy" } => ({
    ...(search.edit === "1" || search.edit === 1 ? { edit: "1" as const } : {}),
    ...(search.assist === "links" || search.assist === "tags" || search.assist === "tidy"
      ? { assist: search.assist }
      : {}),
  }),
  component: RouteComponent,
});

function RouteComponent() {
  const { slug } = Route.useParams();
  const { edit, assist } = Route.useSearch();
  return <WikiItemPage slug={slug} edit={edit === "1"} assist={assist} />;
}
