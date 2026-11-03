# Multiplayer rooms

Status: confirmed intent. Authority: the user confirmed the statement of intent in the product interview. The work is RFC-089 in [TASKS.md](../../TASKS.md#22-multiplayer-rooms). This intent changes one rule in [zetta-v1](zetta-v1.md) and [ownership](../decisions/ownership.md): a published snapshot is no longer the only way to share a conversation. Everything else in those documents stays.

## Intent

- **Outcome:** rooms become multiplayer. A team holds humans as well as bots. Every human in a team reads all rooms of that team with the full history, posts in them, and mentions bots. A private chat can be forked into a team room so people can continue it together.
- **Users:** teammates on the same Zetta installation who work together with bots.
- **Why now:** a snapshot is read-only. A teammate cannot continue a useful chat.
- **Membership:** on the team. The team owner adds and removes people. A multiplayer room is always a team room. A room without a team stays single-owner.
- **Personal bot in a room:** it runs with its owner's accounts. A request from another member waits for the owner's approval. The owner can approve once, or "always allow this person in this room". Trust is per teammate and per room.
- **Team Bot:** a bot set up for shared use. It runs with the team's shared accounts and uses team memory that members can read and correct. No member's private memory goes in. No approval is needed.
- **Nudge:** when a room has a personal bot and more than one human, Zetta tells the bot owner to set the bot up as a Team Bot.
- **Success:** Y joins X's team and mentions X's personal bot in a room. X gets an approval item and chooses "always allow". Later requests from Y run with X's accounts without a new question. A Team Bot answers anyone in the room with team accounts. Y never uses X's accounts without X's approval.
- **Constraint:** the server enforces every rule above. Credentials stay out of bot definitions and model context. Team accounts are a new kind of connection, because a connection belongs to one user today.
- **Out of scope:**
  - multiplayer 1:1 chats
  - live presence and typing indicators
  - co-editing artifacts or the wiki
  - cross-user bot calls outside rooms
  - push or email notifications
  - per-tool-call approval

## Phases

Each phase ships alone and leaves the app working. The RFC defines the phases; child files are written when a phase starts.

| Phase                              | RFC      | Gate                                 |
| ---------------------------------- | -------- | ------------------------------------ |
| Team human members (done)          | RFC-089a | schema change needs approval         |
| Authored messages and acting user  | RFC-089b | schema change needs approval         |
| Cross-user approval and room trust | RFC-089c | schema change needs approval         |
| Team accounts and Team Bots        | RFC-089d | schema and credential model approval |
| Team memory                        | RFC-089e | memory-scope decision recorded       |
| Fork a chat into a room, and nudge | RFC-089f | none                                 |

## Risks

- Once an owner approves a request, the personal bot's answer is visible to the whole room. That answer can include content that comes from the owner's memory or accounts. The approval card must say this.
- A shared room needs team-scoped unique indexes (room name, open key). Today they are per owner.
- Team accounts widen the credential boundary. The secret must stay sealed, and a Team Bot must never fall back to a personal connection.
- Existing rooms and messages have no author. A migration sets the author to the owner and loses no data.
- A removed member must lose access to the team, its rooms and the grants they gave or received.
