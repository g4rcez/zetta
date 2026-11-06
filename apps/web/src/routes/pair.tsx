import { createFileRoute, useNavigate } from "@tanstack/react-router";

import { PairPage } from "@/features/identity/pair-page";

export const Route = createFileRoute("/pair")({ component: PairRoute });

function PairRoute() {
  const navigate = useNavigate();
  return (
    <PairPage
      code={window.location.hash.slice(1)}
      onDone={() => void navigate({ to: "/", replace: true })}
      onSignIn={() => void navigate({ to: "/login", replace: true })}
    />
  );
}
