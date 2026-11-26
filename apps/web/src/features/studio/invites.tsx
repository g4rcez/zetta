import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { type InviteRole, WORKSPACE_ROLE_LABELS } from "@zetta/core/workspace";
import { useMemo, useState } from "react";
import { toast } from "@/lib/notify";

import { BotIdentity } from "@/components/bot-identity";
import { identityClient, getIdentityError } from "@/lib/identity-client";
import { useTimeFormat } from "@/features/preferences/preferences";
import { formatDateTime } from "@/features/preferences/time-format";

import { errorMessage } from "../chat/chat-client";
import { chatQueries } from "../chat/chat-queries";
import { InvitationManager } from "../identity/invitation-manager";
import { teamsQueries } from "../teams/teams-api";
import { TeamPeoplePanel } from "../teams/team-people";
import { Badge, ConfirmButton, Empty, list, listItem, Loading, Panel } from "../shared/ui";
import { WorkspacePeoplePanel } from "../workspace/people-panel";
import { DownloadWorkspace, OperatorPanel } from "../workspace/operator-panel";
import { StartWorkspace } from "../workspace/start-workspace";
import { workspaceQueries } from "../workspace/workspace-api";

const PENDING = workspaceQueries.invitations().queryKey;
/** An owner gives any role an invitation can carry; an administrator invites members. */
const OWNER_GRANTS: readonly InviteRole[] = ["member", "admin"];
const ADMIN_GRANTS: readonly InviteRole[] = ["member"];

/**
 * Studio > People: who is in this workspace and as what, who can still join it, and who is in each of your teams. Owners and
 * administrators invite people and set roles.
 */
export function Invites({ isAdmin }: { isAdmin: boolean }) {
  const tf = useTimeFormat();
  const qc = useQueryClient();
  const mine = useQuery({ ...workspaceQueries.mine(), enabled: isAdmin });
  const pending = useQuery({ ...workspaceQueries.invitations(), enabled: isAdmin });
  const allBots = useQuery({ ...chatQueries.bots(), enabled: isAdmin });
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
  // Only a bot of the person's own can be given to someone as their Chief.
  const bots = useMemo(() => (allBots.data ?? []).filter((b) => b.canEdit), [allBots.data]);

  if (!isAdmin)
    return (
      <Empty>
        Only an owner or an administrator of this workspace invites people. Ask one of them for an
        invitation.
      </Empty>
    );
  const role = mine.data?.role;
  return (
    <div className="space-y-6">
      {role && <WorkspacePeoplePanel me={role} bots={bots} />}
      <InvitationManager
        cancelledId={cancelledId}
        onChange={() => void reload()}
        roles={role === "owner" ? OWNER_GRANTS : ADMIN_GRANTS}
        bots={bots}
      />
      {mine.data?.isRoot && <StartWorkspace />}
      {mine.data?.isRoot && <OperatorPanel />}
      {!mine.data?.isRoot && role === "owner" && <DownloadWorkspace />}
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
                className={`${listItem} flex flex-wrap items-center justify-between gap-3`}
              >
                <span className="min-w-0 space-y-1">
                  <span className="flex items-center gap-2">
                    <span className="min-w-0 truncate font-medium">{i.intendedEmail}</span>
                    {i.role !== "member" && <Badge>{WORKSPACE_ROLE_LABELS[i.role]}</Badge>}
                  </span>
                  <span className="block text-muted-foreground">
                    Expires <time dateTime={i.expiresAt}>{formatDateTime(i.expiresAt, tf)}</time>
                  </span>
                  {i.chief && (
                    <BotIdentity
                      size={20}
                      bot={{
                        id: i.chief.botId,
                        name: i.chief.name,
                        avatar: i.chief.avatar,
                        ...(i.chief.kind ? { kind: i.chief.kind } : {}),
                      }}
                      sub="Will be their Chief"
                    />
                  )}
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
