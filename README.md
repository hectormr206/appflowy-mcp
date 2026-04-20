# appflowy-mcp

Model Context Protocol server for AppFlowy Cloud. Lets Claude Code, OpenCode CLI, and any other MCP client read and write pages in your self-hosted AppFlowy.

## Tools (v0.2)

| Tool | What it does |
|------|--------------|
| `get_self` | Authenticated user profile |
| `list_workspaces` | Workspaces the user can access |
| `search` | Full-text / semantic search in a workspace |
| `fetch_page` | Get a page view by id (raw JSON incl. Yjs blob) |
| `fetch_page_markdown` | Fetch a page and render its Yjs document as markdown |
| `list_databases` | All databases in a workspace |
| `get_database_rows` | Rows + cells of a database |
| `get_database_fields` | Columns of a database (id, name, type) |
| `insert_database_row` | Insert a row with `cells` keyed by field id |
| `upsert_database_row` | Update (or insert) a row by `pre_hash` — see notes |
| `create_page` | New page (document / grid / board / calendar) |
| `rename_page` | Change a page's title |
| `append_to_page` | Append markdown content to a page |
| `duplicate_page` | Duplicate a page and its subtree |
| `move_page` | Move / reorder a page |

### What this MCP does NOT do

AppFlowy's document content is a CRDT managed via WebSocket (not REST). There is no "replace page body" endpoint — use `append_to_page` for adding content, and for in-place edits open AppFlowy directly.

Comments are not exposed via the REST API either. Not supported.

### Markdown rendering

`fetch_page_markdown` decodes the page's Yjs CRDT document client-side (via the `yjs` package) and renders it to markdown. Supported: headings, paragraphs, bulleted / numbered / todo / toggle lists, quotes, callouts, code blocks, dividers, images, bold / italic / strike / code / links. Page mentions are rendered as `[[page:UUID]]` placeholders. Unknown block types fall back to their inline text.

### Database row limitations

- AppFlowy-Cloud exposes no `DELETE` endpoint for database rows — deletion must be done in the AppFlowy UI.
- `upsert_database_row` takes a `pre_hash` string (not the raw row id). The server hashes `workspace_id + database_id + pre_hash` with SHA-256 to derive the actual row id. To update an existing row you must reuse the same `pre_hash` that created it — there is no server-side lookup from row id back to pre_hash.
- `cells` is a map keyed by `field_id` (from `get_database_fields`). Simple field types (text / number / checkbox) accept plain JSON values; rich types (date, select, relation) may require AppFlowy's internal cell encoding which is not fully documented in the REST layer.

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
