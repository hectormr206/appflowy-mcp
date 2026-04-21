# Example 01 — List recent work

**User prompt**

> Show me my 5 most recently edited AppFlowy pages.

**Expected tool calls**

1. `list_workspaces` — resolve the workspace id.
2. `get_recent_views` — pass `workspace_id` and `limit: 5`.

**Sample flow**

```json
// Step 1
list_workspaces({})
// => { data: { workspaces: [{ workspace_id: "ws_abc", workspace_name: "Personal" }] } }

// Step 2
get_recent_views({ workspace_id: "ws_abc", limit: 5 })
// => {
//   data: [
//     { view_id: "v1", name: "Project brief — Gama",     last_viewed_at: "2026-04-20T18:12Z" },
//     { view_id: "v2", name: "Weekly review 2026-W16",   last_viewed_at: "2026-04-20T09:47Z" },
//     { view_id: "v3", name: "Tasks",                    last_viewed_at: "2026-04-19T22:01Z" },
//     { view_id: "v4", name: "Meeting notes — Apr 18",   last_viewed_at: "2026-04-18T17:30Z" },
//     { view_id: "v5", name: "Reading list",             last_viewed_at: "2026-04-18T08:11Z" }
//   ]
// }
```

**Final assistant reply (to user)**

> Here are your 5 most recently edited pages in the Personal workspace:
>
> 1. Project brief — Gama (yesterday at 18:12)
> 2. Weekly review 2026-W16 (yesterday at 09:47)
> 3. Tasks (2 days ago)
> 4. Meeting notes — Apr 18 (3 days ago)
> 5. Reading list (3 days ago)

**Notes**

- `get_recent_views` is a straight passthrough to AppFlowy-Cloud's
  `/workspace/{wid}/recent` endpoint — no client-side work.
- If the user has multiple workspaces, ask which one or default to the first
  returned (typically the "visiting" workspace).
