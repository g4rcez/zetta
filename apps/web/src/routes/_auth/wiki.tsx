import { Outlet, createFileRoute, redirect } from "@tanstack/react-router";

// The wiki is now Memory. Saved links, attention items and old chat messages still point here.
export const Route = createFileRoute("/_auth/wiki")({
  beforeLoad: ({ location }) => {
    if (location.pathname.replace(/\/$/, "") === "/wiki")
      throw redirect({ to: "/memory", search: location.search as never, replace: true });
  },
  component: Outlet,
});
