import {
  HeadContent,
  Outlet,
  createRootRouteWithContext,
  useRouterState,
} from "@tanstack/react-router";
import { TanStackRouterDevtools } from "@tanstack/react-router-devtools";
import { Toaster } from "@zetta/ui/components/sonner";

import Header, { inApp } from "@/components/header";
import { KeyboardHints } from "@/components/keyboard-hints";
import { ThemeProvider } from "@/components/theme-provider";
import { PreferencesProvider } from "@/features/preferences/preferences";

import logoUrl from "../assets/logo.svg?url";
import "../index.css";
import { Fragment } from "react";

export interface RouterAppContext {}

export const Route = createRootRouteWithContext<RouterAppContext>()({
  component: RootComponent,
  head: () => ({
    meta: [
      {
        title: "zetta",
      },
      {
        name: "description",
        content: "zetta is a web application",
      },
    ],
    links: [
      {
        rel: "icon",
        href: "/favicon.ico",
        sizes: "48x48",
      },
      {
        rel: "icon",
        type: "image/svg+xml",
        href: logoUrl,
      },
      {
        rel: "apple-touch-icon",
        href: "/apple-touch-icon.png",
      },
    ],
  }),
});

const REGEX_COMPUTER = /^\/computer\/[^/]+$/;

function RootComponent() {
  const pathname = useRouterState({ select: (s) => s.location.pathname });
  const app = inApp(pathname);
  return (
    <Fragment>
      <HeadContent />
      <ThemeProvider
        attribute="class"
        defaultTheme="dark"
        disableTransitionOnChange
        storageKey="vite-ui-theme"
      >
        {REGEX_COMPUTER.test(pathname) ? (
          <main className="h-svh overflow-hidden">
            <Outlet />
          </main>
        ) : app ? (
          // The signed-in layout (routes/_auth) draws the app shell around these pages.
          <PreferencesProvider>
            <Outlet />
          </PreferencesProvider>
        ) : (
          <div className="grid h-svh grid-rows-[auto_1fr]">
            <Header />
            <main className="min-h-0 overflow-y-auto">
              <Outlet />
            </main>
          </div>
        )}
        <Toaster richColors />
        <KeyboardHints />
      </ThemeProvider>
      {import.meta.env.DEV && !import.meta.env.VITE_HIDE_DEVTOOLS ? (
        <TanStackRouterDevtools position="bottom-right" />
      ) : null}
    </Fragment>
  );
}
