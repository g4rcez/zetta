# Let a bot use websites or a computer

[Wiki home](../README.md) · [Glossary](../glossary.md)

> **Status: required v1 behavior, with backend selection and real verification still pending.** Browser automation and computer use are separate requirements. A working browser tab does not prove a working isolated desktop.

## Which capability does the task need?

Browser automation lets a bot navigate and act on an authorized website. Computer use lets it interact with an isolated desktop session, including supported applications. Neither gives the bot unrestricted control of the server host or your personal computer.

Ask for a clear outcome using accounts and resources you are allowed to use. Available actions depend on verified backend and harness capabilities; unsupported actions must be reported honestly. A test may perform real actions, so use synthetic tasks or explicitly approved targets.

## Choose your browser profile

A profile holds browser state, including login state. It can be dedicated to a bot or explicitly shared among your bots. Sharing a bot definition or moving it into a workspace does not share the profile with other users.

If two of your bots need the same shared profile, they must follow the approved exclusive-use/serialization policy rather than both controlling the same login session at once. Reset or revoke is a deliberate operation; resetting a profile can remove login state and needs confirmation.

Exact persistence, session retention, and backend limits require the [browser/computer decision](../../../tasks/074-select-required-browser-and-computer-backends.md). Do not assume an existing login from the host browser is copied automatically.

## Computers, and what drives them

Studio > Computer lists your persistent Linux computers. When the operator offers more than one driver, each computer shows which tool drives it (Cua or agent-desktop) and you can change that while the computer is stopped; the same screen is what you see over VNC. Create a new computer there with a name and a driver. When the operator offers more than one system, the form also asks for the system (Debian or Ubuntu). Ubuntu computers have a terminal and no browser. Windows and macOS are listed with the reason they are not available. A bot that reads a page gets the same numbered text (`click_element{n}`) with either driver. One difference: the Cua driver refuses an element that is scrolled out of view, so a bot scrolls first; agent-desktop can press a link that is below the fold.

## Help with login or another human step

When a bot needs login, MFA, or another human-only action:

1. Open the source-linked attention item and inspect the task and account context.
2. Enter the secure takeover view for your session. Access must remain bound to you and the correct task; a copied or expired link must not grant control.
3. Let the bot give up input and screen observation before you enter sensitive information. Passwords and codes must not enter retained screenshots, events, chat, or learned knowledge.
4. Complete the human step, then explicitly hand control back or cancel.
5. Return to the same task. Zetta checks the current state before supported continuation; otherwise, it explains the deliberate next attempt and any repeated-effect risk.

Human and bot input must not race. Closing the view or losing connection is not automatic hand-back or permission to repeat an action. The system must show who has control and provide an honest recovery state.

## When something fails

A missing backend, revoked session, expired account, or uncertain submitted action is not a reason to fall back to a shared profile or host desktop. Keep completed output, report the blocker, and follow [repair and return](work-and-attention.md).

Cancellation stops owned automation according to the backend contract; it does not undo a form submission or desktop action that already happened. Downloaded files and retained screenshots remain subject to [privacy and sharing](privacy-and-sharing.md), including safe snapshot publication.

## Implementation owners

[Backend decision: RFC-074](../../../tasks/074-select-required-browser-and-computer-backends.md), [profiles: RFC-075](../../../tasks/075-manage-scoped-browser-profiles.md), [browser tools: RFC-076](../../../tasks/076-expose-isolated-browser-automation-tools.md), [computer sessions: RFC-077](../../../tasks/077-run-isolated-computer-use-sessions.md), and [secure takeover: RFC-078](../../../tasks/078-provide-secure-takeover-and-hand-back.md).
