# Your first useful bot

[Wiki home](../README.md) · [Glossary](../glossary.md)

## Start with the job

For example: “Prepare a daily briefing from these sources. Link the sources and tell me what is missing.” Begin with a small task whose result you can judge. A useful response matters more than filling every advanced setting.

Each user has one personal chief for coordination. You can start there or configure a specialist directly. Folders organize bots in the sidebar; moving a bot does not change who can use it.

## Choose which bots show in the chat sidebar

The chat sidebar lists your chief and a few bots, and "All bots (n)" opens the full list. By default it picks the bots you chatted with most recently. To choose them yourself, open **Bots** and press the pin on a bot's card, or open a bot's `⋯` menu in the sidebar and choose **Remove from sidebar**. The first time you do either, the list you already see becomes your pins, so you adjust it instead of starting from nothing. After that the sidebar lists your chief and your pinned bots, in the order you pinned them, with no limit. The bot you have open is always shown. The choice is yours alone: it changes only your sidebar, and you can pin a bot someone else owns. If you remove every pin, the sidebar goes back to picking by itself.

## Configure by form or conversation

1. Describe the bot's job, choose its name, and supply relevant instructions. Advanced model, skill, and hook controls remain accessible without being the first burden.
2. Choose a supported execution tool and model. Zetta explains missing setup in plain language instead of treating a detected executable as ready.
3. Connect your required accounts in their secure setup views. Do not put passwords, tokens, or login codes into chat.
4. Review the draft. A bot-proposed creation or edit shows a summary or exact diff and requires your explicit approval. A stale proposal never overwrites a newer change.
5. Return from account setup to the same draft without losing progress.

You may ask any authorized bot for configuration help, not only the chief. Forms and chat use the same validation and permissions. A bot that is not ready may help refine its own setup in a bounded setup conversation; this is not permission to delegate or schedule ordinary work before onboarding.

## Try, refine, then confirm

```text
Configure → real conversation → satisfaction question → explicit Yes → ready
                                  ↓ No
                              refine and retest
```

The selected tool, account, and model produce a real response. The bot then asks whether you are satisfied. Say yes explicitly only when the setup works for your intended job. A negative answer keeps setup open and returns to adjustment and another test.

Saving a form, clicking a reaction, staying silent, or the bot claiming you are satisfied does not finish onboarding. Confirmation belongs to you, that bot, and the tested setup. Another user's successful setup of a shared bot does not complete yours.

## If setup stops

| Situation                                 | Expected path                                                                                   |
| ----------------------------------------- | ----------------------------------------------------------------------------------------------- |
| Login is missing or expired               | Follow secure account setup and return to the draft or conversation.                            |
| Tool or model is unsupported              | See the missing capability and choose a supported setup; no fake success response.              |
| The answer is not useful                  | Refine the job/instructions and retest before confirming.                                       |
| The page reloads                          | Recover the draft and current question; do not accept stale confirmation for a different setup. |
| Relevant configuration or accounts change | Revalidate readiness. A past confirmation does not override revoked access.                     |

Once ready, [give the bot work and manage attention](work-and-attention.md). Read [privacy and sharing](privacy-and-sharing.md) before connecting sensitive accounts or publishing a conversation.
