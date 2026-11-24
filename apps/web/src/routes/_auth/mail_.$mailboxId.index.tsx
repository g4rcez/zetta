import { createFileRoute } from "@tanstack/react-router";

import { MailInboxPage } from "@/features/mail/mail-inbox-page";
import { parseMailSearch, withMailSearch, type MailSearch } from "@/features/mail/mail-search";

// `mail_` keeps the settings page out of the inbox route, which has no <Outlet />.
export const Route = createFileRoute("/_auth/mail_/$mailboxId/")({
  head: () => ({ meta: [{ title: "Mail · zetta" }] }),
  validateSearch: (search: Record<string, unknown>): MailSearch => parseMailSearch(search),
  component: RouteComponent,
});

function RouteComponent() {
  const { mailboxId } = Route.useParams();
  const search = Route.useSearch();
  const navigate = Route.useNavigate();
  return (
    <MailInboxPage
      mailboxId={mailboxId}
      search={search}
      // Opening a conversation and submitting a search add a history entry; Back goes to the previous view.
      setSearch={(patch, { replace = false } = {}) =>
        void navigate({ search: (prev) => withMailSearch(prev, patch), replace })
      }
    />
  );
}
