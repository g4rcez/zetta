# Agent accounts: each person's own subscription or key

A bot answers through an engine: Claude Code, Codex, Pi, OMP and others. An engine needs an account, which is a subscription or an API key. Each person connects their own in **Studio > Accounts**, and their bots run on it. Nobody else's bot does, unless its owner shares it (see "Who pays").

## Connecting an account

In **Studio > Accounts**, under the engine, choose **Connect my account**. Each engine offers its own ways:

| Engine               | Ways to connect                                                                                         |
| -------------------- | ------------------------------------------------------------------------------------------------------- |
| Claude Code          | Sign in with your Claude subscription; paste a token from `claude setup-token`; paste an Anthropic key  |
| Codex                | Sign in with your ChatGPT plan; paste an OpenAI key                                                     |
| OMP                  | Sign in with your Claude subscription or your ChatGPT plan; paste a provider key                        |
| Pi, OpenCode, Hermes | Paste a key of the provider whose models the bot uses (Anthropic, OpenAI, Google, OpenRouter, DeepSeek) |
| DeepSeek, Cursor     | Paste that service's key                                                                                |

**Signing in.** Zetta runs the engine's own sign-in on the server and shows you its link. You approve in your browser. Claude Code and OMP then show a code, which you paste back into Zetta. Codex shows a one-time code that you enter on its page, and Zetta notices by itself when you are done. A sign-in that nobody finishes ends after ten minutes and leaves nothing behind.

**Pasting.** A token or a key is sealed in your browser before it is sent, stored encrypted, and never shown again.

You can connect several accounts to one engine. One is **in use**: the one your bots take. **Use this one** changes it, and **Disconnect** removes an account and what Zetta stored for it.

**When a sign-in ends.** A subscription sign-in can end on the provider's side. When a run on a Codex or OMP sign-in is refused, Zetta asks that engine whether the sign-in still holds. If it does not, the account shows **Signed out**, and your bots for that engine wait until you sign in again or choose **Try again**: they do not move to the server's own sign-in in the meantime. A refused token or key fails that run with a request to connect again, and stays as it is.

## Who pays

| You talk to                                              | The run uses                                                 |
| -------------------------------------------------------- | ------------------------------------------------------------ |
| Your own bot                                             | Your account                                                 |
| A bot someone made visible to the team, in your own chat | Your account, on the engine and model you chose for that bot |
| A Chief that was shared with you                         | Its owner's account, in every chat                           |
| A bot in a room, set to run on its owner's account       | Its owner's account                                          |
| Any other bot in a room                                  | The account of the person the room belongs to                |

Two settings decide the lines above:

- **For you, on someone else's bot.** In the chat's details, **Engine and account for you** lets you run that bot on another engine, model and account than its owner chose. Left alone, it follows the bot's engine and your account in use for it.
- **For your own bot.** In the bot's settings, **Your account for this bot** chooses which of your accounts runs it, and **In a room, this bot runs on** chooses between the account of whoever opened the room and your own account for everyone there. With your account, the people of the room need none of their own, and their messages count against your limit.

## The workspace's account

An owner or an administrator can connect one account per engine for the whole workspace: under the engine in **Studio > Accounts**, **Connect one for the workspace**. Everyone in the workspace sees that it is there. A person with no account of their own for that engine runs on it, and what they send counts against it. A person's own account always comes first. Only an owner or an administrator disconnects it; the secret stays sealed under the person who connected it.

## People without an account

The setting **People without an agent account run on the server's own sign-in** (Studio > Server settings, security policy) decides what happens to a person who has no account of their own and no workspace account for an engine:

- **Allowed** (the default): they run on the sign-in of the server's own user, which everyone then shares. This is how a server worked before accounts, and how a one-person install keeps working with nothing to set up. That sign-in is the one `bun run infra login` makes on a server of your own.
- **Off**: a bot answers only on an account. A person with none for the engine is told to connect one, and a bot with a fallback engine uses that one.

A server for many organizations (`ZETTA_MODE=app`) never runs anyone on its own sign-in, whatever the setting says: each organization brings its own accounts.

## What an administrator sees

**Studio > People** lists, under each person, the engines they connected an account to and whether it is a sign-in, a token or a key. It never shows what an account is called, whose key it is or anything of the secret. An owner or an administrator can disconnect an account of a person of their workspace. Only the person can connect it again.

## What is stored, and where

- A token or a key is a sealed secret of its owner, like every other key in Zetta. It is opened only to start a run on that account, as its owner, and passed to the engine in the variable the engine reads. It is never written to a command line or to a log.
- A sign-in of Codex or OMP keeps the engine's own files in a folder of that account on the server. Only runs on that account are pointed at it.
- The activity trail records, for a run on an account, which account it was and whose, when that is not the person who asked.
- When the owner of a shared account leaves the server, nothing runs on it any more.

## Limits

- Pi signs in only inside its own screen, so it takes a pasted key.
- A sign-in belongs to the server process that started it. On a server with several processes, start it again if the page loses it.
- Where bot runs happen in containers, a guided sign-in runs in the same image, so the engine must be in that image.
- There is no cap per person on a shared account: an owner who shares it pays for what the others send.
