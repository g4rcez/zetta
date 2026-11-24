import { XIcon } from "@phosphor-icons/react";
import type { PhoneProviderId } from "@zetta/core/phone";

import { ActionHint } from "@/components/action-hint";
import { Button, Select } from "@/components/ui";
import { PROVIDER_NAME } from "./phone-provider";
import {
  COUNTRY_CHOICES,
  MODE_CHOICES,
  countryName,
  type RequestMode,
} from "./phone-settings-model";
import type { PhoneSettingsState } from "./use-phone-settings";

type SegmentsProps = { value: RequestMode; onChange: (v: RequestMode) => void };
/** One choice out of three, always in view. */
function ModeSegments({ value, onChange }: SegmentsProps) {
  return (
    <div
      role="radiogroup"
      aria-label="Who can ask for a number"
      className="grid gap-1 rounded-lg border bg-muted/40 p-1 sm:grid-cols-3"
    >
      {MODE_CHOICES.map((c) => (
        <button
          key={c.value}
          type="button"
          role="radio"
          aria-checked={value === c.value}
          onClick={() => onChange(c.value)}
          className={`rounded-md px-3 py-2 text-left text-sm transition-colors ${value === c.value ? "bg-primary/10 font-medium text-foreground ring-1 ring-primary" : "text-muted-foreground hover:bg-background/60"}`}
        >
          <span className="block">{c.label}</span>
          <span className="block text-xs font-normal text-muted-foreground">{c.hint}</span>
        </button>
      ))}
    </div>
  );
}

type CountryChipProps = { code: string; onRemove: (code: string) => void };
function CountryChip({ code, onRemove }: CountryChipProps) {
  return (
    <li className="inline-flex items-center gap-1 rounded-full border bg-card py-0.5 pr-0.5 pl-2.5 text-sm">
      <span>
        {countryName(code)} <span className="text-xs text-muted-foreground">{code}</span>
      </span>
      <ActionHint label={`Remove ${countryName(code)}`}>
        <button
          type="button"
          aria-label={`Remove ${countryName(code)}`}
          onClick={() => onRemove(code)}
          className="grid size-6 place-items-center rounded-full text-muted-foreground hover:bg-muted"
        >
          <XIcon aria-hidden className="size-3.5" />
        </button>
      </ActionHint>
    </li>
  );
}

type PhoneAccessSettingsProps = { settings: PhoneSettingsState; ready: readonly PhoneProviderId[] };

/** Who can ask for a number, in which countries, and which provider is the default when both are connected. */
export function PhoneAccessSettings({ settings, ready }: PhoneAccessSettingsProps) {
  const { view, notes, busy } = settings;
  const note = notes.access;
  const picks = COUNTRY_CHOICES.filter((c) => !view.countries.includes(c));
  return (
    <section aria-label="How people get numbers" className="space-y-4">
      <div className="space-y-1">
        <h3 className="text-base font-semibold">How people get numbers</h3>
        <p className="text-sm text-pretty text-muted-foreground">
          Choose who can ask, and where numbers may be bought.
        </p>
      </div>
      <ModeSegments value={view.mode} onChange={(mode) => settings.edit({ mode })} />
      <div className="space-y-2">
        <p className="text-sm font-medium">Countries</p>
        {view.countries.length === 0 ? (
          <p className="text-sm text-muted-foreground">
            No country yet. Add one so numbers can be bought.
          </p>
        ) : (
          <ul aria-label="Countries" className="flex flex-wrap gap-2">
            {view.countries.map((code) => (
              <CountryChip
                key={code}
                code={code}
                onRemove={(c) =>
                  settings.edit({ countries: view.countries.filter((x) => x !== c) })
                }
              />
            ))}
          </ul>
        )}
        <div className="max-w-xs">
          <Select
            title="Add a country"
            name="phoneCountryPicker"
            required={false}
            placeholder="Choose a country"
            value=""
            options={[
              { value: "", label: "Choose a country" },
              ...picks.map((c) => ({ value: c, label: `${countryName(c)} (${c})` })),
            ]}
            onChange={(e) => {
              const code = e.target.value;
              if (code) settings.edit({ countries: [...view.countries, code] });
            }}
          />
        </div>
      </div>
      {ready.length > 1 && (
        <div className="max-w-xs space-y-1">
          <Select
            title="Default provider"
            name="phoneDefaultProvider"
            required={false}
            value={view.defaultProvider}
            options={ready.map((id) => ({ value: id, label: PROVIDER_NAME[id] }))}
            onChange={(e) => settings.edit({ defaultProvider: e.target.value as PhoneProviderId })}
          />
          <p className="text-xs text-pretty text-muted-foreground">
            Used when a number is asked for without a provider.
          </p>
        </div>
      )}
      <div className="flex flex-wrap items-center gap-3">
        <Button
          type="button"
          size="sm"
          disabled={busy !== "idle" || settings.accessDirty === "clean"}
          onClick={() => void settings.saveAccess()}
        >
          {busy === "save:access" ? "Saving…" : "Save"}
        </Button>
        {note && (
          <p
            role={note.kind === "error" ? "alert" : "status"}
            className={`text-sm ${note.kind === "error" ? "text-destructive" : "text-muted-foreground"}`}
          >
            {note.text}
          </p>
        )}
      </div>
    </section>
  );
}
