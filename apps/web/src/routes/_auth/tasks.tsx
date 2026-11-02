import { createFileRoute } from "@tanstack/react-router";

import { parseTaskSearch } from "@/features/tasks/task-filters";
import { TasksPage } from "@/features/tasks/tasks-page";

// The filters, the view and the open task live in the URL, so a link or a reload keeps them.
export const Route = createFileRoute("/_auth/tasks")({
  validateSearch: parseTaskSearch,
  component: RouteComponent,
});

function RouteComponent() {
  const search = Route.useSearch();
  const navigate = Route.useNavigate();
  // `replace`: a filter change is not a page in the history.
  return (
    <TasksPage
      search={search}
      onSearch={(next) => void navigate({ search: next, replace: true })}
    />
  );
}
