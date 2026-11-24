import { CaretRightIcon } from "@phosphor-icons/react";
import { useQuery } from "@tanstack/react-query";
import type { PhoneProviderId } from "@zetta/core/phone";

import { errorMessage } from "../chat/chat-client";
import { installationQueries } from "../onboarding/installation-api";
import { PhoneAccessSettings } from "./phone-access-settings";
import { PhoneAdvanced } from "./phone-advanced";
import { isOn } from "./phone-settings-model";
import { ProviderCard } from "./provider-card";
import { phoneSetupApi, usePhoneSettings, type PhoneSetupApi } from "./use-phone-settings";
import type { Installation } from "../onboarding/installation-api";

const PROVIDERS: readonly PhoneProviderId[] = ["telnyx", "twilio"];

function AboutCosts() {
  return (
    <details className="group text-sm">
      <summary className="inline-flex cursor-pointer list-none items-center gap-1 rounded text-muted-foreground hover:text-foreground focus-visible:outline-2 focus-visible:outline-offset-2 [&::-webkit-details-marker]:hidden">
        <CaretRightIcon
          aria-hidden
          weight="bold"
          className="size-3 transition-transform group-open:rotate-90 motion-reduce:transition-none"
        />
        About costs
      </summary>
      <ul className="mt-2 list-disc space-y-1 pl-5 text-xs text-pretty text-muted-foreground">
        <li>
          You pay each provider on your own account. Prices differ, and a number costs more or less
          by country.
        </li>
        <li>
          The number is held in the name of whoever holds the account, so that person answers to the
          regulator for it.
        </li>
        <li>
          Brazilian numbers need papers: at Telnyx an ID, a CPF and a proof of address, and a review
          of up to 3 business days. Twilio sells them only to companies.
        </li>
        <li>
          Calls are not recorded. Every call opens by saying an automated assistant is speaking for
          its owner.
        </li>
      </ul>
    </details>
  );
}

type SetupProps = { saved: Installation; api: PhoneSetupApi };

function PhoneSetupBody({ saved, api }: SetupProps) {
  const settings = usePhoneSettings(saved, api);
  const ready = PROVIDERS.filter((id) => isOn(saved, id));
  return (
    <div className="space-y-6">
      <AboutCosts />
      <div className="grid gap-4 md:grid-cols-2">
        {PROVIDERS.map((id) => (
          <ProviderCard key={id} provider={id} saved={saved} settings={settings} />
        ))}
      </div>
      {ready.length === 0 ? (
        <p className="text-sm text-pretty text-muted-foreground">
          Connect a provider to choose who can ask for numbers.
        </p>
      ) : (
        <>
          <PhoneAccessSettings settings={settings} ready={ready} />
          <PhoneAdvanced settings={settings} />
        </>
      )}
    </div>
  );
}

type PhoneSetupProps = { api?: PhoneSetupApi };

/** The whole phone setup of the installation, for administrators: the two provider cards, who can ask, and the limits. */
export function PhoneSetup({ api = phoneSetupApi }: PhoneSetupProps) {
  const saved = useQuery(installationQueries.get());
  if (saved.isError)
    return (
      <p role="alert" className="text-sm text-destructive">
        {errorMessage(saved.error)}
      </p>
    );
  if (!saved.data)
    return (
      <p role="status" className="text-sm text-muted-foreground">
        Loading…
      </p>
    );
  return <PhoneSetupBody saved={saved.data} api={api} />;
}

/** Where the setup lives, for a place that cannot hold it (the Chief's installation card in chat). Plain text: the card can be shown where no router is. */
export function PhoneSetupLink() {
  return (
    <section className="space-y-1" aria-label="Phone numbers">
      <h3 className="text-sm font-medium">Phone numbers</h3>
      <p className="text-xs text-pretty text-muted-foreground">
        Telnyx and Twilio are set up in Studio, on the Phone numbers page. Only administrators can
        change them.
      </p>
    </section>
  );
}
