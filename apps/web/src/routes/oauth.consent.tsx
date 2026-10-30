import { createFileRoute } from "@tanstack/react-router";

import { OAuthConsent } from "@/features/identity/oauth-consent";

export const Route = createFileRoute("/oauth/consent")({ component: OAuthConsent });
