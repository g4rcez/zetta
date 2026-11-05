import { createFileRoute } from "@tanstack/react-router";

import { PreferencesPage } from "@/features/preferences/preferences-page";

export const Route = createFileRoute("/_auth/preferences")({
  head: () => ({ meta: [{ title: "Preferences · zetta" }] }),
  component: PreferencesPage,
});
