import { Button } from "@/components/ui";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuLabel,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@zetta/ui/components/dropdown-menu";
import { MoonIcon, SunIcon } from "@phosphor-icons/react";

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
}: {
  compact?: boolean;
  inline?: boolean;
  rail?: "collapsed" | "expanded";
}) {
  const { preferences, set } = usePreferences();
  const current = preferences.theme ?? "system";

  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        render={
          rail ? (
            <button
              type="button"
              className={`${railRow} ${rail === "expanded" ? railRowExpanded : ""}`}
            />
          ) : inline ? (
            <button
              type="button"
              className="relative grid size-8 place-items-center rounded-md text-muted-foreground transition-colors hover:bg-accent hover:text-accent-foreground focus-visible:outline-2 focus-visible:outline-ring"
            />
          ) : (
            <Button
              variant={compact ? "ghost" : "outline"}
              size="icon"
              className={compact ? "size-10 rounded-md text-muted-foreground" : ""}
            />
          )
        }
      >
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
            <span className="sr-only">
              {rail === "expanded" ? ", change theme" : "Change theme"}
            </span>
          </>
        ) : (
          <>
            <SunIcon className="size-4 scale-100 rotate-0 transition-all dark:scale-0 dark:-rotate-90" />
            <MoonIcon className="absolute size-4 scale-0 rotate-90 transition-all dark:scale-100 dark:rotate-0" />
            <span className="sr-only">Toggle theme</span>
          </>
        )}
      </DropdownMenuTrigger>
      <DropdownMenuContent
        // The rail sits at the bottom of the screen: align the menu's bottom edge to the row so it opens upward.
        align={rail ? "end" : compact ? "start" : "end"}
        side={compact || rail ? (preferences.sidebarSide === "right" ? "left" : "right") : "bottom"}
        className="max-h-[min(32rem,var(--available-height))] w-56 bg-card"
      >
        <DropdownMenuRadioGroup
          value={current}
          onValueChange={(theme) => set({ theme: theme as Theme })}
        >
          {GROUPS.map(({ mode, title }, i) => (
            <DropdownMenuGroup key={mode}>
              {i > 0 ? <DropdownMenuSeparator /> : null}
              <DropdownMenuLabel>{title}</DropdownMenuLabel>
              {THEMES.filter((theme) => THEME_MODE[theme] === mode).map((theme) => (
                <DropdownMenuRadioItem key={theme} value={theme}>
                  <Swatch theme={theme} />
                  {THEME_LABEL[theme]}
                </DropdownMenuRadioItem>
              ))}
            </DropdownMenuGroup>
          ))}
        </DropdownMenuRadioGroup>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
