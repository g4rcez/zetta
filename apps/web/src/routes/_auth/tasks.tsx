import { createFileRoute } from "@tanstack/react-router";
import { parseTaskSearch } from "@/features/tasks/task-filters";
import { TasksPage } from "@/features/tasks/tasks-page";

export const Route = createFileRoute("/_auth/tasks")({
  component: RouteComponent,
  validateSearch: parseTaskSearch,
});

function RouteComponent() {
  const search = Route.useSearch();
  const navigate = Route.useNavigate();
  return (
    <TasksPage
      search={search}
      onSearch={(next) => void navigate({ search: next, replace: true })}
    />
  );
}
