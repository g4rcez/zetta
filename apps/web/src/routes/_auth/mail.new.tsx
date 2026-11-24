import { createFileRoute } from "@tanstack/react-router";

import { MailConnectPage } from "@/features/mail/mail-connect-page";

export const Route = createFileRoute("/_auth/mail/new")({
  head: () => ({ meta: [{ title: "Connect a mailbox · zetta" }] }),
  component: MailConnectPage,
});
