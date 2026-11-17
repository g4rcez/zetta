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

A private bot, or your personal chief of staff, cannot hold a seat. The draft lists them under "Without a seat of their own", with the reason. Share a bot with the team and draw again if you want it in the chart.

After that, change the chart freely: drag a seat onto another to change who it reports to, put a person or a bot in a seat from the left panel, rename a seat, or open it for its own page.

## See which bots work together

The chart shows who reports to whom. It does not show who actually works together. Choose **Works with** in the "What to show" buttons (the address gets `show=links`) to draw dotted lines between bots that hold a seat and that really cooperate. A pair is joined when the two bots:

- are members of the same open room, or of a room that changed in the last 90 days;
- follow each other in one of your workflows;
- hand work to each other through a decision route.

The thicker the line, the more they share. Point at a line, or move to it with the keyboard, to read why: for example "Work together in 3 rooms, 1 workflow". The outline view lists the same pairs in words.

The layer reads your own rooms, workflows and decision routes, so two people can see different lines. It only reads: nothing is created or changed by looking.

## Get to a bot's seat

On a bot's settings page, in the Organization section, and in the details panel of a chat with the bot, you read "Reports to Ana · See on the chart". The link opens the chart with that seat in view.
