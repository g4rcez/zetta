import { createFileRoute } from "@tanstack/react-router";

import { VmConsole } from "@/features/studio/vm-viewer";

/** A computer's screen alone, filling its own browser window (opened from "Open in new window"). */
export const Route = createFileRoute("/_auth/computer/$vmId")({
  head: () => ({ meta: [{ title: "Computer · zetta" }] }),
  component: RouteComponent,
});

function RouteComponent() {
  const { vmId } = Route.useParams();
  return <div className="h-svh p-4"><VmConsole vmId={vmId} popout={false} /></div>;
}
