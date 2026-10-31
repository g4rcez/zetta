import { createFileRoute } from "@tanstack/react-router";

import { PluginPage } from "@/features/plugins/plugin-page";

export const Route = createFileRoute("/_auth/plugins/$pluginId")({
  head: () => ({ meta: [{ title: "Plugin · zetta" }] }),
  component: RouteComponent,
});

function RouteComponent() {
  const { pluginId } = Route.useParams();
  const { identity } = Route.useRouteContext();
  return <PluginPage pluginId={pluginId} isAdmin={identity.isAdmin} />;
}
