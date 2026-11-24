import { createFileRoute } from "@tanstack/react-router";

import { MailSettingsPage } from "@/features/mail/mail-settings-page";

export const Route = createFileRoute("/_auth/mail_/$mailboxId/settings")({
  head: () => ({ meta: [{ title: "Mailbox settings · zetta" }] }),
  component: RouteComponent,
});

function RouteComponent() {
  const { mailboxId } = Route.useParams();
  return <MailSettingsPage mailboxId={mailboxId} />;
}
