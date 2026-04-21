# Example 04 — Bulk import CSV rows into a database

**User prompt**

> Insert these 10 rows into my Contacts DB from this CSV:
>
> ```csv
> name,email,tier,notes
> Ada Lovelace,ada@analyt.ical,Gold,"met at conf"
> Grace Hopper,grace@cobol.dev,Gold,""
> ...
> ```

**Expected tool calls**

1. `list_workspaces` — `workspace_id`.
2. `list_databases` — find "Contacts"; capture `database_id`.
3. `get_database_fields` — resolve each CSV column to a `field_id` + type.
4. Loop per CSV row → `insert_database_row_typed`.

**Sample flow**

```json
// Step 3
get_database_fields({ workspace_id: "ws_abc", database_id: "db_contacts" })
// => [
//   { id: "f_name",  name: "Name",  field_type: 0 }, // RichText
//   { id: "f_email", name: "Email", field_type: 6 }, // URL (or RichText)
//   { id: "f_tier",  name: "Tier",  field_type: 3, type_option: { content: { options: [
//       { id: "o_gold",   name: "Gold" },
//       { id: "o_silver", name: "Silver" },
//       { id: "o_bronze", name: "Bronze" }
//   ] } } },
//   { id: "f_notes", name: "Notes", field_type: 0 }
// ]

// Step 4 — per row
insert_database_row_typed({
  workspace_id: "ws_abc",
  database_id: "db_contacts",
  fields: [
    { field_id: "f_name",  value: "Ada Lovelace" },
    { field_id: "f_email", value: "ada@analyt.ical" },
    { field_id: "f_tier",  value: ["Gold"] },       // SingleSelect: array of names
    { field_id: "f_notes", value: "met at conf" }
  ]
})
```

**Notes**

- `_typed` variants handle per-type encoding. For `SingleSelect`/`MultiSelect`,
  pass an array of option **names** — the tool resolves them to ids using the
  field's `type_option` list.
- The CSV `tier` column's "Gold" must match one of the select option names
  exactly (case-sensitive). If there's a typo, the tool falls back to passing
  the unknown name through; the server may accept it as a new option or reject.
  Safer: surface unknown options to the user before inserting.
- For idempotent imports (re-running without duplicates), use
  `upsert_database_row_typed` and pass a stable `pre_hash` derived from a
  natural key like `email`. Same `pre_hash` → same row id.
- AppFlowy-Cloud has no bulk insert endpoint; each row is one HTTP call. For
  large imports, consider rate-limiting client-side (~5-10 req/s).
