# Sidebar navigation: research plan

The workspace sidebar now shows every destination at once, grouped by purpose (People, Knowledge, Tools, Build). The grouping is a hypothesis. This plan tests it with a few people in about one week. The product keeps no page-usage data (no analytics, no recent pages, no visit counts), so we ask people instead.

## Objectives

1. Which destinations do administrators and members use every day, and which can they not find?
2. Do people expect the same groups we chose (People, Knowledge, Tools, Build)?
3. Is it faster and surer to find a page now than with the old collapsible groups?

## Method

6 to 8 people: 2 administrators and 4 to 6 members of a team workspace. About 40 minutes each, remote, screen shared.

1. **Interview (10 minutes).** "What do you open first? What do you search for? What did you give up looking for?"
2. **Open card sort (15 minutes).** The 24 cards below, each with its page name and a one-line description. People make their own groups and name them. Compare with People / Knowledge / Tools / Build.
3. **First-click test (10 minutes).** A screenshot of the new sidebar for each of the 8 tasks below. Record the first click and the time. People who started with the old sidebar do the new one second, and the other way round (counterbalanced), so the two can be compared.
4. **Close (5 minutes).** "Which name would you change? What is missing?"

## Cards (24 destinations)

Inbox, Tasks, Projects, Routines, Calendar, Bots, Rooms, Teams, Organization, People, Memory, Skills, Lessons, Artifacts, Plugins, Apps, Mail, Studio, Playground, Computer, Phone numbers, Voice, Workflows, Server settings.

## First-click tasks (8)

1. Connect WhatsApp.
2. Find what a bot remembers.
3. Invite a colleague.
4. Check an approval waiting for you.
5. Change the speech settings.
6. Create a routine.
7. See all rooms.
8. Open the phone numbers page.

## Success measures

- The first click is correct on at least 80% of the tasks.
- The median time to the first click is lower than on the old sidebar.
- No destination is placed under another heading by three or more people in the card sort.
- Clicks to reach any grouped destination: 2 before (open the group, then the link), 1 now. The browser script `scripts/e2e/sidebar.ts` records this.

## Deliverables

- A one-page synthesis before the grouping is frozen: themes, quotes, and the changes to section names or membership. Section names are one-line changes (`PURPOSES` in `apps/web/src/components/app-sidebar.tsx`).
- The raw card-sort table and the first-click results, without names (use participant numbers).
- Not covered here: screen-reader use. A person with VoiceOver should read each section as a named list and walk the rows with the arrow keys.
