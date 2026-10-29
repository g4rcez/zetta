import {
  HeadContent,
  Outlet,
  createRootRouteWithContext,
  useRouterState,
} from "@tanstack/react-router";
import { TanStackRouterDevtools } from "@tanstack/react-router-devtools";
import { Toaster } from "@zetta/ui/components/sonner";

import Header, { AppRail, inApp } from "@/components/header";
import { ThemeProvider } from "@/components/theme-provider";

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
        href: "/logo.svg",
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
          <div className="flex h-svh flex-col-reverse md:flex-row">
            <AppRail />
            <main className="min-h-0 min-w-0 flex-1 overflow-hidden">
              <Outlet />
            </main>
          </div>
        ) : (
          <div className="grid h-svh grid-rows-[auto_1fr]">
            <Header />
            <main className="min-h-0 overflow-y-auto">
              <Outlet />
            </main>
          </div>
        )}
        <Toaster richColors />
      </ThemeProvider>
      {import.meta.env.DEV && !import.meta.env.VITE_HIDE_DEVTOOLS ? (
        <TanStackRouterDevtools position="bottom-right" />
      ) : null}
    </Fragment>
  );
}
