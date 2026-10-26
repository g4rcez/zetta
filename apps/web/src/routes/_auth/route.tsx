import { Link, Outlet, createFileRoute, redirect, useRouter } from "@tanstack/react-router";
import { Button } from "@/components/ui";

import { authClient } from "@/lib/auth-client";
import { getIdentityError, identityClient } from "@/lib/identity-client";

export const Route = createFileRoute("/_auth")({
  component: AuthLayout,
  pendingComponent: () => (
    <p className="p-6" role="status">
      Checking your membership…
    </p>
  ),
  errorComponent: AccessError,
  beforeLoad: async () => {
    const identity = await identityClient.status();
    if (identity.state !== "active") throw redirect({ to: "/login" });
    const session = await authClient.getSession();
    if (!session.data) throw redirect({ to: "/login" });
    return { session, identity };
  },
});

function AccessError({ error }: { error: unknown }) {
  const router = useRouter();
  return (
    <section className="mx-auto mt-10 w-full max-w-md space-y-4 p-6">
      <h1 className="text-2xl font-bold">Unable to check your access</h1>
      <p role="alert" className="text-sm text-destructive">
        {getIdentityError(error)}
      </p>
      <div className="flex flex-wrap gap-3">
        <Button onClick={() => void router.invalidate()}>Retry access check</Button>
        <Link to="/login" className="text-sm underline">
          Return to sign in
        </Link>
      </div>
    </section>
  );
}

function AuthLayout() {
  return <Outlet />;
}
