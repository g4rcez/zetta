import { useQuery } from "@tanstack/react-query";
import {
  refuseRoleChange,
  WORKSPACE_ROLE_LABELS,
  WORKSPACE_ROLES,
  type WorkspaceRole,
} from "@zetta/core/workspace";
import { ACCOUNT_ENGINE_LABELS, ACCOUNT_KIND_LABELS } from "@zetta/core/engine-accounts";
import { useState } from "react";

import { BotIdentity } from "@/components/bot-identity";
import { BotSelect, type BotSelectBot } from "@/components/bot-select";
import { PersonIdentity } from "@/components/person-identity";
import { Button, Select } from "@/components/ui";
import { toast } from "@/lib/notify";

import { errorMessage } from "../chat/chat-client";
import {
  engineAccountsApi,
  engineAccountsQueries,
  type PersonAccount,
} from "../engine-accounts/engine-accounts-api";
import { Badge, ConfirmButton, list, listItem, Loading, Panel } from "../shared/ui";
import { workspaceApi, workspaceQueries, type WorkspacePerson } from "./workspace-api";

/** One of the person's own bots, with what the picker shows of it. */
export type OwnBot = BotSelectBot;

/** The roles the person looking may give this row, the current one included. Empty: they may not change it. */
export function rolesFor(
  me: WorkspaceRole,
  person: WorkspacePerson,
  owners: number,
): WorkspaceRole[] {
  const allowed = WORKSPACE_ROLES.filter(
    (to) =>
      to === person.role ||
      refuseRoleChange({
        actor: me,
        self: person.isYou,
        from: person.role,
        to,
        owners,
        targetIsRoot: person.isRoot,
      }) === null,
  );
  return allowed.length > 1 ? allowed : [];
}

type RowProps = {
  person: WorkspacePerson;
  roles: WorkspaceRole[];
  bots: readonly OwnBot[];
  busy: boolean;
  /** The agent accounts this person connected: the engine and the kind, never what it is called or what it holds. */
  accounts: readonly PersonAccount[];
  onDisconnect: (person: WorkspacePerson, account: PersonAccount) => Promise<void>;
  onRole: (person: WorkspacePerson, role: WorkspaceRole) => void;
  onShare: (person: WorkspacePerson, botId: string) => void;
  onUnshare: (person: WorkspacePerson) => Promise<void>;
};

function PersonRow({
  person,
  roles,
  bots,
  busy,
  accounts,
  onDisconnect,
  onRole,
  onShare,
  onUnshare,
}: RowProps) {
  // The bot picked for this person, until "Share" sends it.
  const [pick, setPick] = useState("");
  return (
    <li className={`${listItem} space-y-3`}>
      <div className="flex flex-wrap items-center justify-between gap-3">
        <PersonIdentity
          card
          size={28}
          person={person}
          sub={person.title ? `${person.title} · ${person.email}` : person.email}
          trailing={
            person.isYou ? (
              <Badge>You</Badge>
            ) : person.isRoot ? (
              <Badge tone="warning">Set this server up</Badge>
            ) : undefined
          }
          className="max-w-full"
        />
        {roles.length > 0 ? (
          <div className="w-44">
            <Select
              title={`Role of ${person.name}`}
              required={false}
              disabled={busy}
              value={person.role}
              options={roles.map((role) => ({ value: role, label: WORKSPACE_ROLE_LABELS[role] }))}
              onChange={(event) => onRole(person, event.target.value as WorkspaceRole)}
            />
          </div>
        ) : (
          <Badge>{WORKSPACE_ROLE_LABELS[person.role]}</Badge>
        )}
      </div>
      {accounts.length > 0 && (
        <ul className="space-y-1 pl-9" aria-label={`Agent accounts of ${person.name}`}>
          {accounts.map((account) => (
            <li key={account.id} className="flex flex-wrap items-center justify-between gap-2">
              <span className="flex flex-wrap items-center gap-2 text-muted-foreground">
                <span className="text-foreground">{ACCOUNT_ENGINE_LABELS[account.engine]}</span>
                {ACCOUNT_KIND_LABELS[account.kind]}
                {account.state === "signed_out" && <Badge tone="warning">Signed out</Badge>}
              </span>
              {!person.isYou && (
                <ConfirmButton
                  label="Disconnect"
                  size="xs"
                  question={`Disconnect the ${ACCOUNT_ENGINE_LABELS[account.engine]} account of ${person.name}? What Zetta stored for it is removed, and they connect it again when they want it back.`}
                  confirmLabel="Disconnect"
                  onConfirm={() => onDisconnect(person, account)}
                />
              )}
            </li>
          ))}
        </ul>
      )}
      {person.chief ? (
        <div className="flex flex-wrap items-center justify-between gap-3 pl-9">
          <BotIdentity
            size={24}
            bot={{
              id: person.chief.botId,
              name: person.chief.name,
              avatar: person.chief.avatar,
              ...(person.chief.kind ? { kind: person.chief.kind } : {}),
            }}
            sub="Shared with them as their Chief"
          />
          <ConfirmButton
            label="Take away"
            question={`Stop sharing ${person.chief.name} with ${person.name}? They get a Chief of their own, and keep their chats.`}
            confirmLabel="Stop sharing"
            onConfirm={() => onUnshare(person)}
          />
        </div>
      ) : (
        !person.isYou &&
        bots.length > 0 && (
          <div className="flex flex-wrap items-end gap-2 pl-9">
            <div className="min-w-56 max-w-xs flex-1">
              <BotSelect
                label={`Chief of ${person.name}`}
                placeholder="A Chief of their own"
                bots={bots}
                disabled={busy}
                value={pick}
                onChange={setPick}
              />
            </div>
            {pick && (
              <Button
                type="button"
                size="sm"
                variant="outline"
                disabled={busy}
                onClick={() => {
                  onShare(person, pick);
                  setPick("");
                }}
              >
                Share as their Chief
              </Button>
            )}
          </div>
        )
      )}
    </li>
  );
}

/**
 * The people of the workspace: who they are, their role, and the Chief someone shared with them. An owner sets any role, an
 * administrator moves people between member and administrator; the rule is the server's (`refuseRoleChange`), shown here so a choice
 * that would be refused is not offered.
 */
export function WorkspacePeoplePanel({ me, bots }: { me: WorkspaceRole; bots: readonly OwnBot[] }) {
  const people = useQuery(workspaceQueries.members());
  const connected = useQuery(engineAccountsQueries.people());
  const [busy, setBusy] = useState(false);

  async function change(work: () => Promise<unknown>, done: string) {
    setBusy(true);
    try {
      await work();
      toast.success(done);
    } catch (e) {
      toast.error(errorMessage(e));
    } finally {
      setBusy(false);
    }
  }

  const owners = people.data?.filter((person) => person.role === "owner").length ?? 0;
  return (
    <Panel
      title="People"
      count={people.data?.length}
      description="Everyone in this workspace, with their role and the agent accounts they connected. Owners and administrators invite people and set roles."
    >
      {people.isError ? (
        <p role="alert" className="text-sm text-destructive">
          {errorMessage(people.error)}
        </p>
      ) : !people.data ? (
        <Loading />
      ) : (
        <ul className={list}>
          {people.data.map((person) => (
            <PersonRow
              key={person.userId}
              person={person}
              roles={rolesFor(me, person, owners)}
              bots={bots}
              busy={busy}
              accounts={(connected.data ?? []).filter((a) => a.userId === person.userId)}
              onDisconnect={(who, account) =>
                change(
                  () => engineAccountsApi.removeFor(who.userId, account.id),
                  `The ${ACCOUNT_ENGINE_LABELS[account.engine]} account of ${who.name} is disconnected.`,
                )
              }
              onRole={(who, role) =>
                void change(
                  () => workspaceApi.setRole(who.userId, role),
                  `${who.name} is now ${WORKSPACE_ROLE_LABELS[role].toLowerCase()}.`,
                )
              }
              onShare={(who, botId) =>
                void change(
                  () => workspaceApi.shareChief(who.userId, botId),
                  `${who.name} now has your bot as their Chief.`,
                )
              }
              onUnshare={(who) =>
                change(
                  () => workspaceApi.unshareChief(who.userId),
                  `${who.name} has a Chief of their own again.`,
                )
              }
            />
          ))}
        </ul>
      )}
    </Panel>
  );
}
