# People, roles and shared Chiefs

A workspace is one organization's own space on a server: its people, bots, chats, memory, teams and settings. A server starts with one, root's, and root can start more for other organizations. Nothing of one workspace is seen from another. Each person has one role in each workspace they are in. **Studio > People** shows who is in the workspace, what each person is, which engines they connected an [agent account](agent-accounts.md) to, who was invited and has not joined yet, and which Chief was shared with whom.

## The three roles

| Role          | Does                                                                                                                                        |
| ------------- | ------------------------------------------------------------------------------------------------------------------------------------------- |
| Owner         | Everything an administrator does, and decides who the owners and administrators are. Renames the workspace.                                 |
| Administrator | Invites members, moves people between member and administrator, changes the company chart and the settings a workspace may have of its own. |
| Member        | Uses the workspace: their own bots, and the ones shared with the team.                                                                      |

Two rules hold whatever anyone clicks:

- A workspace always keeps one owner. The last owner cannot step down until someone else is an owner.
- An administrator touches no owner and not their own role.

## The person who set the server up

The first account of a server is **root**: the person who typed the setup key. Root owns the workspace and stays an owner. Root alone changes what belongs to the whole server:

- the settings that are one value for the server, and every security policy (Studio > Server settings shows them to other administrators as read-only);
- the keys of the server's own services: speech, transcription, mail, phone providers, WhatsApp;
- the Laya decision model, and updates.

Root is replaced with the operator command in [identity-admin.md](identity-admin.md). The new person becomes an owner, and the previous one stays in the workspace as a member.

Root owns its own workspace, the first one. In a workspace of another organization root has no seat, and sees only its name and numbers (see "Workspaces on one server").

## Inviting someone

In **Studio > People**, fill in **Invite a member**:

- **Invited email**: the address of the account that will use the invitation.
- **Role**: an owner chooses member or administrator. An administrator invites members. Ownership is never given by an invitation: an owner sets it afterwards, on a person who is already in the workspace.
- **Their Chief**: leave "A Chief of their own" and Zetta creates one that belongs to them. Or pick one of your own bots, and that bot is their Chief.

The token is shown once. It expires after 24 hours and works once, for that address. **Pending invitations** lists the ones nobody used yet, with what each gives, and revokes them.

An invitation joins the workspace you work in when you send it. A new person signs up with it. A person who already uses this server joins with it from the workspace menu at the top of the sidebar: **Join a workspace**, then paste the token.

## Working in several workspaces

The workspace menu at the top of the sidebar shows the workspace this tab works in and lists the others you are in. Choosing one opens its overview. The workspace is part of the address (`?w=<name>`), so two tabs can work in two workspaces, and a link opens the workspace it was copied from. A workspace you are no longer in opens your own instead.

What a bot does runs in the workspace it was asked in: its chats, its memory, its routines, the account it runs on.

## Workspaces on one server

Root starts a workspace for another organization in **Studio > People > Start a workspace**: its name, its address name and the e-mail of the person who will own it. Root gets that person's invitation token, once. They sign up with it (or join with it, if they already use the server) and become the workspace's owner; root has no seat in it.

**Studio > People > Workspaces** shows root every workspace on the server, with its people, the bot runs and minutes it used this month, and:

- **Limits**: how many bot runs and minutes a workspace may use a month. Empty is no limit. A workspace that reached one runs nothing more that month, and its people are told so.
- **Suspend**: nobody works in it and nothing runs in it until root resumes it.
- **Download a copy**: everything the workspace holds, as one file of JSON lines. Secrets are not in it, only which connections there are. The owner of a workspace downloads a copy of their own from the same page.
- **Delete**: the workspace and everything in it go, at once for its people. Root's own workspace is never suspended or deleted.

## A shared Chief

A bot you share with a person as their Chief stays yours:

- They talk to it in chats of their own. You do not see those chats.
- What you change in the bot (its instructions, its skills, its engine) changes for them too.
- It can be a private bot: nobody else sees it.
- It runs on your engine and your [agent account](agent-accounts.md), so they need no account of their own for it. Their messages count against your limit.
- Because it is not their bot, it gets none of their computers, browser, MCP servers or GitHub access, and every lasting change it makes for them waits in a card for their click.
- They have no Chief of their own while the share lasts. A Chief they already had is listed with their other bots, with its chats.

Share or stop sharing at any time on the person's row in **Studio > People**. An owner or an administrator stops any share; only a bot of your own can be shared. Archiving the bot ends the share. When a share ends, the person gets a Chief of their own again.

## Limits

- What the server keeps on disk for a workspace (pictures, files, artifacts) is not in a copy, and stays on disk after a delete; its agent account folders are removed.
- Limits are checked when a run starts: a run that crosses one finishes.
- A shared Chief that is private to its owner answers in the person's own chats. Rooms, routines and workflows take the person's own bots and the bots shared with the team.
- People are added with an invitation, and a role change applies to the person's next request. There is no screen to remove a person from the workspace.
