import { createFileRoute, redirect } from "@tanstack/react-router";

export const Route = createFileRoute("/_auth/wiki/$slug")({
  beforeLoad: ({ params, location }) => {
    throw redirect({
      to: "/memory/$slug",
      params: { slug: params.slug },
      search: location.search as never,
      replace: true,
    });
  },
});
