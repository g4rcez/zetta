# Figma plugin

- **Sign-in:** a personal access token (sealed field `token`). No OAuth in this version.
- **Tools:** `file_structure`, `frame_details`, `render_frames`, `list_comments` (reads); `post_comment` (a write, always asks first).
- **Code:** `apps/server/src/modules/integrations/plugins/figma.ts` (approval helper: `approval.ts`), tests in `figma.test.ts` (faked Figma, no network).

## Setup

In Figma open Settings > Security and generate a personal access token with the scopes `file_content:read`, `file_comments:read`, `file_comments:write` (only if bots may comment) and `current_user:read`. Paste it in the plugin. The token's account must be able to open the files you give bots.

Every tool takes `file`: a Figma link (`figma.com/design/<key>/...`, also `file`, `board`, `proto` and branch links) or the bare file key. A `node-id` in the link is read (Figma writes it with a dash, the API wants a colon) and used when the call has no `nodeId`.

## What each tool does

| Tool             | Figma call                                        | Result                                                                                                           |
| ---------------- | ------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------- |
| `file_structure` | `GET /v1/files/:key?depth=2` (or 3)               | Pages and their top-level frames: id, name, type, size. Depth 3 also names the first children of each frame.     |
| `frame_details`  | `GET /v1/files/:key/nodes?ids=&depth=`            | One node trimmed to size, layout (direction, gap, padding), text and font, fill colors, radius, component names. |
| `render_frames`  | `GET /v1/images/:key?ids=&format=png\|svg&scale=` | Up to 10 nodes rendered, downloaded and saved under `outputs/figma/` in your code folder; the paths come back.   |
| `list_comments`  | `GET /v1/files/:key/comments`                     | Newest first: author, text, time, resolved, the frame it sits on.                                                |
| `post_comment`   | `POST /v1/files/:key/comments`                    | Posts a comment, optionally on a frame or as a reply, after you approve it.                                      |

## Safety

- Names, text and comments in a file were written by other people. Results are framed as untrusted data, control characters are stripped, and each result is cut to the platform's 8000 character budget (`file_structure` drops frames and says how many; `frame_details` drops nodes and marks `truncated`).
- `post_comment` never posts on its own. It stops with an Approve card that shows the exact text, the file and the frame. The call is signed with your token inside the request, so the card cannot be changed afterwards, another user cannot answer it, and it expires after 30 minutes. Declining posts nothing. Comments are posted under the token owner's name and everyone with access to the file sees them.
- The token is sent only to `api.figma.com`, redirects are never followed, and the token is in no result, error or card.
- Rendered images are downloaded only from the address Figma's image service returns, and only when its host is Figma's own storage (`figma-*.s3.*.amazonaws.com` or `*.figma.com`), over https, without the token. Any other address is refused, so a private network address is never fetched.
- A 429 answer says how long Figma asks to wait (`Retry-After`) and, for Viewer or Collab seats, that the seat has a low request limit.

Not verified against the live service: the endpoints, parameters and scopes follow Figma's public REST API reference (checked in November 2026), and the tests use a fake Figma. No real token or file was used. Try it with a real token before relying on it, in particular the image host check against a real render.
