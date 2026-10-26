import { createFileRoute } from "@tanstack/react-router";

import { LoginJourney } from "@/features/identity/login-journey";

export const Route = createFileRoute("/login")({ component: LoginJourney });
