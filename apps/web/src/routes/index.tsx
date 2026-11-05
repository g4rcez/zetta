import { Link, createFileRoute, redirect } from "@tanstack/react-router";

import { Logo } from "@/components/logo";
import { authClient } from "@/lib/auth-client";

export const Route = createFileRoute("/")({
  // Signed-in people land on the dashboard; everyone else sees the hero.
  beforeLoad: async () => {
    const session = await authClient.getSession().catch(() => undefined);
    if (session?.data) throw redirect({ to: "/dashboard" });
  },
  component: HomeComponent,
});

function HomeComponent() {
  return (
    <div className="mx-auto grid max-w-3xl gap-8 px-6 py-20 text-center">
      <div className="space-y-4">
        <Logo size={96} className="mx-auto" />
        <h1 className="text-4xl font-semibold tracking-tight">Your team of bots, in one place.</h1>
        <p className="mx-auto max-w-xl text-base text-muted-foreground">
          Chat with a chief of staff and specialists, give them a shared memory, schedule routines
          and build workflows. Everything stays private to you.
        </p>
      </div>
      <div className="flex justify-center gap-3">
        <Link
          to="/chat/{-$chatId}"
          className="rounded-md bg-primary px-5 py-2.5 font-medium text-primary-foreground shadow-sm transition-[opacity,transform] ease-[cubic-bezier(0.23,1,0.32,1)] hover:opacity-90 active:scale-[0.98] motion-reduce:active:scale-[0.99]"
        >
          Open chat
        </Link>
        <Link
          to="/routines"
          className="rounded-md border bg-card px-5 py-2.5 font-medium transition-[color,background-color,transform] ease-[cubic-bezier(0.23,1,0.32,1)] hover:bg-muted active:scale-[0.98] motion-reduce:active:scale-[0.99]"
        >
          Routines
        </Link>
      </div>
    </div>
  );
}
