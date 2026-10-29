import { createFileRoute } from "@tanstack/react-router";

import { InstallOnboarding } from "@/features/onboarding/install-onboarding";
import { isOnboardingStep, type OnboardingStep } from "@/features/onboarding/steps";

export const Route = createFileRoute("/onboarding")({
  // The step lives in the URL so a refresh resumes where the person was.
  validateSearch: (search: Record<string, unknown>): { step?: OnboardingStep } =>
    isOnboardingStep(search.step) ? { step: search.step } : {},
  component: InstallOnboarding,
});
