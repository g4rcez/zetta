import type { PhoneProviderId } from "@zetta/core/phone";

import telnyx from "./logos/telnyx.png";
import twilio from "./logos/twilio.png";

/** The marks come from each vendor's own site (the favicon of telnyx.com, the touch icon of twilio.com). */
const MARKS: Record<PhoneProviderId, string> = { telnyx, twilio };

type ProviderLogoProps = { provider: PhoneProviderId; className?: string };

/** The mark of a phone provider. It sits next to its name, so it is decorative (alt is empty). */
export function ProviderLogo({ provider, className = "size-9" }: ProviderLogoProps) {
  return (
    <img
      src={MARKS[provider]}
      alt=""
      aria-hidden
      draggable={false}
      data-provider-logo={provider}
      className={`${className} shrink-0 rounded-[22%] object-contain`}
    />
  );
}
