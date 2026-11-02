export const ONBOARDING_STEPS = [
  "key",
  "network",
  "account",
  "identity",
  "engine",
  "instructions",
  "plugins",
] as const;
export type OnboardingStep = (typeof ONBOARDING_STEPS)[number];
export const isOnboardingStep = (value: unknown): value is OnboardingStep =>
  typeof value === "string" && (ONBOARDING_STEPS as readonly string[]).includes(value);

/** Steps before the account exists. They need the setup key, which survives a refresh only in this tab's sessionStorage. */
export const PRE_ACCOUNT_STEPS: readonly OnboardingStep[] = ["key", "network", "account"];
