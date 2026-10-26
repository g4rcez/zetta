import { createFileRoute, redirect } from "@tanstack/react-router";

export const Route = createFileRoute("/_auth/studio/")({
  validateSearch: (search: Record<string, unknown>) => search,
  beforeLoad: ({ search }) => {
    throw redirect({ to: "/studio/$tab", params: { tab: "plugin" in search ? "plugins" : "routines" }, search, replace: true });
  },
});
