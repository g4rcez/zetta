import { useQuery } from "@tanstack/react-query";
import { useNavigate } from "@tanstack/react-router";
import { useEffect } from "react";

import { Skeleton } from "@g4rcez/components";
import { describeFailure, mailQueries } from "./mail-api";
import { NoMailbox, ReadFailure } from "./mail-states";

/** `/mail`: the first mailbox, or the way to connect one. */
export function MailIndexPage() {
  const boxes = useQuery(mailQueries.mailboxes());
  const navigate = useNavigate();
  const first = boxes.data?.[0]?.id;
  useEffect(() => {
    if (first)
      void navigate({ to: "/mail/$mailboxId", params: { mailboxId: first }, replace: true });
  }, [first, navigate]);
  if (boxes.isError)
    return (
      <ReadFailure
        failure={describeFailure(boxes.error)}
        mailboxId=""
        what="your mailboxes"
        onRetry={() => void boxes.refetch()}
      />
    );
  if (boxes.data && boxes.data.length === 0) return <NoMailbox />;
  return (
    <div role="status" aria-label="Loading your mailboxes" className="space-y-3 p-6">
      <Skeleton className="h-6 w-1/3 rounded" />
      <Skeleton className="h-24 w-full rounded-lg" />
    </div>
  );
}
