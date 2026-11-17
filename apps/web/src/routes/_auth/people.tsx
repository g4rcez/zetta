import { createFileRoute } from "@tanstack/react-router";

import { PeoplePage } from "@/features/people/people-page";
import {
  parsePeopleSearch,
  withPeopleSearch,
  type PeopleSearch,
} from "@/features/people/people-search";

export const Route = createFileRoute("/_auth/people")({
  head: () => ({ meta: [{ title: "People · zetta" }] }),
  validateSearch: (search: Record<string, unknown>): PeopleSearch => parsePeopleSearch(search),
  component: RouteComponent,
});

function RouteComponent() {
  const search = Route.useSearch();
  const navigate = Route.useNavigate();
  return (
    <PeoplePage
      search={search}
      // Typing replaces the history entry, so Back leaves the page instead of undoing each letter.
      setSearch={(patch) =>
        void navigate({ search: (prev) => withPeopleSearch(prev, patch), replace: true })
      }
    />
  );
}
