import { createFileRoute } from "@tanstack/react-router";

import { SkillsPage } from "@/features/skills/skills-page";
import { parseSkillsSearch, withSearch, type SkillsSearch } from "@/features/skills/skills-search";

export const Route = createFileRoute("/_auth/skills")({
  head: () => ({ meta: [{ title: "Skills · zetta" }] }),
  validateSearch: (search: Record<string, unknown>): SkillsSearch => parseSkillsSearch(search),
  component: RouteComponent,
});

function RouteComponent() {
  const { identity } = Route.useRouteContext();
  const search = Route.useSearch();
  const navigate = Route.useNavigate();
  return (
    <SkillsPage
      userId={identity.userId}
      isAdmin={identity.isAdmin}
      search={search}
      // Typing in a filter replaces the history entry, so Back leaves the page instead of undoing each letter.
      setSearch={(patch, { replace = false } = {}) =>
        void navigate({ search: (prev) => withSearch(prev, patch), replace })
      }
    />
  );
}
