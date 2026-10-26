import { ThemeProvider as NextThemesProvider } from "next-themes";
import * as React from "react";

export function ThemeProvider({
  children,
  ...props
}: React.ComponentProps<typeof NextThemesProvider>) {
  return (
    <NextThemesProvider
      {...props}
      // This SPA has no SSR bootstrap; next-themes applies the theme in its client effect.
      scriptProps={{ ...props.scriptProps, type: "text/plain" }}
    >
      {children}
    </NextThemesProvider>
  );
}

export { useTheme } from "next-themes";
