import { AdvancedSection } from "@/components/advanced-section";
import { Button, Input } from "@/components/ui";
import type { PhoneField } from "./phone-settings-model";
import type { PhoneSettingsState } from "./use-phone-settings";

type PhoneAdvancedProps = { settings: PhoneSettingsState };

/** The four limits, folded away: most people never change them. */
export function PhoneAdvanced({ settings }: PhoneAdvancedProps) {
  const { view, notes, busy } = settings;
  const note = notes.limits;
  const errorOf = (field: PhoneField) =>
    note?.kind === "error" && note.field === field ? note.text : undefined;
  return (
    <AdvancedSection title="Advanced: limits" defaultOpen={false}>
      <form
        aria-label="Limits"
        className="space-y-3"
        onSubmit={(e) => {
          e.preventDefault();
          void settings.saveLimits();
        }}
      >
        <div className="grid gap-3 sm:grid-cols-2">
          <Input
            title="Most numbers on this server"
            name="phoneMaxNumbers"
            inputMode="numeric"
            value={view.maxNumbers}
            error={errorOf("maxNumbers")}
            onChange={(e) => settings.edit({ maxNumbers: e.target.value })}
          />
          <Input
            title="Longest call, in minutes"
            name="phoneMaxCallMinutes"
            inputMode="numeric"
            value={view.maxCallMinutes}
            error={errorOf("maxCallMinutes")}
            onChange={(e) => settings.edit({ maxCallMinutes: e.target.value })}
          />
          <Input
            title="Minutes a day, per bot"
            name="phoneDailyMinutesPerBot"
            inputMode="numeric"
            value={view.dailyMinutes}
            error={errorOf("dailyMinutes")}
            onChange={(e) => settings.edit({ dailyMinutes: e.target.value })}
          />
          <Input
            title="Calls a day, per bot"
            name="phoneDailyCallsPerBot"
            inputMode="numeric"
            value={view.dailyCalls}
            error={errorOf("dailyCalls")}
            onChange={(e) => settings.edit({ dailyCalls: e.target.value })}
          />
        </div>
        <div className="flex flex-wrap items-center gap-3">
          <Button
            type="submit"
            size="sm"
            disabled={busy !== "idle" || settings.limitsDirty === "clean"}
          >
            {busy === "save:limits" ? "Saving…" : "Save limits"}
          </Button>
          {note && note.field === "form" && (
            <p
              role={note.kind === "error" ? "alert" : "status"}
              className={`text-sm ${note.kind === "error" ? "text-destructive" : "text-muted-foreground"}`}
            >
              {note.text}
            </p>
          )}
        </div>
      </form>
    </AdvancedSection>
  );
}
