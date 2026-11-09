import { createFileRoute } from "@tanstack/react-router";

import { AppPage } from "@/features/apps/app-page";
import { parseAppSearch, withAppSearch, type AppSearch } from "@/features/apps/apps-search";

export const Route = createFileRoute("/_auth/apps_/$ref")({
  head: () => ({ meta: [{ title: "App · zetta" }] }),
  validateSearch: (search: Record<string, unknown>): AppSearch => parseAppSearch(search),
  component: RouteComponent,
});

function RouteComponent() {
  const { ref } = Route.useParams();
  const search = Route.useSearch();
  const navigate = Route.useNavigate();
  return (
    <AppPage
      appRef={ref}
      search={search}
      setSearch={(patch) => void navigate({ search: (prev) => withAppSearch(prev, patch) })}
      onLeave={() => void navigate({ to: "/apps" })}
    />
  );
}
