import { createFileRoute } from "@tanstack/react-router";

import { RoomSettingsPage } from "@/features/discussions/room-settings";

// `rooms_` keeps this page out of the Rooms route, which has no <Outlet />.
export const Route = createFileRoute("/_auth/rooms_/$roomId/settings")({
  head: () => ({ meta: [{ title: "Room settings · zetta" }] }),
  component: RouteComponent,
});

function RouteComponent() {
  const { roomId } = Route.useParams();
  return <RoomSettingsPage roomId={roomId} />;
}
