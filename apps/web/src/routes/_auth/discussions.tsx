import { createFileRoute, redirect } from "@tanstack/react-router";

/** Rooms used to be called discussions. Old links, such as the ones in saved notifications, keep working. */
export const Route = createFileRoute("/_auth/discussions")({
  validateSearch: (search: Record<string, unknown>): { id?: string; view?: "canvas" } => ({
    ...(typeof search.id === "string" && /^[0-9a-f-]{36}$/i.test(search.id)
      ? { id: search.id }
      : {}),
    ...(search.view === "canvas" ? { view: "canvas" as const } : {}),
  }),
  beforeLoad: ({ search }) => {
    throw redirect({ to: "/rooms", search, replace: true });
  },
});
