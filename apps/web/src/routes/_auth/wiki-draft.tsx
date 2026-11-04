import { createFileRoute, redirect } from "@tanstack/react-router";

export const Route = createFileRoute("/_auth/wiki-draft")({
  beforeLoad: ({ location }) => {
    throw redirect({ to: "/memory-draft", search: location.search as never, replace: true });
  },
});
