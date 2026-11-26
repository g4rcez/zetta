import { QueryClientProvider } from "@tanstack/react-query";
import { RouterProvider, createRouter } from "@tanstack/react-router";
import ReactDOM from "react-dom/client";

import Loader from "./components/loader";
import { queryClient } from "./lib/query-client";
import { registerServiceWorker } from "./lib/register-sw";
import { serverOrigin } from "./lib/server-origin";
import { installWorkspaceScope } from "./lib/workspace-scope";
import { routeTree } from "./routeTree.gen";

// Every call to the server says which workspace this tab works in (lib/workspace-scope.ts).
installWorkspaceScope(serverOrigin());

const router = createRouter({
  routeTree,
  defaultPreload: "intent",
  scrollRestoration: true,
  defaultPendingComponent: Loader,
  context: { queryClient },
});

declare module "@tanstack/react-router" {
  interface Register {
    router: typeof router;
  }
}

const rootElement = document.getElementById("app");

if (!rootElement) {
  throw new Error("Root element not found");
}

// Accessibility audit in development only: open any page with `?axe` (the import is dropped from production builds).
if (import.meta.env.DEV && new URLSearchParams(location.search).has("axe")) {
  void import("./dev/axe-report").then((m) => m.runAxeReport());
}

registerServiceWorker();

if (!rootElement.innerHTML) {
  const root = ReactDOM.createRoot(rootElement);
  root.render(
    <QueryClientProvider client={queryClient}>
      <RouterProvider router={router} />
    </QueryClientProvider>,
  );
}
