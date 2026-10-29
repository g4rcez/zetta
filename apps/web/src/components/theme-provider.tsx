import { ThemeProvider as NextThemesProvider } from "next-themes";
import * as React from "react";

export function ThemeProvider({
  children,
  ...props
}: React.ComponentProps<typeof NextThemesProvider>) {
  return (
    <NextThemesProvider {...props} scriptProps={{ ...props.scriptProps, type: "text/plain" }}>
      {children}
    </NextThemesProvider>
  );
}

export { useTheme } from "next-themes";
