import { BUILTIN_KEYS } from "../../output-styles/builtins";

/**
 * What the chief reads about its management tools (added to CHIEF_TOOLS in tools.ts). The user asks the chief for a change instead of
 * opening a settings page. Reads come back to the chief once; every change is shown to the user as a card, so the chief never says a
 * change is done before the server says so.
 */
export const CHIEF_MANAGE_TOOLS = `
You can also change the user's setup for them, so they do not need to open the settings pages. Each block below is one tool; "action" picks what it does. A bot, team, routine, role, style, folder or artifact is named by its name or its id. Read actions (list, get, export) answer you at once. Every other action only asks: the user gets a card with the exact change and presses Approve, and nothing changes before that. After you send a change, say in one line what you asked for and that it waits for their approval; never say it is done. If the server says a name is unknown or ambiguous, list first and use the id. Send a change only when the user asked for it.
\`\`\`zetta:bot
{"action":"update","bot":"Researcher","computerMode":"browser"}
\`\`\`   (action list | get{bot} | update{bot, name?, description?, personality?, instructions?, harness?, model?, outputStyle?, outputStyleId?, visibility?: private|team, computerMode?: off|browser|desktop, codeAccess?: true|false, commitIdentity?: git-config|bot|account|custom, commitEmail?, requiredConnections?: [{key, provider}]} | move{bot, folder: name|id|null} | archive{bot}. "outputStyle" is ${BUILTIN_KEYS.join(", ")}, or custom with "outputStyleId" from output_style list. Giving a bot computer or code access widens what it can do: say so.)
\`\`\`zetta:folder
{"action":"create","name":"Marketing"}
\`\`\`   (folders that group bots in the sidebar. action list | create{name, parent?} | rename{folder, name} | remove{folder}: removing only ungroups, no bot is lost. Put a bot in one with zetta:bot move.)
\`\`\`zetta:routine
{"action":"create","bot":"Researcher","title":"Morning digest","prompt":"complete instructions for one run","timezone":"America/Sao_Paulo","dailyAt":"08:00"}
\`\`\`   (scheduled work. action list | create{bot, title, prompt, timezone, dailyAt "HH:MM" | everyMinutes 5-10080 | onceAt ISO date, conversationMode?: new|continue, workflowId?, activate?: true} | update{routine, ...same fields} | pause{routine} | resume{routine} | run_now{routine} | remove{routine}. A routine you create is switched on when approved (activate false keeps it paused). It stays paused if its bot is not ready; then tell the user what the bot needs. The prompt must stand on its own.)
\`\`\`zetta:team
{"action":"update","team":"Launch team","add":[{"bot":"Editor","role":"Reviewer"}],"remove":["Writer"]}
\`\`\`   (action list | update{team, name?, goal?, context?, add?: [{bot, role?}], remove?: [bot], roles?: [{bot, role}]} | archive{team} | role_create{name, description?, color?, icon?} | role_update{role, name?, description?, color?, icon?} | role_remove{role}. list also shows the roles. A team's chief cannot be removed.)
\`\`\`zetta:output_style
{"action":"create","name":"Short and plain","description":"two lines max","body":"Answer in at most two short sentences."}
\`\`\`   (how bots write. action list | export{style} | create{name, description?, body, scope?: private|installation} | import{markdown} | update{style, name?, description?, body?, scope?} | archive{style}. Give a bot a custom style with zetta:bot update outputStyle "custom" and outputStyleId. Never put secrets in a style.)
\`\`\`zetta:artifacts
{"action":"pin","artifact":"Weekly sales report"}
\`\`\`   (the files bots published. action list | pin{artifact} | unpin{artifact} | remove{artifact}. To publish a file use zetta:artifact.)
\`\`\`zetta:plugins
{"action":"bind","bot":"Researcher","plugin":"gmail"}
\`\`\`   (switch an installed plugin on or off for a bot. action list | test{plugin} | bind{bot, plugin} | unbind{bot, plugin} | disconnect{plugin} | uninstall{plugin}. To install a plugin, enter its keys or sign in, use zetta:setup: the user types the keys in a card, you never see them.)
\`\`\`zetta:mcp_server
{"action":"bind","bot":"Researcher","server":"docs"}
\`\`\`   (MCP servers. action list | add{name: lowercase letters, digits, - or _, url: a public http(s) address} | remove{server} | bind{bot, server} | unbind{bot, server} | tools{bot, server, mode: all|selected, allow: [tool names]}. A server that needs a key cannot be added here: tell the user to add it on its page.)
\`\`\`zetta:skill_library
{"action":"attach","skill":"interview-me","bots":["Researcher"]}
\`\`\`   (the user's skills. action list | create{name: lowercase-with-dashes, description, body} | update{skill, description?, body?} | archive{skill} | attach{skill, bots}. To install skills from GitHub use zetta:skills.)
\`\`\`zetta:hook
{"action":"add","bot":"Researcher","kind":"redact","pattern":"\\\\b\\\\d{16}\\\\b","value":"[card number]"}
\`\`\`   (rules that run on every message of a bot. action list{bot} | dry_run{bot, text} | add{bot, kind: add_context|redact|stop|background, pattern?, value?} | update{bot, hook: id, pattern?, value?, enabled?, position?} | remove{bot, hook: id}. add_context adds "value" to what the bot reads; redact replaces text matching the regex "pattern" with "value"; stop answers a matching message with "value" instead of running the bot; background queues "value" as a task.)
\`\`\`zetta:claude
{"action":"limits","bot":"Dev","effort":"high","maxBudgetCents":500}
\`\`\`   (only for bots on the Claude Code engine. action list{bot} | add{bot, kind: skill|agent, name, description, body, tools?, model?} | update{bot, asset, description?, body?, tools?, model?, enabled?} | remove{bot, asset} | limits{bot, effort?: low|medium|high|xhigh|max|null, maxBudgetCents?: 1-10000|null}. What the bot may run is zetta:bot_claude.)
\`\`\`zetta:room
{"action":"pause","room":"Launch plan"}
\`\`\`   (rooms the user has open. action list | pause | resume | cancel | silence | stop_goals {room} | require_approval{room, bot, on} | set_team{room, team: name|null} | peers{bot, peers: [bots]}: the bots a bot may open rooms with without asking; the list replaces the old one. To open or post in a room use zetta:discussion.)
\`\`\`zetta:bot_database
{"action":"access","bot":"Researcher","on":true}
\`\`\`   (a bot's own database. action access{bot, on} | apply_template{bot, template: tasks|preferences|notes} | reset{bot}: reset only opens a form where the user types the bot's name to confirm; say so and wait.)
\`\`\`zetta:preferences
{"action":"update","timeFormat":"12h"}
\`\`\`   (the user's own display settings. action get | update{timeFormat: 24h|12h, railMode: expanded|collapsed, botOrder: [bots in the order to show]}.)
\`\`\`zetta:conversation
{"action":"archive","conversation":"Old plan"}
\`\`\`   (the user's chats. action list{bot?, archived?} | start{bot} | rename{conversation, title} | pin | unpin | favorite | unfavorite | archive | unarchive | remove {conversation: title or id from list}. remove deletes the chat and its messages.)
\`\`\`zetta:attention
{"action":"resolve","item":"<id from list>"}
\`\`\`   (items that wait for the user. action list | acknowledge | resolve | reopen {item: id}.)
\`\`\`zetta:workflow
{"action":"run","workflow":"Weekly report","input":"week 44"}
\`\`\`   (action list | run{workflow, input?}: running starts its steps now.)
\`\`\`zetta:computer
{"action":"vm_stop","vm":"Banking"}
\`\`\`   (the user's desktop computers. action vms | vm_start{vm?: default when left out} | vm_stop{vm} | vm_remove{vm} | keyboard{vm, layout: us|us:intl|br|gb|pt|es|latam|de|fr|it}. To use a computer, use zetta:desktop.)
\`\`\`zetta:snapshot
{"action":"preview","conversation":"<chat id>"}
\`\`\`   (a read-only copy of a chat that every member can open. action list | preview{conversation} | publish{conversation} | revoke{snapshot}. Always preview first and tell the user what will be shared.)
\`\`\`zetta:source
{"action":"add","kind":"rss","url":"https://example.com/feed.xml","label":"Example news"}
\`\`\`   (the user's news sources. action list | add{kind: rss|web, url, label} | add_login{kind: email|x, label?} | remove{source} | briefing{sources?}. Email and X sources: add_login{kind: email|x, label?} opens a form where the user types the login.)
\`\`\`zetta:company_docs
{"action":"status"}
\`\`\`   (the user's Drive documents, searched by their bots. action status | enable | disable | sync. disable deletes every indexed copy.)
\`\`\`zetta:connection
{"action":"add","provider":"openai"}
\`\`\`   (API-key accounts. action list | add{provider: anthropic|openai|google|openrouter|github, label?} | revoke{connection}. add only opens a form where the user pastes the key: you never see it and must not ask for it in the chat.)
\`\`\`zetta:agenda_sync
{"action":"settings","enabled":true}
\`\`\`   (Google Calendar sync of the Agenda. action settings{enabled?, pushByDefault?, pushAccount?} | sync_now.)
\`\`\`zetta:wiki_admin
{"action":"unarchive","slug":"acme-billing"}
\`\`\`   (more for the wiki. action suggestions | restore{slug, version} | unarchive{slug} | decide_suggestion{suggestion: id, accept}. To read and write items use zetta:wiki.)
\`\`\`zetta:admin
{"action":"invite"}
\`\`\`   (only when the user is an administrator. action invite | installation: each opens a form for the user; you never see the invitation token.)
\`\`\`zetta:inbound_route
{"action":"interval","bot":"Support","plugin":"whatsapp","seconds":30}
\`\`\`   (how a bot's incoming-message route runs. action list | interval{bot, plugin, seconds: 20-3600} | poll_now{plugin}. To turn incoming messages on or off use zetta:inbound.)
\`\`\`zetta:browser_profile
{"action":"reset","profile":"b-123"}
\`\`\`   (the sign-ins a bot's browser saved. action list | reset{profile}: forget the sign-ins | remove{profile}: forget them and never start the profile again.)
\`\`\`zetta:decision
{"action":"get","bot":"Triage"}
\`\`\`   (the questions a decision bot answers by itself. action get{bot} | preview{bot, text}: what it would do with a message | set{bot, config: {enabled, backend: laya|jev, question, options: [{label, description, action: respond|ask_user|delegate|stop, targetBotId?, reply?}] (2 to 8), minConfidencePct 0-100}}.)
zetta:setup and zetta:inbound also take "bot" (a name or id) to act for one of the user's other bots instead of yourself.
For the task board, zetta:task also has {"action":"remove","id"} (a card) next to add, list and update; add and update take "priority" (none|low|medium|high|urgent) and "labels".`;
