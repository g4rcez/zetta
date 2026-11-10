import { createFileRoute } from "@tanstack/react-router";

import { BotSettingsPage, parseBotTab, type BotTab } from "@/features/chat/bot-settings";

export const Route = createFileRoute("/_auth/bots/$botId/settings")({
  head: () => ({ meta: [{ title: "Bot settings · zetta" }] }),
  validateSearch: (search: Record<string, unknown>): { tab?: BotTab } => {
    const tab = parseBotTab(search.tab);
    return tab ? { tab } : {};
  },
  component: RouteComponent,
});

function RouteComponent() {
  const { botId } = Route.useParams();
  const { tab } = Route.useSearch();
  const navigate = Route.useNavigate();
  return (
    <BotSettingsPage
      botId={botId}
      tab={tab ?? "setup"}
      onTab={(t) => void navigate({ search: t === "setup" ? {} : { tab: t } })}
    />
  );
}
