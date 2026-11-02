import { createFileRoute } from "@tanstack/react-router";

import { TaskPage } from "@/features/tasks/task-page";

export const Route = createFileRoute("/_auth/tasks_/$taskId")({
  head: () => ({ meta: [{ title: "Task · zetta" }] }),
  component: RouteComponent,
});

function RouteComponent() {
  const { taskId } = Route.useParams();
  return <TaskPage id={taskId} />;
}
