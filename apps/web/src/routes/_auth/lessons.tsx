import { createFileRoute } from "@tanstack/react-router";

import { LessonsPage } from "@/features/learning/lessons-page";
import {
  parseLessonsSearch,
  withLessonsSearch,
  type LessonsSearch,
} from "@/features/learning/lessons-search";

export const Route = createFileRoute("/_auth/lessons")({
  head: () => ({ meta: [{ title: "Lessons · zetta" }] }),
  validateSearch: (search: Record<string, unknown>): LessonsSearch => parseLessonsSearch(search),
  component: RouteComponent,
});

function RouteComponent() {
  const search = Route.useSearch();
  const navigate = Route.useNavigate();
  return (
    <LessonsPage
      search={search}
      // Typing in a filter replaces the history entry, so Back leaves the page instead of undoing each letter.
      setSearch={(patch, { replace = false } = {}) =>
        void navigate({ search: (prev) => withLessonsSearch(prev, patch), replace })
      }
    />
  );
}
