# appflowy-mcp

Model Context Protocol server for AppFlowy Cloud. Lets Claude Code, OpenCode
CLI, and any other MCP client read and write pages, databases, and assets in
your self-hosted AppFlowy. 50 tools, all backed by verified AppFlowy-Cloud REST
routes — no fakes, no shadow state.

## Quickstart

```bash
# 1. Install
npm install -g @hectormr206/appflowy-mcp   # or use npx directly

# 2. Wire into Claude Code
claude mcp add appflowy \
  --env APPFLOWY_BASE_URL=https://appflowy.your-host.com \
  --env APPFLOWY_EMAIL=you@example.com \
  --env APPFLOWY_PASSWORD=... \
  -- npx -y @hectormr206/appflowy-mcp

# 3. In any Claude Code chat:
#   "List my AppFlowy workspaces."
# Claude invokes `list_workspaces` and returns the result.
```

That's it. See [examples/](examples/) for copy-pasteable prompts.

## Table of contents

- [Quickstart](#quickstart)
- [Install](#install)
- [Configure](#configure)
- [Use with Claude Code](#use-with-claude-code)
- [Use with OpenCode CLI](#use-with-opencode-cli)
- [Design principles](#design-principles)
- [Tools (v0.7 — 50 tools)](#tools-v07--50-tools)
  - [Identity & navigation](#identity--navigation)
  - [Pages](#pages)
  - [Publishing](#publishing)
  - [Document editing](#document-editing)
  - [Databases](#databases)
  - [Assets](#assets)
  - [Templates](#templates)
  - [Workspace](#workspace)
  - [Members](#members)
  - [AI](#ai)
- [How in-place document editing works](#how-in-place-document-editing-works)
- [Markdown rendering](#markdown-rendering)
- [Database rich cells](#database-rich-cells)
- [Asset upload](#asset-upload)
- [AI notes](#ai-notes)
- [Known limits (awaiting AppFlowy upstream)](#known-limits-awaiting-appflowy-upstream)
- [Develop](#develop)
- [Contributing](#contributing)

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

\* You need either (`EMAIL`+`PASSWORD`) or (`ACCESS_TOKEN`+`REFRESH_TOKEN`).

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

## Design principles

This MCP is a **thin adapter** over AppFlowy-Cloud's real REST capabilities. It does NOT:

- Invent features that the server does not expose.
- Create shadow state (side databases, hidden tables, caches of mutable state).
- Simulate endpoints that do not exist server-side.

If AppFlowy-Cloud does not expose something, this README documents the gap in [Known limits](#known-limits-awaiting-appflowy-upstream) as "not supported (awaiting upstream)" rather than shipping a fake tool. We'd rather ship 6 real tools than 10 with 4 broken. Every tool here is backed by a verified route in `src/api/*.rs` of AppFlowy-Cloud.

Two kinds of client-side work are allowed and clearly labeled:

1. **Client-side query over server data** — e.g. `query_database_rows` fetches row details via `/row/detail` and filters/sorts in memory because AppFlowy-Cloud's REST API has no server-side filter/sort. The tool description says so.
2. **Yjs CRDT edits** — document editing pulls the Yjs blob, mutates it locally, and posts an incremental update back to `/collab/{id}/web-update`. This is the same path AppFlowy Web uses; no shadow state.

## Tools (v0.7 — 50 tools)

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
| `get_recent_views` | List recently opened pages |
| `update_page_icon` | Set a page icon (`ty`: 0=Emoji, 1=Url, 2=Icon) |
| `remove_page_icon` | Remove a page's icon |

### Publishing

| Tool | What it does |
|------|--------------|
| `publish_page` | Publish a page to the workspace's public namespace |
| `unpublish_page` | Unpublish a page |
| `list_published_pages` | All published pages in a workspace with publish metadata |
| `get_published_page_info` | Publish info for a single view (slug, namespace, flags) |

### Document editing

In-place Yjs edits. See [How in-place document editing works](#how-in-place-document-editing-works).

| Tool | What it does |
|------|--------------|
| `edit_page_block` | Replace a block's text; `text` is parsed as inline markdown. `raw_delta` escape hatch for direct Yjs Delta ops |
| `delete_page_block` | Remove a block (and its subtree) by `block_id` |
| `insert_page_block_before` | Insert a new block before a reference block |
| `insert_page_block_after` | Insert a new block after a reference block |
| `replace_page_content` | Wipe the page body and rewrite it from markdown |

### Databases

| Tool | What it does |
|------|--------------|
| `list_databases` | All databases in a workspace |
| `get_database_rows` | Row ids of a database (no cell data) |
| `query_database_rows` | Fetch rows with **client-side** filter / sort / paging (AppFlowy-Cloud has no server-side query — see Known limits) |
| `list_database_views` | Views (Grid/Board/Calendar) belonging to a database |
| `create_database_view` | Create a new view on a database page |
| `get_database_fields` | Columns of a database (id, name, type) |
| `insert_database_row` | Insert a row with `cells` keyed by field id (raw wire-format values) |
| `upsert_database_row` | Update (or insert) a row by `pre_hash` — see notes |
| `insert_database_row_typed` | Friendly row insert with per-type value encoding |
| `upsert_database_row_typed` | Friendly upsert with per-type value encoding |

### Assets

| Tool | What it does |
|------|--------------|
| `upload_asset` | Single-PUT upload to workspace blob storage; returns `{file_id, url}` |
| `upload_asset_large` | Multi-part upload for large files. Falls back to single-PUT for files under `part_size_mb` |

### Templates

| Tool | What it does |
|------|--------------|
| `list_templates` | List templates from the AppFlowy template center (public) |
| `get_template` | Get a single template (with publish info) |
| `list_template_categories` | List template categories |

### Workspace

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
| `ai_complete` | AI completion — returns concatenated streamed text |
| `ai_summarize_row` | Summarize a row's cells via AI |
| `ai_translate_row` | Translate a row's cells to a target language |
| `list_ai_models` | List AI models available for this workspace |

## How in-place document editing works

AppFlowy documents are Yjs CRDTs. This MCP edits them by:

1. Fetching the page's `encoded_collab` via REST,
2. Loading it into an in-memory `Y.Doc`, capturing its state vector,
3. Mutating the block tree (edit / delete / insert / replace) in a single transaction,
4. Encoding the diff as a Yjs incremental update and POSTing it to `/api/workspace/v1/{ws}/collab/{object_id}/web-update` (AppFlowy-Cloud merges the update on the server the same way the WebSocket path does).

This is race-safe per-request (each call reads fresh state) but does NOT subscribe to live collab updates — if another client is typing at the exact same moment, your write lands as a concurrent Yjs update and is merged by the CRDT.

Block ids are visible in `fetch_page`'s raw `encoded_collab` payload; find them by decoding the Yjs doc yourself, or render the page with `fetch_page_markdown` first to confirm structure.

**Editing limits:**

- `edit_page_block` / `replace_page_content` parse `**bold**`, `*italic*`/`_italic_`, `` `code` ``, `~~strike~~`, and `[text](url)` into Yjs Delta ops with proper attributes. A `raw_delta` escape hatch is available for power users.
- Block structure (headings / lists / todos / quotes / dividers) is emitted; tables and nested children from markdown are NOT.
- `delete_page_block` on a block with children removes the whole subtree. Yjs `text_map` / `children_map` entries for descendants may orphan (harmless).
- Mentions (`@`/page-links) are emitted when reading via `fetch_page_markdown` but the inline parser does NOT generate them on write.

## Markdown rendering

`fetch_page_markdown` decodes the page's Yjs CRDT document client-side and renders it to markdown. Supported: headings, paragraphs, bulleted / numbered / todo / toggle lists, quotes, callouts, code blocks, dividers, images, bold / italic / strike / code / links. Page mentions render as `[[page:UUID]]` placeholders. Unknown block types fall back to their inline text.

## Database rich cells

`insert_database_row_typed` / `upsert_database_row_typed` take `fields: [{field_id, field_type?, value}]`. The tool fetches `get_database_fields` internally, validates `field_type` per id (if provided), encodes each value for the on-wire format, and submits. `field_type` can be a numeric code or the name string (`"SingleSelect"`, `"DateTime"`, etc.).

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

- `Time`, `Media`, `Summary`, `Translate`, `LastEditedTime`, `CreatedTime` — **no friendly encoder**. `CreatedTime` / `LastEditedTime` are server-managed anyway.
- `SingleSelect` / `MultiSelect` / `Checklist`: wire format accepted by `convert_json_to_cell`; names resolve to ids using the current field's `type_option.content.options`. **Known quirk**: when options were added via REST with `type_option_data`, `row/detail` may return the cell as `""` / `[]` even though the write landed. Verify in the AppFlowy desktop client, or use databases whose options were created via the UI.
- `Relation` and `Checklist` were wired per the upstream structs but not yet exercised against a live database with a Relation field.
- If the field type on the server does not match the `field_type` you pass, the tool rejects the request client-side before calling the API.

**Row deletion** is not supported — AppFlowy-Cloud has no DELETE route for database rows. Delete via the desktop UI.

## Asset upload

`upload_asset(workspace_id, file_path, parent_dir?, mime_type?)` reads the local file, PUTs it to `/api/file_storage/{workspace_id}/v1/blob/{parent_dir}`, and returns `{file_id, parent_dir, name, url}`. The server computes the `file_id` as a hash of the content, so re-uploading the same bytes is idempotent.

- Default `parent_dir` is the workspace_id. Pass a logical sub-bucket to organize.
- `mime_type` is auto-guessed for common types (png/jpg/gif/webp/svg/pdf/txt/md/json); otherwise pass explicitly.
- Returned `url` is relative; fetch with the same bearer token.
- **Not wired into `update_page_icon`**: icons accept emoji / icon id / external URL only, not uploaded blobs (AppFlowy-Cloud limitation).
- For large files, `upload_asset_large` wraps `create_upload` / `upload_part` / `complete_upload` and streams chunks. Auto-falls-back to single-PUT for files ≤ `part_size_mb` (default 5). `file_id` is a streaming SHA-256 digest of the content + extension.

## AI notes

- `ai_complete` hits `/api/ai/{wid}/complete/stream`. The endpoint streams `text/event-stream`; this MCP reads the full body and returns the concatenated text — long generations block until completion.
- `completion_type` is a number (1–8): 1=ImproveWriting, 2=SpellingAndGrammar, 3=MakeShorter, 4=MakeLonger, 5=ContinueWriting, 6=Explain, 7=AskAI, 8=CustomPrompt.
- `ai_summarize_row` takes `cells` as a `column -> value` object.
- `ai_translate_row` takes `cells` as an array of `{title, content}` items.
- All four AI tools require the AppFlowy AI sidecar. On deployments without it, `list_ai_models` → 404, `ai_complete` → 502, row-AI tools → empty results with `code: 0`.

## Known limits (awaiting AppFlowy upstream)

These are **upstream gaps in AppFlowy-Cloud**, not MCP design choices. Each was verified by grepping `AppFlowy-Cloud/src/api/*.rs` and the `libs/shared-entity` DTOs for the backing route.

| Feature | Status | Detail |
|---------|--------|--------|
| Database row **DELETE** | Not supported | No DELETE route on `/workspace/{wid}/database/{did}/row`. Desktop UI only. |
| **Server-side** database filter/sort | Not supported | No query params on row endpoints; `query_database_rows` filters client-side. |
| **Comments** on live pages | Not supported | REST comments exist only for published pages. |
| **Live cursors / presence** | Not supported | Presence is WebSocket-only; this MCP is stdio-REST. |
| **Reminders** | Not supported | No `/reminder` endpoints; reminders live inside `DateTime` cells. |
| **Page icon from uploaded blob** | Not supported | `update_page_icon` accepts emoji / URL / icon-id only. |
| **Offline / incremental sync** | Not supported | No cursor / "since" token on most list endpoints. |
| **Templates: instantiate** | Not supported | `/api/template-center/template` is read-only. |
| **Database view filter/sort config** | Partial | View creation works; filter/sort rules are in Yjs collab, not REST. |
| **Workspace usage detail** | Partial | `get_workspace_usage` returns total bytes only. |

If AppFlowy-Cloud adds any of these, bump a new version and wire them up.
Track issues at https://github.com/AppFlowy-IO/AppFlowy-Cloud/issues.

## Develop

```bash
npm install
npm run dev     # run from source via tsx
npm run build   # typecheck + compile to dist/
npm test        # unit tests (node:test + tsx)
npm run smoke   # opt-in E2E against a real instance; no-ops without creds
```

Point Claude at the local build during development:

```bash
claude mcp add appflowy-dev -- node /abs/path/to/appflowy-mcp/dist/index.js
```

## Contributing

See [CONTRIBUTING.md](CONTRIBUTING.md) for repo layout, the "adding a new tool"
checklist, and the release process.
