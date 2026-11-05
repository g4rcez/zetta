/** Same values as the server (packages/db/src/schema/preferences.ts), which rejects anything else. */
export const THEMES = [
  "system",
  "light",
  "dark",
  "darcula",
  "darcula-light",
  "catppuccin",
  "tokyonight",
  "onedark",
  "nord",
] as const;
export type Theme = (typeof THEMES)[number];

export const THEME_LABEL: Record<Theme, string> = {
  system: "Same as my device",
  light: "Light",
  dark: "Dark",
  darcula: "Darcula",
  "darcula-light": "Darcula Light",
  catppuccin: "Catppuccin",
  tokyonight: "Tokyo Night",
  onedark: "One Dark",
  nord: "Nord",
};

export type Mode = "light" | "dark" | "system";

/** The light or dark base each theme sits on. The values of the six color themes are in `themes.css`, keyed by `data-theme`. */
export const THEME_MODE: Record<Theme, Mode> = {
  system: "system",
  light: "light",
  dark: "dark",
  darcula: "dark",
  "darcula-light": "light",
  catppuccin: "dark",
  tokyonight: "dark",
  onedark: "dark",
  nord: "dark",
};

/** These three need no `data-theme`: they are the `:root` and `.dark` values. */
const BASE_THEMES: readonly Theme[] = ["system", "light", "dark"];

/** Below this ratio a chosen main color is hard to read as text or as a control edge, and the Display section warns. */
export const MIN_PRIMARY_CONTRAST = 5;

const HEX = /^#[0-9a-f]{6}$/i;
export const isHexColor = (value: string) => HEX.test(value);

const luminance = (hex: string) => {
  const [r, g, b] = [1, 3, 5].map((i) => {
    const c = parseInt(hex.slice(i, i + 2), 16) / 255;
    return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * r! + 0.7152 * g! + 0.0722 * b!;
};

/** WCAG contrast ratio of two `#rrggbb` colors: 1 (same) to 21 (black on white). */
export const contrast = (a: string, b: string) => {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return (hi! + 0.05) / (lo! + 0.05);
};

/** The label color of a button filled with `color`: white or the dark ink of the dark theme, whichever reads better. */
export const readableOn = (color: string) =>
  contrast(color, "#ffffff") >= contrast(color, "#09090b") ? "#ffffff" : "#09090b";

/** The lowest ratio of `color` against any of the grounds it is drawn on. */
export const lowestContrast = (color: string, grounds: string[]) =>
  Math.min(...grounds.map((ground) => contrast(color, ground)));

const GROUND_TOKENS = ["--background", "--card", "--sidebar", "--muted", "--accent", "--popover"];

/** The grounds of the theme now on screen, read from the document. */
export function readGrounds(root: HTMLElement): string[] {
  const style = getComputedStyle(root);
  return GROUND_TOKENS.map((token) => style.getPropertyValue(token).trim()).filter(isHexColor);
}

/**
 * Puts the person's theme and main color on the document. A null theme leaves the device's own choice alone.
 * `setMode` is the light/dark/system switch (next-themes), which owns the `.dark` class and the system listener.
 */
export function applyTheme(
  root: HTMLElement,
  theme: Theme | null,
  primaryColor: string | null,
  setMode: (mode: Mode) => void,
) {
  if (theme) setMode(THEME_MODE[theme]);
  if (theme && !BASE_THEMES.includes(theme)) root.dataset.theme = theme;
  else delete root.dataset.theme;

  if (primaryColor && isHexColor(primaryColor)) {
    root.style.setProperty("--primary", primaryColor);
    root.style.setProperty("--primary-foreground", readableOn(primaryColor));
  } else {
    root.style.removeProperty("--primary");
    root.style.removeProperty("--primary-foreground");
  }
}
