# Trello plugin

- **Sign-in:** API key + token (your own Power-Up).
- **Tools:** boards, lists (with cards), search, create_card, move_card, comment.
- **Code:** `apps/server/src/modules/integrations/plugins/trello.ts`, tests in `new-plugins.test.ts` (faked API).

Get the key at trello.com/power-ups/admin, then the Token link next to it. Calls go only to https://api.trello.com/1; redirects are not followed.

Not verified against the live service: the endpoints follow the vendor's public API reference; check them with a real account before relying on them.
