# Draw who leads what: the organization chart

[Wiki home](../README.md) · [Glossary](../glossary.md)

The organization chart shows who leads what in your company and who every person and bot reports to. You find it in the sidebar, under **Organization**. Everyone can read it. Only the administrator draws it.

## What the chart changes

The chart is not only a picture.

- **Bots read their seat.** A bot that holds a seat is told what the seat is for, what it may decide alone, what goes up to its manager, and who that manager is.
- **Escalation follows the chart.** When a bot is stuck, it asks the nearest manager above it who is actually there. A manager that is a bot answers in the help room. A manager that is a person is named in the request. Without a seat, the bot asks your chief, as before.

An empty chart changes nothing: bots work as they always did.

## Draw the first version

On an empty chart the administrator starts in one of three ways:

1. **Draw it from my teams.** Zetta drafts the chart from the teams you already have. Each team becomes a unit, the team's chief takes the leader seat, and the other bots of the team take a seat under the chief. You see the draft first, untick any team or bot that should stay out, and press **Create**. Nothing is saved before that.
2. **Use a structure** that is close to yours (solo founder, small startup, agency, product team, support desk).
3. **Start with just a CEO** and add seats one by one.

A personal chief of staff cannot hold a seat. A bot that you keep private can: you are asked first, because a seat is visible to the whole team (see below). The draft lists bots it could not seat under "Without a seat of their own", with the reason.

## Change the chart: one panel for every seat

Click a seat, on the chart or in the outline, and its panel opens beside the chart. Everything about that seat is there, so you never leave the page and nothing needs dragging. The address keeps the seat (`focus=`), so a link, a reload and Back show the same seat.

- **Held by.** Press **Assign a person or a bot** (or **Change who holds it**). The list has a **People** tab and a **Bots** tab. A search looks in both. Pick one and the seat is filled at once, or choose **Leave it open**.
- **Reports to.** Pick another manager and press **Move this seat**. **Earlier** and **Later** change its place among the seats that report to the same manager.
- **Add a seat under this one.** Two steps, who first: pick the person or the bot (or leave it open), then say what the seat is. Type a title or tap a role most teams have, choose a level, and press **Add seat**. One press creates the seat and fills it. **Or add a whole team** adds a ready-made group of seats.
- **Title, level and what it is responsible for.** Open the fold to rename a seat, set its unit and write what it is responsible for. Bots in the seat read these words before they work.
- **Remove this seat.** You are asked first. The seats under it report to its manager, and nobody is deleted.

To look around: scroll to move over the chart, pinch (or hold Ctrl and scroll) to zoom. Type in **Find a seat or a person** and press Enter to go to the first match, and Enter again for the next. The seat you choose is brought into view when it was out of sight.

### Putting a private bot in a seat

Your private bots are in the list, marked **Private**. Pick one and Zetta asks: "Share _Writer_ with the team?". Everyone in the team can then see the bot and talk to it, because a seat on the chart is visible to everyone who reads it. Press **Share and seat** to do both in one step, or **Cancel** to change nothing. You can share only your own bots: another member's private bot is not offered.

## See which bots work together

The chart shows who reports to whom. It does not show who actually works together. Choose **Works with** in the "What to show" buttons (the address gets `show=links`) to draw dotted lines between bots that hold a seat and that really cooperate. A pair is joined when the two bots:

- are members of the same open room, or of a room that changed in the last 90 days;
- follow each other in one of your workflows;
- hand work to each other through a decision route.

The thicker the line, the more they share. Point at a line, or move to it with the keyboard, to read why: for example "Work together in 3 rooms, 1 workflow". The outline view lists the same pairs in words.

The layer reads your own rooms, workflows and decision routes, so two people can see different lines. It only reads: nothing is created or changed by looking.

## Get to a bot's seat

On a bot's settings page, in the Organization section, and in the details panel of a chat with the bot, you read "Reports to Ana · See on the chart". The link opens the chart with that seat selected.
