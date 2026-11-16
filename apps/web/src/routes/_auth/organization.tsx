import { createFileRoute } from "@tanstack/react-router";

import { parseOrgSearch } from "@/features/org/org-search";
import { OrganizationPage } from "@/features/org/organization-page";

export const Route = createFileRoute("/_auth/organization")({
  head: () => ({ meta: [{ title: "Organization · zetta" }] }),
  component: RouteComponent,
  validateSearch: parseOrgSearch,
});

function RouteComponent() {
  const search = Route.useSearch();
  const navigate = Route.useNavigate();
  return (
    <OrganizationPage
      search={search}
      onSearch={(next, opts) => void navigate({ search: next, replace: opts?.replace ?? false })}
    />
  );
}
