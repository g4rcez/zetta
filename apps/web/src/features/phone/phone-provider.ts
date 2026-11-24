import type { PhoneProviderId } from "@zetta/core/phone";

/** The provider as a person reads it. */
export const PROVIDER_NAME: Record<PhoneProviderId, string> = {
  telnyx: "Telnyx",
  twilio: "Twilio",
};
