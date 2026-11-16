import { createFileRoute } from "@tanstack/react-router";

import { NewProjectPage } from "@/features/projects/new-project-page";

export const Route = createFileRoute("/_auth/projects_/new")({
  head: () => ({ meta: [{ title: "New project · zetta" }] }),
  component: NewProjectPage,
});
