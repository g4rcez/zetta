import { createFileRoute } from "@tanstack/react-router";

import { AddSourcePage, parseAddSourceSearch } from "@/features/memory/add-source-page";

export const Route = createFileRoute("/_auth/memory-add")({
  head: () => ({ meta: [{ title: "Add a source · zetta" }] }),
  validateSearch: parseAddSourceSearch,
  component: RouteComponent,
});

function RouteComponent() {
  const { from } = Route.useSearch();
  const navigate = Route.useNavigate();
  return (
    <AddSourcePage
      from={from ?? "url"}
      setFrom={(v) => void navigate({ search: v === "url" ? {} : { from: v } })}
    />
  );
}
