import { ActionHint } from "@/components/action-hint";
import { Button, Menu, MenuGroup, MenuItem, MenuSeparator } from "@/components/ui";
import { MoonIcon, SunIcon } from "@phosphor-icons/react";
import { Fragment } from "react";

import { usePreferences } from "@/features/preferences/preferences";
import {
  THEME_LABEL,
  THEME_MODE,
  THEMES,
  type Mode,
  type Theme,
} from "@/features/preferences/theme";
import { railLabel, railRow, railRowExpanded } from "@/components/rail-row";

const GROUPS: { mode: Mode; title: string }[] = [
  { mode: "system", title: "Follow my device" },
  { mode: "light", title: "Light" },
  { mode: "dark", title: "Dark" },
];

function SwatchDot({ preview }: { preview: string }) {
  return (
    <span data-theme-preview={preview} className="grid size-full place-items-center bg-background">
      <span className="size-1.5 rounded-full bg-primary" />
    </span>
  );
}

/** A dot in the theme's own colors (themes.css, keyed by `data-theme-preview`). The device theme is half light, half dark. */
function Swatch({ theme }: { theme: Theme }) {
  return (
    <span
      aria-hidden="true"
      className="flex size-5 shrink-0 overflow-hidden rounded-full border border-border"
    >
      {theme === "system" ? (
        <>
          <SwatchDot preview="light" />
          <SwatchDot preview="dark" />
        </>
      ) : (
        <SwatchDot preview={theme} />
      )}
    </span>
  );
}

export function ModeToggle({
  compact = false,
  inline = false,
  rail,
}: {
  compact?: boolean;
  inline?: boolean;
  rail?: "collapsed" | "expanded";
}) {
  const { preferences, set } = usePreferences();
  const current = preferences.theme ?? "system";

  const icons = rail ? (
    <>
      <span className="relative grid size-4 shrink-0 place-items-center">
        <SunIcon className="size-4 scale-100 rotate-0 transition-all dark:scale-0 dark:-rotate-90" />
        <MoonIcon className="absolute size-4 scale-0 rotate-90 transition-all dark:scale-100 dark:rotate-0" />
      </span>
      {rail === "expanded" ? (
        <>
          <span className={railLabel}>Theme</span>
          <span className="max-w-24 truncate text-xs font-normal text-muted-foreground">
            {THEME_LABEL[current]}
          </span>
        </>
      ) : null}
      <span className="sr-only">{rail === "expanded" ? ", change theme" : "Change theme"}</span>
    </>
  ) : (
    <>
      <SunIcon className="size-4 scale-100 rotate-0 transition-all dark:scale-0 dark:-rotate-90" />
      <MoonIcon className="absolute size-4 scale-0 rotate-90 transition-all dark:scale-100 dark:rotate-0" />
    </>
  );
  const trigger = rail ? (
    <button type="button" className={`${railRow} ${rail === "expanded" ? railRowExpanded : ""}`}>
      {icons}
    </button>
  ) : inline ? (
    <ActionHint label="Toggle theme" side="bottom">
      <button
        type="button"
        aria-label="Toggle theme"
        className="relative grid size-8 place-items-center rounded-md text-muted-foreground transition-colors hover:bg-accent hover:text-accent-foreground focus-visible:outline-2 focus-visible:outline-ring"
      >
        {icons}
      </button>
    </ActionHint>
  ) : (
    <ActionHint label="Toggle theme" side={compact ? "right" : "bottom"}>
      <Button
        variant={compact ? "ghost" : "outline"}
        size="icon"
        aria-label="Toggle theme"
        className={compact ? "size-10 rounded-md text-muted-foreground" : ""}
      >
        {icons}
      </Button>
    </ActionHint>
  );

  return (
    // The menu opens below its trigger and flips above it where the rail sits at the bottom of the screen.
    <Menu
      asChild
      hover={false}
      restoreFocus
      title=""
      floatingClassName="w-56 [--var-menu-surface-max-block-size:min(32rem,90dvh)]"
      label={trigger}
    >
      {GROUPS.map(({ mode, title }, i) => (
        <Fragment key={mode}>
          {i > 0 ? <MenuSeparator /> : null}
          <MenuGroup label={title}>
            {THEMES.filter((theme) => THEME_MODE[theme] === mode).map((theme) => (
              <MenuItem
                key={theme}
                title={THEME_LABEL[theme]}
                role="menuitemradio"
                checked={theme === current}
                onClick={() => set({ theme })}
              >
                <Swatch theme={theme} />
                {THEME_LABEL[theme]}
              </MenuItem>
            ))}
          </MenuGroup>
        </Fragment>
      ))}
    </Menu>
  );
}
