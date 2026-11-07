import { Button } from "@/components/ui";
import { Menu, MenuItem } from "@g4rcez/components/menu";
import { MoonIcon, SunIcon } from "@phosphor-icons/react";

import { usePreferences } from "@/features/preferences/preferences";
import {
  THEME_LABEL,
  THEME_MODE,
  THEMES,
  type Mode,
  type Theme,
} from "@/features/preferences/theme";
import { MenuGroup, MenuSeparator } from "@/components/menu-parts";
import { railLabel, railRow, railRowExpanded } from "@/components/rail-row";

const GROUPS: { mode: Mode; title: string }[] = [
  { mode: "system", title: "Follow my device" },
  { mode: "light", title: "Light" },
  { mode: "dark", title: "Dark" },
];

/** A dot in the theme's own colors (themes.css, keyed by `data-theme-preview`). The device theme is half light, half dark. */
function Swatch({ theme }: { theme: Theme }) {
  const dot = (preview: string) => (
    <span data-theme-preview={preview} className="grid size-full place-items-center bg-background">
      <span className="size-1.5 rounded-full bg-primary" />
    </span>
  );
  return (
    <span
      aria-hidden="true"
      className="flex size-5 shrink-0 overflow-hidden rounded-full border border-border"
    >
      {theme === "system" ? (
        <>
          {dot("light")}
          {dot("dark")}
        </>
      ) : (
        dot(theme)
      )}
    </span>
  );
}

export function ModeToggle({
  compact = false,
  inline = false,
  rail,
  drawer = false,
}: {
  compact?: boolean;
  inline?: boolean;
  rail?: "collapsed" | "expanded";
  /** The rail inside the mobile drawer: it has no room at its side, so the menu opens above the row. */
  drawer?: boolean;
}) {
  const { preferences, set } = usePreferences();
  const current = preferences.theme ?? "system";

  const triggerProps = rail
    ? {
        type: "button" as const,
        className: `${railRow} ${rail === "expanded" ? railRowExpanded : ""}`,
      }
    : inline
      ? {
          type: "button" as const,
          className:
            "relative grid size-8 place-items-center rounded-md text-muted-foreground transition-colors hover:bg-accent hover:text-accent-foreground focus-visible:outline-2 focus-visible:outline-ring",
        }
      : null;
  const content = (
    <>
      {rail ? (
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
          <span className="sr-only">Toggle theme</span>
        </>
      )}
    </>
  );

  return (
    <Menu
      asChild
      hover={false}
      // The rail sits at the bottom of the screen: align the menu's bottom edge to the row so it opens upward.
      align={drawer ? "start" : rail ? "end" : compact ? "start" : "end"}
      side={
        drawer
          ? "top"
          : compact || rail
            ? preferences.sidebarSide === "right"
              ? "left"
              : "right"
            : "bottom"
      }
      // Taller than the DS default (320px) so the nine themes show without scrolling, but never taller than the screen.
      floatingClassName="w-56 [--var-menu-surface-max-block-size:min(32rem,calc(100dvh-1rem))]"
      restoreFocus
      title="Change theme"
      label={
        triggerProps ? (
          <button {...triggerProps}>{content}</button>
        ) : (
          <Button
            variant={compact ? "ghost" : "outline"}
            size="icon"
            className={compact ? "size-10 rounded-md text-muted-foreground" : ""}
          >
            {content}
          </Button>
        )
      }
    >
      {GROUPS.map(({ mode, title }, i) => (
        <div key={mode} className="w-full">
          {i > 0 ? <MenuSeparator /> : null}
          <MenuGroup label={title}>
            {THEMES.filter((theme) => THEME_MODE[theme] === mode).map((theme) => (
              <MenuItem
                key={theme}
                title={THEME_LABEL[theme]}
                role="menuitemradio"
                checked={current === theme}
                onClick={() => set({ theme: theme as Theme })}
              >
                <Swatch theme={theme} />
                {THEME_LABEL[theme]}
              </MenuItem>
            ))}
          </MenuGroup>
        </div>
      ))}
    </Menu>
  );
}
