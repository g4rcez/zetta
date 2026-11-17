import { createFileRoute } from "@tanstack/react-router";

import { UpdatePage } from "@/features/updates/update-page";

export const Route = createFileRoute("/_auth/update")({
  head: () => ({ meta: [{ title: "Update · zetta" }] }),
  component: UpdatePage,
});
