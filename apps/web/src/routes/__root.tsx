import {
  HeadContent,
  Outlet,
  createRootRouteWithContext,
  retainSearchParams,
} from "@tanstack/react-router";
import type { QueryClient } from "@tanstack/react-query";
import { TanStackRouterDevtools } from "@tanstack/react-router-devtools";

import Header from "@/components/header";
import { KeyboardHints } from "@/components/keyboard-hints";
import { useRouteChrome } from "@/components/shell-routes";
import { ThemeProvider } from "@/components/theme-provider";
import { ModalConfirmProvider } from "@/components/ui";
import { PreferencesProvider } from "@/features/preferences/preferences";
import { NotificationsProvider } from "@/lib/notify";
import { workspaceOf, workspaceScope } from "@/lib/workspace-scope";

import logoUrl from "../assets/logo.svg?url";
import "../index.css";
import { Fragment, useEffect } from "react";

export interface RouterAppContext {
  queryClient: QueryClient;
}

/** The workspace this tab works in, by its slug (lib/workspace-scope.ts). Absent: the person's own. */
export type WorkspaceSearch = { w?: string };

export const Route = createRootRouteWithContext<RouterAppContext>()({
  // Every page keeps it: a link inside the app stays in the workspace of the tab it was followed in.
  validateSearch: (search: Record<string, unknown>): WorkspaceSearch => {
    const w = workspaceOf(new URLSearchParams(typeof search.w === "string" ? { w: search.w } : {}));
    return w ? { w } : {};
  },
  search: { middlewares: [retainSearchParams(["w"])] },
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
  const { w } = Route.useSearch();
  const { queryClient } = Route.useRouteContext();
  // Another workspace: every call says so from now on, and nothing loaded for the one before is shown in it.
  useEffect(() => {
    if (workspaceScope.set(w)) void queryClient.resetQueries();
  }, [w, queryClient]);
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
