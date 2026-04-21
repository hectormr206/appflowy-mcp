# Example 05 — Wire AppFlowy MCP into Claude Code / OpenCode

Real-world setup: use your self-hosted AppFlowy as a personal knowledge
base that Claude Code and OpenCode can read and write.

## Claude Code

```bash
claude mcp add appflowy \
  --env APPFLOWY_BASE_URL=https://appflowy.your-host.com \
  --env APPFLOWY_EMAIL=you@example.com \
  --env APPFLOWY_PASSWORD=... \
  -- npx -y @hectormr206/appflowy-mcp
```

Then in any Claude Code session:

> "Search my AppFlowy for notes about 'Yjs CRDT' and summarize the top 3
> results."

Claude will call `search`, then `fetch_page_markdown` per hit, then produce
a synthesis.

## OpenCode CLI

Add to `~/.config/opencode/config.json`:

```json
{
  "mcp": {
    "appflowy": {
      "type": "local",
      "command": ["npx", "-y", "@hectormr206/appflowy-mcp"],
      "environment": {
        "APPFLOWY_BASE_URL": "https://appflowy.your-host.com",
        "APPFLOWY_EMAIL": "you@example.com",
        "APPFLOWY_PASSWORD": "..."
      }
    }
  }
}
```

## Typical workflows

**Daily journal**
> "Create today's journal entry under Personal/Journal with a quick review
> of what I did today and tomorrow's top 3."

Tool calls: `get_folder` → `create_page` → `append_to_page`.

**Research scratchpad**
> "Append these three bullet points to my 'Reading list' page: …"

Tool calls: `search("Reading list")` → `append_to_page`.

**Task triage**
> "Show me tasks in Doing older than 7 days so I can reassess them."

Tool calls: `list_databases` → `get_database_fields` → `query_database_rows`
(client-side filter on status + last-edited).

**Bulk cleanup**
> "Trash all pages in Archive from before 2024."

Tool calls: `get_folder` → filter client-side → `trash_page` per match.
Ask the user for confirmation before destructive loops — never trash in
bulk without an explicit yes.

## Operating principles

- Prefer **read → confirm → write**: never create or delete based on a
  guess. Summarize the plan, ask, then act.
- When creating a page, always include its `view_id` in the response so the
  user can bookmark / open it.
- For repeated writes to the same page, `insert_page_block_after` is cheaper
  than `replace_page_content` — the latter wipes the page and loses block ids.
- Keep an eye on `list_trash` before claiming a page is "gone" — trash is
  reversible via `restore_page`.
