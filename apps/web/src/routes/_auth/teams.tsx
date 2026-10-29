import { createFileRoute } from "@tanstack/react-router";

import { TeamsCanvas } from "@/features/teams/teams-canvas";

export const Route = createFileRoute("/_auth/teams")({ component: TeamsCanvas });
