import { Outlet, createFileRoute, useChildMatches } from "@tanstack/react-router";

import { ArtifactsPage } from "@/features/artifacts/artifacts-page";
import { ARTIFACT_KINDS, type ArtifactKind } from "@/features/artifacts/artifacts-api";

type ArtifactsSearch = {
  bot?: string;
  kind?: ArtifactKind;
  q?: string;
  sort?: "oldest" | "largest";
};

export const Route = createFileRoute("/_auth/artifacts")({
  head: () => ({ meta: [{ title: "Artifacts · zetta" }] }),
  validateSearch: (search: Record<string, unknown>): ArtifactsSearch => ({
    ...(typeof search.bot === "string" && /^[0-9a-f-]{36}$/i.test(search.bot)
      ? { bot: search.bot }
      : {}),
    ...(typeof search.kind === "string" && ARTIFACT_KINDS.some((k) => k.kind === search.kind)
      ? { kind: search.kind as ArtifactKind }
      : {}),
    ...(search.sort === "oldest" || search.sort === "largest" ? { sort: search.sort } : {}),
    ...(typeof search.q === "string" && search.q.trim()
      ? { q: search.q.trim().slice(0, 200) }
      : {}),
  }),
  component: RouteComponent,
});

/** This route is the parent of /artifacts/$artifactId: the list shows only when no child page is open. */
function RouteComponent() {
  const filter = Route.useSearch();
  const child = useChildMatches();
  return child.length ? <Outlet /> : <ArtifactsPage filter={filter} />;
}
