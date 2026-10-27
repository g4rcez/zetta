import { Link, createFileRoute } from "@tanstack/react-router";

import { Logo } from "@/components/logo";

export const Route = createFileRoute("/")({
  component: HomeComponent,
});

function HomeComponent() {
  return (
    <div className="mx-auto grid max-w-3xl gap-8 px-6 py-20 text-center">
      <div className="space-y-4">
        <Logo size={96} className="mx-auto" />
        <h1 className="text-4xl font-semibold tracking-tight">Your team of bots, in one place.</h1>
        <p className="mx-auto max-w-xl text-base text-muted-foreground">
          Chat with a chief of staff and specialists, give them memory, schedule routines and build
          workflows. Everything stays private to you.
        </p>
      </div>
      <div className="flex justify-center gap-3">
        <Link
          to="/chat/{-$chatId}"
          className="rounded-md bg-primary px-5 py-2.5 font-medium text-primary-foreground shadow-sm transition-opacity hover:opacity-90"
        >
          Open chat
        </Link>
        <Link
          to="/studio/$tab"
          params={{ tab: "routines" }}
          className="rounded-md border bg-card px-5 py-2.5 font-medium transition-colors hover:bg-muted"
        >
          Studio
        </Link>
      </div>
    </div>
  );
}
