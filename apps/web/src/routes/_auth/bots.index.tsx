import { createFileRoute } from "@tanstack/react-router";

import { BotsPage } from "@/features/bots/bots-page";
import { parseBotsSearch } from "@/features/bots/bots-search";

export const Route = createFileRoute("/_auth/bots/")({
  head: () => ({ meta: [{ title: "Bots · zetta" }] }),
  validateSearch: parseBotsSearch,
  component: RouteComponent,
});

function RouteComponent() {
  const search = Route.useSearch();
  const navigate = Route.useNavigate();
  return (
    <BotsPage
      search={search}
      onSearch={(next, opts) => void navigate({ search: next, replace: opts?.replace ?? false })}
    />
  );
}
