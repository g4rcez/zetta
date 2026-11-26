# Know what is private and what you share

[Wiki home](../README.md) · [Glossary](../glossary.md)

## Shared bots are not shared identities

Each user signs in to Zetta with their own local account. External account logins do not replace Zetta's server-side authentication and authorization.

| Resource or action                                  | Boundary                                                                                         |
| --------------------------------------------------- | ------------------------------------------------------------------------------------------------ |
| Bot definition                                      | Team-visible by default, optionally private. Visibility alone does not grant all editing rights. |
| Personal chief                                      | One per user, independent of folder selection.                                                   |
| Private conversation, files, and retained knowledge | Belong to their authorized user scope; sharing a bot does not share them.                        |
| Interactive or delegated work                       | Uses the requesting user's authorized connections. A bot someone else owns gets only part.       |
| Scheduled work                                      | Uses the routine owner's authorized connections.                                                 |
| Workflow execution                                  | Preserves the initiating user, or routine owner for scheduled execution.                         |
| Folder                                              | Visual grouping only; never a sharing or authorization boundary.                                 |
| Browser profile                                     | User-owned; sharing among that user's bots must be explicit. Never shared across users.          |

## What a colleague's bot may do

A team bot works from its owner's instructions. When you use one that is not yours:

- It can read what your plugins let it read and answer you.
- Anything it wants to save or change waits for your approval, each time.
- It cannot change your bots, and cannot use your computers, saved machines, browser, passwords, MCP servers or GitHub account.
- In a room where it takes part, your own bots run no commands and also ask before they change anything.

There is one installation admin; administrative duties do not imply unrestricted reading of private conversations or credentials.

Bots operate autonomously within assigned work and access. Not asking for approval on every ordinary action does not authorize bypassing accounts, private resources, or configured boundaries. Three kinds of action always wait for your approval: deleting files, administrator commands and sending email.

## Publish a conversation deliberately

Publication shares the **entire conversation at a fixed cutoff**, not only the latest answer. Review what that includes before deciding to publish. The audience is the authorized team, not the public internet.

A snapshot:

- Contains frozen conversation content, including safe representations of attachments and tool output.
- Does not include later private messages or become a live writable channel.
- Does not grant account access, underlying memory access, bot settings access, or live server-file capabilities.
- Cannot be used to reply, react, invoke a bot, or operate the original resources.

If any part cannot be represented safely, publication stops with a clear reason. It does not silently omit content to claim a complete snapshot or copy a dangerous live handle. A reference to private memory is different from text already included in the conversation: any safe text present in the published conversation is part of the shared content.

Correcting a memory later does not rewrite a snapshot. Immutable content does not settle who may continue to view it: you can revoke a publication, and a revoked snapshot stays revoked. A snapshot is never a public link.

## Safe examples and account setup

Use synthetic or non-sensitive inputs when trying a new bot. Keep passwords and MFA codes in secure login/takeover views, not chat. Only attach or reference files you are authorized to use. A teammate's bot availability does not give you its creator's account connection or completed onboarding.

If access is revoked, a result link shows a safe unavailable state instead of exposing titles, file paths, or credentials. For blocked work, follow [repair and return](work-and-attention.md).
