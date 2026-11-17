import { createFileRoute } from "@tanstack/react-router";

import { NewRoutinePage } from "@/features/routines/new-routine-page";

export const Route = createFileRoute("/_auth/routines_/new")({
  component: NewRoutinePage,
});
