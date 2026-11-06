import { Alert } from "@g4rcez/components/alert";
import { useEffect, useState } from "react";

import { Button, Radiobox } from "@/components/ui";
import { useTheme } from "@/components/theme-provider";
import { SIDEBAR_SIDE_LABEL, SIDEBAR_SIDES, usePreferences } from "./preferences";
import { Section } from "./section";
import { isHexColor, lowestContrast, MIN_PRIMARY_CONTRAST, readGrounds, type Theme } from "./theme";
import { ThemePicker } from "./theme-picker";
import { TIME_FORMAT_LABEL, TIME_FORMATS } from "./time-format";

export function DisplaySection() {
  const { preferences, set } = usePreferences();
  const { theme: deviceTheme, resolvedTheme } = useTheme();
  const chosen = preferences.theme ?? (deviceTheme as Theme | undefined);
  // The colors on screen now: the theme's grounds, and the main color the theme shows when the person made no choice.
  const [screen, setScreen] = useState<{ grounds: string[]; primary: string }>({
    grounds: [],
    primary: "#000000",
  });
  useEffect(() => {
    // After the frame: the theme and the `.dark` class are applied by effects of the provider and of next-themes.
    const frame = requestAnimationFrame(() => {
      const root = document.documentElement;
      const primary = getComputedStyle(root).getPropertyValue("--primary").trim();
      setScreen({ grounds: readGrounds(root), primary: isHexColor(primary) ? primary : "#000000" });
    });
    return () => cancelAnimationFrame(frame);
  }, [preferences.theme, preferences.primaryColor, resolvedTheme]);
  const { grounds, primary } = screen;
  const ratio =
    preferences.primaryColor && grounds.length
      ? lowestContrast(preferences.primaryColor, grounds)
      : undefined;

  return (
    <Section id="display" title="Display" description="How times and colors look to you.">
      <div className="space-y-6">
        <fieldset className="space-y-3">
          <legend className="text-sm font-medium">Theme</legend>
          <ThemePicker value={chosen} onChange={(theme) => set({ theme })} />
          <p className="text-xs text-muted-foreground">Saved on your account.</p>
        </fieldset>
        <fieldset className="space-y-2">
          <legend className="text-sm font-medium">Main color</legend>
          <div className="flex flex-wrap items-center gap-3">
            <input
              type="color"
              name="primary-color"
              aria-label="Main color"
              value={preferences.primaryColor ?? primary}
              onChange={(e) => set({ primaryColor: e.target.value.toLowerCase() })}
              className="size-8 cursor-pointer rounded-md border border-input bg-transparent p-0.5"
            />
            <span className="font-mono text-xs text-muted-foreground">
              {preferences.primaryColor ?? "Theme color"}
            </span>
            <Button
              type="button"
              variant="ghost"
              size="sm"
              disabled={preferences.primaryColor === null}
              onClick={() => set({ primaryColor: null })}
            >
              Use the theme color
            </Button>
          </div>
          {ratio !== undefined && ratio < MIN_PRIMARY_CONTRAST ? (
            <Alert theme="warn">
              This color has {ratio.toFixed(1)}:1 contrast on this theme. Links, focus rings and
              selected items in it can be hard to read. Pick a color with {MIN_PRIMARY_CONTRAST}:1
              or more.
            </Alert>
          ) : null}
        </fieldset>
        <fieldset className="space-y-2">
          <legend className="text-sm font-medium">Sidebar</legend>
          <div className="flex flex-wrap gap-x-6 gap-y-2">
            {SIDEBAR_SIDES.map((side) => (
              <Radiobox
                key={side}
                name="sidebar-side"
                checked={preferences.sidebarSide === side}
                onChange={() => set({ sidebarSide: side })}
              >
                {SIDEBAR_SIDE_LABEL[side]}
              </Radiobox>
            ))}
          </div>
        </fieldset>
        <fieldset className="space-y-2">
          <legend className="text-sm font-medium">Time format</legend>
          <div className="flex flex-wrap gap-x-6 gap-y-2">
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
          </div>
        </fieldset>
      </div>
    </Section>
  );
}
