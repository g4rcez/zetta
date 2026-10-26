import { createFileRoute } from "@tanstack/react-router";

import { InvitationManager } from "@/features/identity/invitation-manager";

export const Route = createFileRoute("/_auth/dashboard")({ component: RouteComponent });

function RouteComponent() {
  const { session, identity } = Route.useRouteContext();
  return (
    <div className="h-full overflow-y-auto">
      <div className="mx-auto w-full max-w-4xl space-y-6 p-4 md:p-8">
        <div className="space-y-1">
          <h1>Dashboard</h1>
          <p className="text-muted-foreground">Welcome, {session.data?.user.name}.</p>
        </div>
        {identity.isAdmin && <InvitationManager />}
      </div>
    </div>
  );
}
