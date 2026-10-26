import { createFileRoute } from "@tanstack/react-router";

import { BotOnboarding } from "@/features/bots/bot-onboarding";

export const Route = createFileRoute("/_auth/bots/new")({ component: BotOnboarding });
