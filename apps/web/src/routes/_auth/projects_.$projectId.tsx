import { createFileRoute } from "@tanstack/react-router";

import { ProjectPage } from "@/features/projects/project-page";

export const Route = createFileRoute("/_auth/projects_/$projectId")({
  head: () => ({ meta: [{ title: "Project · zetta" }] }),
  component: RouteComponent,
});

function RouteComponent() {
  const { projectId } = Route.useParams();
  return <ProjectPage id={projectId} />;
}
