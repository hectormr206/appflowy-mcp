# appflowy-mcp

Model Context Protocol server for AppFlowy Cloud. Lets Claude Code, OpenCode CLI, and any other MCP client read and write pages in your self-hosted AppFlowy.

## Tools (v0.4 — 34 tools)

### Identity & navigation

| Tool | What it does |
|------|--------------|
| `get_self` | Authenticated user profile |
| `list_workspaces` | Workspaces the user can access |
| `search` | Full-text / semantic search in a workspace |
| `get_folder` | Page tree of a workspace (depth-limited) |

### Pages

| Tool | What it does |
|------|--------------|
| `fetch_page` | Get a page view by id (raw JSON incl. Yjs blob) |
| `fetch_page_markdown` | Fetch a page and render its Yjs document as markdown |
| `create_page` | New page (document / grid / board / calendar / chat) |
| `rename_page` | Change a page's title |
| `append_to_page` | Append markdown content to a page |
| `duplicate_page` | Duplicate a page and its subtree |
| `move_page` | Move / reorder a page |
| `trash_page` | Move a page to workspace trash |
| `restore_page` | Restore a trashed page |
| `list_trash` | List pages in the trash |
| `favorite_page` | Mark/unmark a page as favorite (optional `is_pinned`) |
| `list_favorites` | List favorited pages |
| `update_page_icon` | Set a page icon (`ty`: 0=Emoji, 1=Url, 2=Icon) |
| `remove_page_icon` | Remove a page's icon |

### Document editing (v0.4, in-place Yjs edits)

| Tool | What it does |
|------|--------------|
| `edit_page_block` | Replace the plain text of a block by `block_id` |
| `delete_page_block` | Remove a block (and its subtree) by `block_id` |
| `insert_page_block_before` | Insert a new block before a reference block |
| `insert_page_block_after` | Insert a new block after a reference block |
| `replace_page_content` | Wipe the page body and rewrite it from markdown |

### Databases

| Tool | What it does |
|------|--------------|
| `list_databases` | All databases in a workspace |
| `get_database_rows` | Rows + cells of a database |
| `get_database_fields` | Columns of a database (id, name, type) |
| `insert_database_row` | Insert a row with `cells` keyed by field id |
| `upsert_database_row` | Update (or insert) a row by `pre_hash` — see notes |

### Members

| Tool | What it does |
|------|--------------|
| `list_members` | Members of a workspace (email, role) |
| `invite_member` | Invite an email (roles: `Owner` / `Member` / `Guest`) |

### AI

| Tool | What it does |
|------|--------------|
| `ai_complete` | AI completion (improve / shorten / explain / ask / etc.) — returns concatenated streamed text |
| `ai_summarize_row` | Summarize a row's cells via AI |
| `ai_translate_row` | Translate a row's cells to a target language |
| `list_ai_models` | List AI models available for this workspace |

### How in-place document editing works (v0.4)

AppFlowy documents are Yjs CRDTs. v0.4 edits them by:

1. Fetching the page's `encoded_collab` via REST,
2. Loading it into an in-memory `Y.Doc`, capturing its state vector,
3. Mutating the block tree (edit / delete / insert / replace) in a single transaction,
4. Encoding the diff as a Yjs incremental update and POSTing it to `/api/workspace/v1/{ws}/collab/{object_id}/web-update` (AppFlowy-Cloud merges the update on the server the same way the WebSocket path does).

This is race-safe per-request (each call reads fresh state) but does NOT subscribe to live collab updates — if another client is typing at the same exact moment, your write lands as a concurrent Yjs update and is merged by the CRDT; the visible outcome may differ from what you expected to replace.

Block ids are visible in `fetch_page`'s raw `encoded_collab` payload; find them by decoding the Yjs doc yourself, or ship a small helper call if you need them routinely (not currently exposed as a tool).

**Known limits of v0.4 editing:**

- `edit_page_block` rewrites the block's `Y.Text` wholesale. Inline formatting (bold / italic / links / mentions) on the original text is **discarded** — the new text is plain.
- `replace_page_content`'s markdown parser handles headings, paragraphs, bullet/numbered/todo lists, `>` quotes and `---` dividers only. It does NOT parse inline `**bold**`, `*italic*`, links, code spans, or code fences — those arrive as literal characters in the paragraph text. Tables, images, and nested children are not emitted.
- `delete_page_block` on a block with children removes the whole subtree. Text nodes under `text_map` and children arrays under `children_map` are garbage-collected for the deleted root only (descendants' entries are orphaned — harmless but leaks a little Yjs state over time).
- No support for inserting rich-formatted inline text (Delta ops with attributes) via these tools.

Comments are not exposed via the REST API. Not supported.

### Markdown rendering

`fetch_page_markdown` decodes the page's Yjs CRDT document client-side (via the `yjs` package) and renders it to markdown. Supported: headings, paragraphs, bulleted / numbered / todo / toggle lists, quotes, callouts, code blocks, dividers, images, bold / italic / strike / code / links. Page mentions are rendered as `[[page:UUID]]` placeholders. Unknown block types fall back to their inline text.

### Database row limitations

- AppFlowy-Cloud exposes no `DELETE` endpoint for database rows — deletion must be done in the AppFlowy UI.
- `upsert_database_row` takes a `pre_hash` string (not the raw row id). The server hashes `workspace_id + database_id + pre_hash` with SHA-256 to derive the actual row id. To update an existing row you must reuse the same `pre_hash` that created it — there is no server-side lookup from row id back to pre_hash.
- `cells` is a map keyed by `field_id` (from `get_database_fields`). Simple field types (text / number / checkbox) accept plain JSON values; rich types (date, select, relation) may require AppFlowy's internal cell encoding which is not fully documented in the REST layer.

### Member / invite notes

- `invite_member` requires Owner role on the target workspace (the server enforces this).
- The server validates the email and sends an invitation mail via its configured mailer. Pass `skip_email_send: true` to create the invitation record without sending mail (useful for testing).
- Roles are `Owner` / `Member` / `Guest` (string enum on the wire).

### AI notes

- `ai_complete` hits AppFlowy-Cloud's `/api/ai/{wid}/complete/stream` endpoint. The endpoint streams `text/event-stream`; this MCP reads the full body and returns the concatenated text. For very long generations this blocks until completion.
- `completion_type` is a number (1–8) matching the server enum: 1=ImproveWriting, 2=SpellingAndGrammar, 3=MakeShorter, 4=MakeLonger, 5=ContinueWriting, 6=Explain, 7=AskAI, 8=CustomPrompt.
- `ai_summarize_row` takes `cells` as a plain `column -> value` object (the server's `Content` variant of `SummarizeRowData`). It does NOT look up a row by database/row id.
- `ai_translate_row` takes `cells` as an array of `{title, content}` items.
- All four AI tools require the AppFlowy AI sidecar service to be deployed and reachable from your AppFlowy-Cloud instance. On deployments without the AI service, `list_ai_models` returns 404, `ai_complete` returns 502, and `ai_summarize_row` / `ai_translate_row` return empty results with `code: 0` (the server's silent-fail behavior).

### Trash notes

- `trash_page` is reversible via `restore_page`. Hard deletion is only available in the AppFlowy UI.
- `list_trash` returns the full trash view list, including `deleted_at`.

## Install

```bash
npm install -g @hectormr206/appflowy-mcp
```

Or run directly with `npx`:

```bash
npx @hectormr206/appflowy-mcp
```

## Configure

Set these env vars before running:

| Var | Required | Notes |
|-----|----------|-------|
| `APPFLOWY_BASE_URL` | yes | e.g. `https://appflowy.hectormr.com` |
| `APPFLOWY_EMAIL` | yes* | AppFlowy login email |
| `APPFLOWY_PASSWORD` | yes* | AppFlowy login password |
| `APPFLOWY_GOTRUE_URL` | no | Defaults to `${BASE_URL}/gotrue` |
| `APPFLOWY_ACCESS_TOKEN` | no | Short-lived JWT; auto-refreshed if `refresh_token` is set |
| `APPFLOWY_REFRESH_TOKEN` | no | Longer-lived token from GoTrue |

\* You need either (`EMAIL`+`PASSWORD`) or (`ACCESS_TOKEN`+`REFRESH_TOKEN`). Email/password is simplest for self-hosted.

## Use with Claude Code

```bash
claude mcp add appflowy \
  --env APPFLOWY_BASE_URL=https://appflowy.hectormr.com \
  --env APPFLOWY_EMAIL=you@example.com \
  --env APPFLOWY_PASSWORD=... \
  -- npx -y @hectormr206/appflowy-mcp
```

## Use with OpenCode CLI

Add to `~/.config/opencode/config.json`:

```json
{
  "mcp": {
    "appflowy": {
      "type": "local",
      "command": ["npx", "-y", "@hectormr206/appflowy-mcp"],
      "environment": {
        "APPFLOWY_BASE_URL": "https://appflowy.hectormr.com",
        "APPFLOWY_EMAIL": "you@example.com",
        "APPFLOWY_PASSWORD": "..."
      }
    }
  }
}
```

## Develop

```bash
npm install
npm run dev   # ts-node loop for local testing
npm run build
```

Point Claude at the local build during development:

```bash
claude mcp add appflowy-dev -- node /abs/path/to/appflowy-mcp/dist/index.js
```
