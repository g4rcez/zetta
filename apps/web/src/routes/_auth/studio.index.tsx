import { createFileRoute, redirect } from "@tanstack/react-router";

export const Route = createFileRoute("/_auth/studio/")({
  validateSearch: (search: Record<string, unknown>) => search,
  beforeLoad: ({ search }) => {
    // Attention cards written before Routines had their own page link to /studio?routine=<id>.
    if (typeof search.routine === "string")
      throw redirect({ to: "/routines", search: { routine: search.routine }, replace: true });
    throw redirect({
      to: "/studio/$tab",
      params: { tab: "plugin" in search ? "plugins" : "output-styles" },
      search,
      replace: true,
    });
  },
});
