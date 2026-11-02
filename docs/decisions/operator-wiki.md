# Operator wiki

Status: implemented 2026-10-29 as a page store; extended 2026-11-02 into the unified wiki below. Code: `apps/server/src/modules/wiki`, schema `packages/db/src/schema/wiki.ts`, web `apps/web/src/features/wiki` (`/wiki`, `/wiki/<slug>`).

## Problem

Hermes memory ([hermes-memory](hermes-memory.md)) keeps a few short facts and puts all of them in every prompt. Instructions keep ordered steps. Nothing kept what a bot learned while doing a task (where a thing is, how a system behaves, why a choice was made, a problem and its fix), so the next bot did the same work again.

## Decision

A wiki of Markdown pages, one topic per page, in Postgres. The ideas come from [OpenWiki](https://github.com/langchain-ai/openwiki): concept pages with links (`[[slug]]`), search and read tools that make no model calls, evidence for facts, and only rewriting what is out of date. OpenWiki keeps files in a git repository for one person; Zetta has many members and an access policy, so pages are rows with an owner.

| Store        | Holds                                                     | In the prompt                                                                 |
| ------------ | --------------------------------------------------------- | ----------------------------------------------------------------------------- |
| Memory       | Short facts about the user and the bot                    | All of it                                                                     |
| Instructions | Ordered steps                                             | An index; the bot loads one                                                   |
| Wiki         | What and why: clients, systems, decisions, known problems | Up to 5 matching titles and summaries; the bot reads a page with `zetta:wiki` |

## Rules

- **Owner.** A page belongs to one user. The asker's wiki is used, never the bot owner's (same rule as memory).
- **Versions.** Every save writes `wiki_revision`. Bots write directly; a person can restore any version.
- **Safety.** Secrets are refused from anyone. Injection phrasing is refused from bots. Writes are blocked after outside content in the same turn (`PERSISTENT_WRITES`). Page text goes into prompts as data, with code fences defused. Turns with outside people (`noCode`) get no wiki index, and the tool is denied for inbound chats.
- **Sharing.** Only the owner, in Studio, publishes a page (`scope = installation`). Every active member's bots read it; they cannot write it and send a `wiki_suggestion` instead. The owner accepts (refused when the page changed after the suggestion was written) or rejects. A shared slug is unique in the installation. Removing a member hides their shared pages at once. See [ownership](ownership.md).
- **Learning.** The ticker queues one `wiki_job` for each task or goal loop of a chat (not inbound, not group transcripts) that finished in the last day, and runs it 2 minutes later. The job runs that bot once over the chat, without code access, and applies only its `zetta:wiki` writes. The finished task and the company documents the chat used become the page's evidence. The owner gets a notification that lists the changes. `ZETTA_WIKI_LEARN=off` stops new jobs.
- **Evidence.** `wiki_source` links a page to a task, company document, artifact or https address, with the version seen. Every 5 minutes, a check compares tasks, documents and artifacts with what they are now. A change or a deletion marks the page stale (author `system`) and notifies the owner. A full save measures the evidence again.
- **Checks and review.** Studio shows broken links, pages with no links, pages not saved for 90 days, stale pages and pages without evidence. "Ask the chief to review" queues a review job: the chief gets these checks and the newest pages, and fixes contradictions, duplicates and links through the same `zetta:wiki` writes.

## Limits

- Search is per page: embeddings come from title, summary and the start of the body (2000 characters). Keyword search needs every word. With `ZETTA_EMBEDDING=off`, the prompt index only finds pages that contain every word of the message.
- URLs are kept as evidence but never fetched again.
- The review job sees at most 30 pages; contradictions in older pages are found only through the checks list.

## Unified wiki (2026-11-02)

Memory, instructions, Drive documents and wiki pages are one concept: a **wiki item**. The old `memory`, `instruction` and `knowledge_chunk` tables, `/api/memories`, `/api/instructions`, `zetta:remember`, `zetta:instruction` and the Knowledge and Instructions tabs are gone. Rows kept their ids, so old answers and citations still resolve.

- **Fields.** `title`, `content` (Markdown), `howto` (when and how to use it, shown in search results and embedded with every chunk), `tags`, `score` (0 to 100, how important), `type`, `status`, the author bot, and a version history.
- **Who reads it (`type`).** `solo`: only the bot that wrote it (a bot's own notes). `owner`: all of the owner's bots. `teams`: bots in the listed teams (`wiki_page_team`). `all`: every active member of the installation; only a person publishes, never a bot.
- **Graph.** `[[slug]]` is a `related` link; `[[depends-on:slug]]`, `[[part-of:slug]]` and `[[supersedes:slug]]` are typed. Links are rebuilt from the content on every save (`wiki_link`) and resolve by slug against what the reader can see, so a graph never shows an item the reader may not read. `GET /api/wiki-graph` returns every readable item and link; the Wiki page draws it.
- **What goes in every prompt.** The bot's `solo` items and the person's `owner` items tagged `profile`, best score first, within 2200 and 1375 characters (at most 64 each). Everything else is found by search.
- **Search.** Keywords (any content word for a long message), tags, and the nearest chunks by meaning, fused by reciprocal rank and scaled by score. Filters (type, tags, status, whose, author, team, score, age) apply before ranking. Each result says why it matched (words, tag, meaning) with the passage. Procedures (tag `instruction`) that fit a message are shown in full.
- **Drive.** Each indexed document is an `owner` item tagged `drive`, linked back through `knowledge_doc.page_id` so a sync updates the same item. Its title and text are the document's and cannot be edited or shared; the whole text stays in the chunks. The same file reached through two Google accounts is one item.
- **Wiki page.** `/wiki` has filters, "Ask the wiki" (the chief answers in place with cited items), a health panel with one fix per problem, a graph view, and the Drive and feed settings. `/wiki/<slug>` has the item, its links by relation, sources and versions, `[[` autocomplete, an Add link panel, and editor help that suggests tags, a how-to line, a score, links or a tidier text. Help runs on the chief, never receives a draft that looks like a secret, and changes nothing until the person accepts and saves.
