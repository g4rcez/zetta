import { createFileRoute } from "@tanstack/react-router";

import { StudioPage } from "@/features/studio/studio-page";

export const Route = createFileRoute("/_auth/studio")({ component: StudioPage });
