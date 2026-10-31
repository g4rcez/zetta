import { createFileRoute } from "@tanstack/react-router";

import { BotSettingsPage } from "@/features/chat/bot-settings";

export const Route = createFileRoute("/_auth/bots/$botId/settings")({
  head: () => ({ meta: [{ title: "Bot settings · zetta" }] }),
  component: RouteComponent,
});

function RouteComponent() {
  const { botId } = Route.useParams();
  return <BotSettingsPage botId={botId} />;
}
