# Example 02 — Create a structured project brief

**User prompt**

> Create a project brief page under my General space with sections for
> Goals, Scope, and Timeline.

**Expected tool calls**

1. `list_workspaces` — get `workspace_id`.
2. `get_folder` — find the "General" space's `view_id`.
3. `create_page` — create an empty document under that parent.
4. `append_to_page` — append a markdown body with all three sections.

**Sample flow**

```json
// Step 1
list_workspaces({})
// => workspace_id = "ws_abc"

// Step 2
get_folder({ workspace_id: "ws_abc", depth: 2 })
// => locate child where name === "General"; capture view_id, e.g. "v_general"

// Step 3
create_page({
  workspace_id: "ws_abc",
  parent_view_id: "v_general",
  layout: 0,            // Document
  name: "Project brief — <project name>"
})
// => { data: { view_id: "v_new" } }

// Step 4
append_to_page({
  workspace_id: "ws_abc",
  view_id: "v_new",
  markdown: [
    "# Goals",
    "",
    "- Primary outcome: …",
    "- Secondary outcomes: …",
    "",
    "# Scope",
    "",
    "**In scope**",
    "- …",
    "",
    "**Out of scope**",
    "- …",
    "",
    "# Timeline",
    "",
    "| Phase | Dates | Owner |",
    "|-------|-------|-------|",
    "| Discovery | … | … |",
    "| Build | … | … |",
    "| Launch | … | … |"
  ].join("\n")
})
```

**Notes**

- `append_to_page` parses markdown into AppFlowy blocks (headings, lists,
  quotes, dividers) and inline marks (`**bold**`, `*italic*`, `` `code` ``,
  `[link](url)`). Tables are not yet parsed — they land as paragraphs. See
  README "Editing limits."
- If you expect to edit individual sections later, use
  `insert_page_block_after` keyed off a known `block_id` instead of blowing
  the page away with `replace_page_content`.
