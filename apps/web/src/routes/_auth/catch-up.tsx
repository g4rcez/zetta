import { createFileRoute } from "@tanstack/react-router";
import { CatchUpPage } from "@/features/catch-up/catch-up-page";
import { parseCatchUpSearch } from "@/features/catch-up/catch-up-search";

export const Route = createFileRoute("/_auth/catch-up")({
  component: RouteComponent,
  validateSearch: parseCatchUpSearch,
});

function RouteComponent() {
  const search = Route.useSearch();
  const navigate = Route.useNavigate();
  const { identity } = Route.useRouteContext();
  return (
    <CatchUpPage
      isAdmin={identity.isAdmin}
      search={search}
      onSearch={(next) => void navigate({ search: next, replace: true })}
    />
  );
}
