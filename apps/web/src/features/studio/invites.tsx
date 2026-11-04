import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { toast } from "sonner";

import { identityClient, getIdentityError } from "@/lib/identity-client";
import { useTimeFormat } from "@/features/preferences/preferences";
import { formatDateTime } from "@/features/preferences/time-format";

import { errorMessage } from "../chat/chat-client";
import { InvitationManager } from "../identity/invitation-manager";
import { teamsQueries } from "../teams/teams-api";
import { TeamPeoplePanel } from "../teams/team-people";
import { ConfirmButton, Empty, list, listItem, Loading, Panel } from "../shared/ui";

const PENDING = ["identity", "invitations"] as const;

/** Studio > Invites: who can still join this server, and who is in each of your teams. Only the administrator issues invitations. */
export function Invites({ isAdmin }: { isAdmin: boolean }) {
  const tf = useTimeFormat();
  const qc = useQueryClient();
  const pending = useQuery({
    queryKey: PENDING,
    queryFn: () => identityClient.pending(),
    enabled: isAdmin,
  });
  const teams = useQuery(teamsQueries.list());
  const [cancelledId, setCancelledId] = useState<string>();
  const reload = () => qc.invalidateQueries({ queryKey: PENDING });
  const cancel = useMutation({
    mutationFn: (invitationId: string) => identityClient.revoke(invitationId),
    onSuccess: (_, invitationId) => {
      setCancelledId(invitationId);
      toast.success("Invitation revoked.");
    },
    onError: (e) => toast.error(getIdentityError(e)),
    onSettled: reload,
  });

  if (!isAdmin)
    return (
      <Empty>
        Only the administrator of this server can invite people. Ask them for an invitation.
      </Empty>
    );
  return (
    <div className="space-y-6">
      <InvitationManager cancelledId={cancelledId} onChange={() => void reload()} />
      <Panel
        title="Pending invitations"
        count={pending.data?.length}
        description="Invitations that nobody has used yet. They expire after 24 hours."
      >
        {pending.isError ? (
          <p role="alert" className="text-sm text-destructive">
            {errorMessage(pending.error)}
          </p>
        ) : !pending.data ? (
          <Loading />
        ) : pending.data.length === 0 ? (
          <p className="text-sm text-muted-foreground">No pending invitations.</p>
        ) : (
          <ul className={list}>
            {pending.data.map((i) => (
              <li
                key={i.invitationId}
                className={`${listItem} flex items-center justify-between gap-3`}
              >
                <span className="min-w-0">
                  <span className="block truncate font-medium">{i.intendedEmail}</span>
                  <span className="block text-muted-foreground">
                    Expires <time dateTime={i.expiresAt}>{formatDateTime(i.expiresAt, tf)}</time>
                  </span>
                </span>
                <ConfirmButton
                  label="Revoke"
                  question={`Revoke the invitation for ${i.intendedEmail}?`}
                  confirmLabel="Revoke invitation"
                  onConfirm={() =>
                    cancel.mutateAsync(i.invitationId).then(
                      () => undefined,
                      () => undefined,
                    )
                  }
                />
              </li>
            ))}
          </ul>
        )}
      </Panel>
      {teams.data?.map((team) => (
        <TeamPeoplePanel key={team.id} teamId={team.id} title={team.name} />
      ))}
    </div>
  );
}
