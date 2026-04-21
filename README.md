# appflowy-mcp

Model Context Protocol server for AppFlowy Cloud. Lets Claude Code, OpenCode CLI, and any other MCP client read and write pages in your self-hosted AppFlowy.

## Design principles

This MCP is a **thin adapter** over AppFlowy-Cloud's real REST capabilities. It does NOT:

- Invent features that the server does not expose.
- Create shadow state (side databases, hidden tables, caches of mutable state).
- Simulate endpoints that do not exist server-side.

If AppFlowy-Cloud does not expose something, this README documents the gap in [Known limits](#known-limits-awaiting-appflowy-upstream) as "not supported (awaiting upstream)" rather than shipping a fake tool. We'd rather ship 6 real tools than 10 with 4 broken. Every tool here is backed by a verified route in `src/api/*.rs` of AppFlowy-Cloud.

Two kinds of client-side work are allowed and clearly labeled:

1. **Client-side query over server data** — e.g. `query_database_rows` fetches row details via `/row/detail` and filters/sorts in memory because AppFlowy-Cloud's REST API has no server-side filter/sort. The tool description says so.
2. **Yjs CRDT edits** — document editing pulls the Yjs blob, mutates it locally, and posts an incremental update back to `/collab/{id}/web-update`. This is the same path AppFlowy Web uses; no shadow state.

## Tools (v0.6 — 50 tools)

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
| `get_recent_views` | v0.6 — List recently opened pages (GET `/workspace/{wid}/recent`) |
| `update_page_icon` | Set a page icon (`ty`: 0=Emoji, 1=Url, 2=Icon) |
| `remove_page_icon` | Remove a page's icon |

### Publishing (v0.6)

| Tool | What it does |
|------|--------------|
| `publish_page` | Publish a page to the workspace's public namespace |
| `unpublish_page` | Unpublish a page |
| `list_published_pages` | All published pages in a workspace with publish metadata |
| `get_published_page_info` | Publish info for a single view (slug, namespace, flags) |

### Document editing (v0.4–0.6, in-place Yjs edits)

| Tool | What it does |
|------|--------------|
| `edit_page_block` | v0.6 — Replace a block's text; `text` is parsed as inline markdown (bold/italic/code/strike/links). `raw_delta` escape hatch for direct Yjs Delta ops |
| `delete_page_block` | Remove a block (and its subtree) by `block_id` |
| `insert_page_block_before` | Insert a new block before a reference block |
| `insert_page_block_after` | Insert a new block after a reference block |
| `replace_page_content` | v0.6 — Wipe the page body and rewrite it from markdown (now parses inline marks within each block) |

### Databases

| Tool | What it does |
|------|--------------|
| `list_databases` | All databases in a workspace |
| `get_database_rows` | Row ids of a database (no cell data) |
| `query_database_rows` | v0.6 — Fetch rows with **client-side** filter / sort / paging (AppFlowy-Cloud has no server-side query — see Known limits) |
| `list_database_views` | v0.6 — Views (Grid/Board/Calendar) belonging to a database |
| `create_database_view` | v0.6 — Create a new view on a database page |
| `get_database_fields` | Columns of a database (id, name, type) |
| `insert_database_row` | Insert a row with `cells` keyed by field id (raw wire-format values) |
| `upsert_database_row` | Update (or insert) a row by `pre_hash` — see notes |
| `insert_database_row_typed` | v0.5 — friendly row insert with per-type value encoding |
| `upsert_database_row_typed` | v0.5 — friendly upsert with per-type value encoding |

### Assets

| Tool | What it does |
|------|--------------|
| `upload_asset` | v0.5 — Single-PUT upload to workspace blob storage; returns `{file_id, url}` |
| `upload_asset_large` | v0.6 — Multi-part upload for large files (chunked). Falls back to single-PUT for files under `part_size_mb` |

### Templates (v0.6, read-only)

| Tool | What it does |
|------|--------------|
| `list_templates` | List templates from the AppFlowy template center (public) |
| `get_template` | Get a single template (with publish info) |
| `list_template_categories` | List template categories |

### Workspace (v0.6)

| Tool | What it does |
|------|--------------|
| `get_workspace_usage` | Total document bytes used by the workspace (Owner role required) |

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

**Editing limits:**

- v0.6 FIXED: `edit_page_block` now parses `**bold**`, `*italic*`/`_italic_`, `` `code` ``, `~~strike~~`, and `[text](url)` into Yjs Delta ops with proper attributes. The previous "discards formatting" behavior only applied to v0.4/v0.5. A `raw_delta` escape hatch is available for power users.
- v0.6 FIXED: `replace_page_content` parses the same inline marks per block.
- Still plain: block structure (headings / lists / todos / quotes / dividers) is emitted; tables and nested children from markdown are NOT.
- `delete_page_block` on a block with children removes the whole subtree. Yjs `text_map` / `children_map` entries for descendants may orphan (harmless).
- Mentions (`@`/page-links) are emitted when reading via `fetch_page_markdown` but the inline parser does NOT generate them on write.

### Markdown rendering

`fetch_page_markdown` decodes the page's Yjs CRDT document client-side (via the `yjs` package) and renders it to markdown. Supported: headings, paragraphs, bulleted / numbered / todo / toggle lists, quotes, callouts, code blocks, dividers, images, bold / italic / strike / code / links. Page mentions are rendered as `[[page:UUID]]` placeholders. Unknown block types fall back to their inline text.

### Database row limitations

- AppFlowy-Cloud exposes no `DELETE` endpoint for database rows — deletion must be done in the AppFlowy UI.
- `upsert_database_row` / `upsert_database_row_typed` take a `pre_hash` string (not the raw row id). The server hashes `workspace_id + database_id + pre_hash` with SHA-256 to derive the actual row id. To update an existing row you must reuse the same `pre_hash` that created it — there is no server-side lookup from row id back to pre_hash.
- Raw `cells` (on `insert_database_row` / `upsert_database_row`) is a map keyed by `field_id`. Simple field types (text / number / checkbox) accept plain JSON values; rich types need AppFlowy's internal cell encoding — prefer the `_typed` variants below.

### Database rich cells (v0.5)

`insert_database_row_typed` and `upsert_database_row_typed` take `fields: [{field_id, field_type?, value}]`. The tool fetches `get_database_fields` internally, validates `field_type` per id (if you pass it), encodes each value for the on-wire format, and submits. `field_type` can be a numeric code or the name string (`"SingleSelect"`, `"DateTime"`, etc.).

Friendly input per field type (derived from `AppFlowy-Collab` `collab-database` `TypeOptionCellWriter::convert_json_to_cell`):

| Field type | Accepted `value` shapes | Example |
|------------|-------------------------|---------|
| `RichText` | string (anything else is stringified) | `"hello"` |
| `Number` | number or numeric string | `42` or `"3.14"` |
| `URL` | string | `"https://appflowy.io"` |
| `Checkbox` | bool, `"Yes"`/`"No"`, `"true"`/`"false"`, number | `true` |
| `DateTime` | unix-seconds number, OR `{timestamp, end_timestamp?, include_time?, is_range?, reminder_id?}` | `{timestamp: 1776786272, include_time: true}` |
| `SingleSelect` | array of option names OR ids OR `{id}` / `{name}` (first element wins) | `["Doing"]` |
| `MultiSelect` | array of option names OR ids OR `{id}` / `{name}` | `["urgent","work"]` |
| `Checklist` | array of strings (all selected) OR `{options: [name\|{name}], selected?: [name\|id]}` | `["buy milk","pay rent"]` |
| `Relation` | array of row_ids OR `{row_ids: [...]}` | `["<row-uuid-1>", "<row-uuid-2>"]` |

**Partial support / caveats:**

- `Time`, `Media`, `Summary`, `Translate`, `LastEditedTime`, `CreatedTime` — **no friendly encoder**. Writes for these are not supported by `_typed`; `CreatedTime`/`LastEditedTime` are server-managed anyway.
- `SingleSelect` / `MultiSelect` / `Checklist`: the wire format (`SelectOptionIds` / `ChecklistCellData`) is accepted by the server's `convert_json_to_cell`, and options you provide by name are resolved to ids using the current field's `type_option.content.options` list. **Known behavior**: when the database's select options were added via the REST `POST /fields` endpoint with `type_option_data`, AppFlowy-Cloud's `row/detail` renderer may return the select cell as `""` / `[]` even though the cell was accepted by the server. This appears to be a mismatch between the field's persisted TypeOption and the read-back resolver — verify writes in the AppFlowy desktop client, or on databases whose options were created via the UI.
- `Relation` and `Checklist` were wired per the upstream structs (`RelationCellData {row_ids}`, `ChecklistCellData {options, selected_option_ids}`) but were not exercised against a live database with a Relation field — report back if you hit unexpected behavior.
- If the field type on the server does not match the `field_type` you pass, the tool rejects the request client-side before calling the API.

### Asset upload (v0.5)

`upload_asset(workspace_id, file_path, parent_dir?, mime_type?)` reads the local file, PUTs it to `/api/file_storage/{workspace_id}/v1/blob/{parent_dir}` with the appropriate `Content-Type` + `Content-Length`, and returns `{file_id, parent_dir, name, url}`. The server computes the `file_id` as a hash of the content, so re-uploading the same bytes is idempotent.

- Default `parent_dir` is the workspace_id. You can pass a logical sub-bucket name; this becomes part of the object key.
- `mime_type` is auto-guessed from the file extension for common types (png/jpg/jpeg/gif/webp/svg/pdf/txt/md/json); otherwise you must pass it explicitly.
- The returned `url` is the relative GET path. To fetch the asset you authenticate with the same bearer token.
- **Not wired into existing tools**: `update_page_icon` takes emojis / icon identifiers / external URLs, not file_ids — AppFlowy does not currently accept an uploaded blob as a page icon via the REST API. For now, upload the asset, then reference it from block content (e.g. an `image` block) or a URL cell.
- For large files (>5MB or anything risking memory pressure), use `upload_asset_large` — it wraps AppFlowy-Cloud's `create_upload` / `upload_part` / `complete_upload` multipart flow and streams chunks from disk. It automatically falls back to single-PUT for files ≤ `part_size_mb` (default 5). `file_id` is computed client-side as a streaming SHA-256 hex digest of the content (+ file extension).

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

### Known limits (awaiting AppFlowy upstream)

These are **upstream gaps in AppFlowy-Cloud**, not MCP design choices. Each was verified by grepping `AppFlowy-Cloud/src/api/*.rs` and the `libs/shared-entity` DTOs for the backing route; where no route exists the MCP ships no tool rather than a fake.

| Feature | Status | Detail |
|---------|--------|--------|
| Database row **DELETE** | Not supported | No DELETE route on `/workspace/{wid}/database/{did}/row`. Deletion only via desktop UI. |
| **Server-side** database filter/sort | Not supported | `query_database_rows` filters in memory after fetching via `/row/detail`. No query params (`filter`, `sort`, `where`) on the REST row endpoints. |
| **Comments** on live (non-published) pages | Not supported | REST comments exist only for `/published-info/{view_id}/comment` (public pages). No private-page comment API. |
| **Live cursors / presence** | Not supported | Presence is WebSocket-only; this MCP is stdio-REST only. |
| **Reminders** | Not supported | No `/reminder` endpoints in AppFlowy-Cloud. Reminders live inside `DateTime` cells (`reminder_id` field) — not a first-class API. |
| **Page icon from uploaded blob** | Not supported | `update_page_icon` accepts emoji / URL / icon-identifier only; no file_id variant. |
| **Offline / incremental sync** | Not supported | No pagination cursor, no "since" token on most list endpoints. `list_database_row_updated` takes `after: DateTime` but the others are full-list fetches. |
| **Templates: create from template** | Not supported | `/api/template-center/template` is read-only (`GET` + admin-gated `POST`/`PUT`/`DELETE`). No "instantiate this template into my workspace" endpoint. |
| **Database view filter/sort config** | Partial | `create_database_view` creates an empty view; the view's own filter/sort rules live inside the database's Yjs collab doc and are not editable via REST. |
| **Workspace usage detail** | Partial | `get_workspace_usage` returns `total_document_size` (bytes) only. No per-file, per-user, or storage-quota detail. |

If AppFlowy-Cloud adds any of these, bump a new version and wire them up. Track issues at https://github.com/AppFlowy-IO/AppFlowy-Cloud/issues.

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
