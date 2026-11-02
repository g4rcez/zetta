import { createFileRoute } from "@tanstack/react-router";

import { SidebarDataProvider } from "@/features/chat/sidebar-data";
import { InstallOnboarding } from "@/features/onboarding/install-onboarding";
import { isOnboardingStep, type OnboardingStep } from "@/features/onboarding/steps";

export const Route = createFileRoute("/onboarding")({
  // The step lives in the URL so a refresh resumes where the person was.
  validateSearch: (search: Record<string, unknown>): { step?: OnboardingStep } =>
    isOnboardingStep(search.step) ? { step: search.step } : {},
  component: OnboardingPage,
});

// Onboarding sits outside the signed-in layout (routes/_auth), so it brings its own sidebar data for the bot steps.
function OnboardingPage() {
  return (
    <SidebarDataProvider>
      <InstallOnboarding />
    </SidebarDataProvider>
  );
}
