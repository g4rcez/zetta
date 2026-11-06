import { createFileRoute } from "@tanstack/react-router";

import { PlaygroundPage } from "@/features/playground/playground-page";
import {
  parsePlaygroundSearch,
  withPlaygroundSearch,
  type PlaygroundSearch,
} from "@/features/playground/playground-search";

export const Route = createFileRoute("/_auth/playground_/$id")({
  head: () => ({ meta: [{ title: "Playground · zetta" }] }),
  validateSearch: (search: Record<string, unknown>): PlaygroundSearch =>
    parsePlaygroundSearch(search),
  component: RouteComponent,
});

function RouteComponent() {
  const { id } = Route.useParams();
  const search = Route.useSearch();
  const navigate = Route.useNavigate();
  return (
    <PlaygroundPage
      id={id}
      search={search}
      // Choosing a file or a run is a step the Back button can undo; nothing here is typed into the address.
      setSearch={(patch, { replace = false } = {}) =>
        void navigate({ search: (prev) => withPlaygroundSearch(prev, patch), replace })
      }
      onOpen={(next) => void navigate({ to: "/playground/$id", params: { id: next } })}
      onLeave={() => void navigate({ to: "/playground" })}
    />
  );
}
