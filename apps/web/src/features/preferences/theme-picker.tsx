import { CheckCircleIcon } from "@phosphor-icons/react";

import { THEME_LABEL, THEME_MODE, THEMES, type Mode, type Theme } from "./theme";

const GROUPS: { mode: Mode; title: string }[] = [
  { mode: "system", title: "Follow my device" },
  { mode: "light", title: "Light" },
  { mode: "dark", title: "Dark" },
];

// Static class names, so Tailwind sees them. The colors come from the sample's own theme block (themes.css).
const DOTS = [
  "bg-primary",
  "bg-success",
  "bg-info",
  "bg-attention",
  "bg-destructive",
  "bg-muted-foreground",
] as const;

/** A small sample of one theme: text, a code chip, a main-color button, and its status colors. */
function Sample({ preview }: { preview: "light" | "dark" | Exclude<Theme, "system"> }) {
  return (
    <span
      data-theme-preview={preview}
      className="block rounded-lg border border-border bg-background p-2.5 text-foreground"
    >
      <span className="flex items-center justify-between">
        <span className="text-xl leading-none">Aa</span>
        <span className="rounded bg-accent px-1.5 font-mono text-sm leading-5">~/</span>
        <span className="h-5 w-2.5 rounded-sm bg-primary" />
      </span>
      <span className="mt-2.5 flex">
        {DOTS.map((dot) => (
          <span
            key={dot}
            className={`${dot} -ml-1 size-3.5 rounded-full border border-background first:ml-0`}
          />
        ))}
      </span>
    </span>
  );
}

/** The device theme is half light, half dark: it is whichever one the device asks for. */
function SystemSample() {
  return (
    <span className="relative block">
      <Sample preview="light" />
      <span className="absolute inset-0 [clip-path:inset(0_0_0_50%)]">
        <Sample preview="dark" />
      </span>
    </span>
  );
}

/** One card per theme, drawn in that theme's own colors. A native radio under each card keeps the arrow keys and the labels. */
export function ThemePicker({
  value,
  onChange,
}: {
  value: Theme | undefined;
  onChange: (theme: Theme) => void;
}) {
  return (
    <div className="space-y-4">
      {GROUPS.map(({ mode, title }) => (
        <div key={mode} className="space-y-2">
          <p className="text-xs font-medium text-muted-foreground">{title}</p>
          <div className="grid grid-cols-[repeat(auto-fill,minmax(9rem,1fr))] gap-3">
            {THEMES.filter((theme) => THEME_MODE[theme] === mode).map((theme) => {
              const checked = value === theme;
              return (
                <label key={theme} className="flex cursor-pointer flex-col gap-1.5">
                  <input
                    type="radio"
                    name="theme"
                    className="peer sr-only"
                    checked={checked}
                    onChange={() => onChange(theme)}
                  />
                  <span
                    className={`relative block rounded-xl border-2 p-0.5 transition-colors peer-focus-visible:outline-2 peer-focus-visible:outline-offset-2 peer-focus-visible:outline-ring ${checked ? "border-primary" : "border-transparent hover:border-input"}`}
                  >
                    <span aria-hidden className="block">
                      {theme === "system" ? <SystemSample /> : <Sample preview={theme} />}
                    </span>
                    {checked ? (
                      <CheckCircleIcon
                        aria-hidden
                        weight="fill"
                        className="absolute -top-2 -right-2 size-5 rounded-full bg-background text-primary"
                      />
                    ) : null}
                  </span>
                  <span
                    className={`text-center text-xs ${checked ? "font-medium text-foreground" : "text-muted-foreground"}`}
                  >
                    {THEME_LABEL[theme]}
                  </span>
                </label>
              );
            })}
          </div>
        </div>
      ))}
    </div>
  );
}
