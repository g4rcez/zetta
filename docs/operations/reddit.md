# Reddit plugin

The `reddit` plugin lets bots read your Reddit account (feed, saved, upvoted, your posts and comments, inbox) and browse or search Reddit. If you allow it, bots can also post, comment, vote, edit, save, join subreddits and send messages as you. It uses Reddit's own [OAuth2](https://github.com/reddit-archive/reddit/wiki/OAuth2) flow and the Data API (`oauth.reddit.com`), with **your own Reddit app**. There is no MCP server and no server-wide key.

1. On Reddit open [reddit.com/prefs/apps](https://www.reddit.com/prefs/apps) > *create another app*, pick **web app**, and set the redirect uri to `<BETTER_AUTH_URL>/api/plugins/reddit/callback` (override the base with `REDDIT_OAUTH_REDIRECT_BASE`). Reddit may have to approve new Data API apps before they work.
2. Studio > Plugins > **Reddit** > Install. Paste the app's client id (the string under its name) and its secret. Both are stored encrypted for your account. Change them later under **Settings**, which disconnects the account.
3. On the installed card, tick what bots may do, choose the switches, and press **Connect with Reddit**. Pressing **Update permissions** later only goes back to Reddit when you add a permission.
4. Under **Bots**, enable the plugin for the bots that may use it.

## What bots can do

| Tool | Needs | Notes |
| --- | --- | --- |
| `reddit_me` | connected | Username, karma, account age, and whether bots may see NSFW content or act. |
| `reddit_subreddit_posts`, `reddit_search`, `reddit_read_post`, `reddit_user` | `read` | `reddit_read_post` takes an id or a reddit.com link and returns up to 30 comments, nested 3 levels deep at most. |
| `reddit_my_saved`, `reddit_my_upvoted`, `reddit_my_posts`, `reddit_my_comments` | `history` | Paged with `after`. |
| `reddit_my_subreddits` | `mysubreddits` | |
| `reddit_inbox` | `privatemessages` | Never marks anything read. |
| `reddit_submit_post`, `reddit_comment` | `submit` + **Allow actions** | Text or link posts. Flair, spoiler and NSFW (only when NSFW is allowed). |
| `reddit_vote` | `vote` + **Allow actions** | 10 votes an hour. Reddit forbids automated or bulk voting, so bots vote only on items you name. |
| `reddit_edit`, `reddit_delete` | `edit` + **Allow actions** | Your own posts and comments only. |
| `reddit_save` | `save` + **Allow actions** | |
| `reddit_subscribe` | `subscribe` + **Allow actions** | |
| `reddit_send_message`, `reddit_mark_read` | `privatemessages` + **Allow actions** | |

Text from Reddit is untrusted: it is sanitised, clipped, and labelled as data, so bots never follow instructions found in it. Actions are off by default and limited to 5 a minute and 30 an hour per user. You can also restrict posts, comments, votes and joins to a list of subreddits under **Only act in these subreddits**.

## NSFW

NSFW content is **off** by default. NSFW posts, comments and subreddits are left out of every listing (the result says how many were hidden), and reading an NSFW post is refused. Turn on **Allow NSFW content** to include it. Search then asks Reddit for NSFW results, and bots may mark their own posts NSFW. Reddit applies its own filter too: unless your account has "I'm over eighteen" enabled in your Reddit preferences, Reddit hides NSFW content anyway. The card warns you when that applies.

## Limits

- Reddit allows about 100 requests a minute for each app. Every user has their own app, so users never share a limit. When Reddit throttles, bots are told how long to wait.
- Disconnecting revokes the refresh token at Reddit and keeps your app's credentials, so you can connect again without retyping them.
