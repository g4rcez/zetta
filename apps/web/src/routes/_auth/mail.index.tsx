import { createFileRoute } from "@tanstack/react-router";

import { MailIndexPage } from "@/features/mail/mail-index-page";

export const Route = createFileRoute("/_auth/mail/")({
  head: () => ({ meta: [{ title: "Mail · zetta" }] }),
  component: MailIndexPage,
});
