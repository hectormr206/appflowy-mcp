# Example 03 — Query a database with filter + sort

**User prompt**

> Find all tasks in my Tasks database with status=Doing, sorted by updated
> descending.

**Expected tool calls**

1. `list_workspaces` — get `workspace_id`.
2. `list_databases` — find the database whose name is "Tasks"; capture
   `database_id` (which is also its `view_id` for the primary view).
3. `get_database_fields` — to know the `field_id` for "status" and "updated".
4. `query_database_rows` — with client-side filter + sort.

**Sample flow**

```json
// Step 1
list_workspaces({}) // => "ws_abc"

// Step 2
list_databases({ workspace_id: "ws_abc" })
// => [{ database_id: "db_tasks", name: "Tasks", view_id: "v_tasks_grid" }, ...]

// Step 3
get_database_fields({ workspace_id: "ws_abc", database_id: "db_tasks" })
// => [
//   { id: "f_title",   name: "Title",   field_type: 0 }, // RichText
//   { id: "f_status",  name: "Status",  field_type: 3 }, // SingleSelect
//   { id: "f_updated", name: "Updated", field_type: 8 }, // LastEditedTime
// ]

// Step 4
query_database_rows({
  workspace_id: "ws_abc",
  database_id: "db_tasks",
  filter: { field_id: "f_status", op: "equals", value: "Doing" },
  sort:   { field_id: "f_updated", direction: "desc" },
  limit: 50
})
// => { rows: [ { row_id, cells: { f_title: "...", f_status: "Doing", f_updated: 1776786272 } }, ... ] }
```

**Notes**

- AppFlowy-Cloud's REST has **no server-side filter/sort** on row endpoints.
  `query_database_rows` fetches rows via `/row/detail` and filters/sorts
  client-side — expect O(rows) memory. Not suitable for million-row databases.
- For `SingleSelect` / `MultiSelect` filters, pass the option **name** as the
  `value`. The tool resolves names to option ids via `get_database_fields`
  internally.
- When the user says "status=Doing", ALWAYS confirm by calling
  `get_database_fields` first — option labels can differ from what the LLM
  assumes.
