import { createFileRoute } from "@tanstack/react-router";

import { AppsPage } from "@/features/apps/apps-page";
import { parseAppsSearch, withAppsSearch, type AppsSearch } from "@/features/apps/apps-search";

export const Route = createFileRoute("/_auth/apps")({
  head: () => ({ meta: [{ title: "Apps · zetta" }] }),
  validateSearch: (search: Record<string, unknown>): AppsSearch => parseAppsSearch(search),
  component: RouteComponent,
});

function RouteComponent() {
  const { identity } = Route.useRouteContext();
  const search = Route.useSearch();
  const navigate = Route.useNavigate();
  return (
    <AppsPage
      userId={identity.userId}
      search={search}
      // Choosing a tab or submitting a search adds a history entry, so Back returns to the earlier view.
      setSearch={(patch, { replace = false } = {}) =>
        void navigate({ search: (prev) => withAppsSearch(prev, patch), replace })
      }
    />
  );
}
