import { createFileRoute } from "@tanstack/react-router";

import { BotOnboarding } from "@/features/bots/bot-onboarding";
import {
  parseBotsNewSearch,
  withBotsNewSearch,
  type BotsNewSearch,
} from "@/features/bots/bots-new-search";

export const Route = createFileRoute("/_auth/bots/new")({
  validateSearch: (search: Record<string, unknown>): BotsNewSearch => parseBotsNewSearch(search),
  component: RouteComponent,
});

function RouteComponent() {
  const search = Route.useSearch();
  const navigate = Route.useNavigate();
  return (
    <BotOnboarding
      search={search}
      // Typing in the search replaces the history entry, so Back leaves the page instead of undoing each letter.
      setSearch={(patch, { replace = false } = {}) =>
        void navigate({ search: (prev) => withBotsNewSearch(prev, patch), replace })
      }
    />
  );
}
