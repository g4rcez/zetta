import { createFileRoute } from "@tanstack/react-router";

import { ArtifactPage } from "@/features/artifacts/artifact-page";

export const Route = createFileRoute("/_auth/artifacts/$artifactId")({
  head: () => ({ meta: [{ title: "Artifact · zetta" }] }),
  component: RouteComponent,
});

function RouteComponent() {
  const { artifactId } = Route.useParams();
  return <ArtifactPage id={artifactId} />;
}
