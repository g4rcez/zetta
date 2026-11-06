import { createFileRoute, Link } from "@tanstack/react-router";

import { PlaygroundsPage } from "@/features/playground/playgrounds-page";
import {
  parsePlaygroundsSearch,
  withPlaygroundsSearch,
  type PlaygroundsSearch,
} from "@/features/playground/playground-search";

export const Route = createFileRoute("/_auth/playground")({
  head: () => ({ meta: [{ title: "Playground · zetta" }] }),
  validateSearch: (search: Record<string, unknown>): PlaygroundsSearch =>
    parsePlaygroundsSearch(search),
  component: RouteComponent,
});

function RouteComponent() {
  const search = Route.useSearch();
  const navigate = Route.useNavigate();
  return (
    <PlaygroundsPage
      search={search}
      setSearch={(patch, { replace = false } = {}) =>
        void navigate({ search: (prev) => withPlaygroundsSearch(prev, patch), replace })
      }
      onOpen={(id) => void navigate({ to: "/playground/$id", params: { id } })}
      renderLink={(id, children) => (
        <Link to="/playground/$id" params={{ id }} className="block min-w-0">
          {children}
        </Link>
      )}
    />
  );
}
