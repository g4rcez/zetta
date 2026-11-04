# Know what is private and what you share

[Wiki home](../README.md) · [Glossary](../glossary.md)

> **Status: confirmed privacy requirements for v1, not a claim of completed security verification.** Actual access controls and isolation require implementation and adversarial evidence.

## Shared bots are not shared identities

Each user signs in to Zetta with their own local account. External account logins do not replace Zetta's server-side authentication and authorization.

| Resource or action                                  | Required boundary                                                                                |
| --------------------------------------------------- | ------------------------------------------------------------------------------------------------ |
| Bot definition                                      | Team-visible by default, optionally private. Visibility alone does not grant all editing rights. |
| Personal chief                                      | One per user, independent of folder selection.                                                   |
| Private conversation, files, and retained knowledge | Belong to their authorized user scope; sharing a bot does not share them.                        |
| Interactive or delegated work                       | Uses the requesting user's authorized connections.                                               |
| Scheduled work                                      | Uses the routine owner's authorized connections.                                                 |
| Workflow execution                                  | Preserves the initiating user, or routine owner for scheduled execution.                         |
| Folder                                              | Visual grouping only; never a sharing or authorization boundary.                                 |
| Browser profile                                     | User-owned; sharing among that user's bots must be explicit. Never shared across users.          |

Human membership, shared-bot editing rights, and removal/revocation policy still need the [ownership decision](../../../tasks/001-approve-domain-and-ownership-contracts.md). There is one installation admin; administrative duties do not imply unrestricted reading of private conversations or credentials.

Bots operate autonomously within assigned work and access. Not asking for approval on every ordinary action does not authorize bypassing accounts, private resources, or configured boundaries. Configurable per-action permissions are deferred; basic access enforcement is not.

## Publish a conversation deliberately

Publication shares the **entire conversation at a fixed cutoff**, not only the latest answer. Review what that includes before deciding to publish. The audience is the authorized team, not the public internet.

A snapshot:

- Contains frozen conversation content, including safe representations of attachments and tool output.
- Does not include later private messages or become a live writable channel.
- Does not grant account access, underlying memory access, bot settings access, or live server-file capabilities.
- Cannot be used to reply, react, invoke a bot, or operate the original resources.

If any part cannot be represented safely, publication must stop with a clear reason. It must not silently omit content to claim a complete snapshot or copy a dangerous live handle. A reference to private memory is different from text already included in the conversation: any safe text present in the published conversation is part of the shared content.

Correcting a memory later does not rewrite a snapshot. Immutable content does not settle who may continue to view it: membership removal, publication revocation, and retention rules remain explicit ownership decisions. Do not promise public links, permanent access, or deletion behavior before those decisions are accepted.

## Safe examples and account setup

Use synthetic or non-sensitive inputs when trying a new bot. Keep passwords and MFA codes in secure login/takeover views, not chat. Only attach or reference files you are authorized to use. A teammate's bot availability does not give you its creator's account connection or completed onboarding.

If access is revoked, a result link should show a safe unavailable state instead of exposing titles, file paths, or credentials. For blocked work, follow [repair and return](work-and-attention.md).

## Implementation owners

[Ownership: RFC-001](../../../tasks/001-approve-domain-and-ownership-contracts.md), [access enforcement: RFC-005](../../../tasks/005-enforce-actor-and-resource-access-boundaries.md), [connections: RFC-007](../../../tasks/007-store-user-owned-connection-references.md), [snapshot capture: RFC-034](../../../tasks/034-capture-immutable-conversation-snapshots.md), [viewer: RFC-035](../../../tasks/035-build-team-read-only-snapshot-viewer.md), and [cross-user verification: RFC-066](../../../tasks/066-verify-cross-user-isolation-end-to-end.md).
