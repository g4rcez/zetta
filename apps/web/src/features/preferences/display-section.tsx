import { Radiobox } from "@/components/ui";
import { useTheme } from "@/components/theme-provider";
import { usePreferences } from "./preferences";
import { Section } from "./section";
import { TIME_FORMAT_LABEL, TIME_FORMATS } from "./time-format";

const THEMES = [
  ["light", "Light"],
  ["dark", "Dark"],
  ["system", "Same as my device"],
] as const;

export function DisplaySection() {
  const { preferences, set } = usePreferences();
  const { theme, setTheme } = useTheme();
  return (
    <Section id="display" title="Display" description="How times and colors look to you.">
      <div className="grid gap-4 sm:grid-cols-2">
        <fieldset className="space-y-2">
          <legend className="text-sm font-medium">Time format</legend>
          {TIME_FORMATS.map((f) => (
            <Radiobox
              key={f}
              name="time-format"
              checked={preferences.timeFormat === f}
              onChange={() => set({ timeFormat: f })}
            >
              {TIME_FORMAT_LABEL[f]}
            </Radiobox>
          ))}
        </fieldset>
        <fieldset className="space-y-2">
          <legend className="text-sm font-medium">Theme</legend>
          {THEMES.map(([value, label]) => (
            <Radiobox
              key={value}
              name="theme"
              checked={theme === value}
              onChange={() => setTheme(value)}
            >
              {label}
            </Radiobox>
          ))}
          <p className="text-xs text-muted-foreground">Saved on this device.</p>
        </fieldset>
      </div>
    </Section>
  );
}
