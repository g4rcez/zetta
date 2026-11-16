import { createFileRoute } from "@tanstack/react-router";
import { parseProjectSearch } from "@/features/projects/project-filters";
import { ProjectsPage } from "@/features/projects/projects-page";

export const Route = createFileRoute("/_auth/projects")({
  head: () => ({ meta: [{ title: "Projects · zetta" }] }),
  component: RouteComponent,
  validateSearch: parseProjectSearch,
});

function RouteComponent() {
  const search = Route.useSearch();
  const navigate = Route.useNavigate();
  return (
    <ProjectsPage
      search={search}
      onSearch={(next, opts) => void navigate({ search: next, replace: opts?.replace ?? false })}
    />
  );
}
