import { HeadContent, Outlet, createRootRouteWithContext } from "@tanstack/react-router";
import type { QueryClient } from "@tanstack/react-query";
import { TanStackRouterDevtools } from "@tanstack/react-router-devtools";

import Header from "@/components/header";
import { KeyboardHints } from "@/components/keyboard-hints";
import { useRouteChrome } from "@/components/shell-routes";
import { ThemeProvider } from "@/components/theme-provider";
import { ModalConfirmProvider } from "@/components/ui";
import { PreferencesProvider } from "@/features/preferences/preferences";
import { NotificationsProvider } from "@/lib/notify";

import logoUrl from "../assets/logo.svg?url";
import "../index.css";
import { Fragment } from "react";

export interface RouterAppContext {
  queryClient: QueryClient;
}

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

function RootComponent() {
  const { signedIn, shell } = useRouteChrome();
  return (
    <Fragment>
      <HeadContent />
      <ThemeProvider
        attribute="class"
        defaultTheme="dark"
        disableTransitionOnChange
        storageKey="vite-ui-theme"
      >
        <ModalConfirmProvider>
          <NotificationsProvider>
            {signedIn && !shell ? (
              <main className="h-svh overflow-hidden">
                <Outlet />
              </main>
            ) : signedIn ? (
              // The signed-in layout (routes/_auth) draws the app shell around these pages.
              <PreferencesProvider>
                <Outlet />
              </PreferencesProvider>
            ) : (
              // The public header holds the account menu, which reads the person's preferences; signed out, the provider keeps the defaults.
              <PreferencesProvider>
                <div className="grid h-svh grid-rows-[auto_1fr]">
                  <Header />
                  <main className="min-h-0 overflow-y-auto">
                    <Outlet />
                  </main>
                </div>
              </PreferencesProvider>
            )}
            <KeyboardHints />
          </NotificationsProvider>
        </ModalConfirmProvider>
      </ThemeProvider>
      {import.meta.env.DEV && !import.meta.env.VITE_HIDE_DEVTOOLS ? (
        <TanStackRouterDevtools position="bottom-right" />
      ) : null}
    </Fragment>
  );
}
