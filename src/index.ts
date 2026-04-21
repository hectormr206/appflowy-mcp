#!/usr/bin/env node
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";
import { AppFlowyClient, configFromEnv } from "./client.js";
import { decodeDocumentMarkdown } from "./yjsDoc.js";
import {
  loadPageDoc,
  pushUpdate,
  editBlockText,
  deleteBlock,
  insertBlock,
  replacePageContent,
  markdownToBlocks,
} from "./docEdit.js";
import { encodeCellsTyped, type FieldDescriptor } from "./cells.js";
import { readFile } from "node:fs/promises";
import { basename } from "node:path";

const client = new AppFlowyClient(configFromEnv());

const server = new McpServer({
  name: "appflowy-mcp",
  version: "0.5.0",
});

const text = (value: unknown) => ({
  content: [{ type: "text" as const, text: typeof value === "string" ? value : JSON.stringify(value, null, 2) }],
});

server.tool(
  "get_self",
  "Return the authenticated AppFlowy user's profile (email, uid, name).",
  {},
  async () => text(await client.request("GET", "/api/user/profile")),
);

server.tool(
  "list_workspaces",
  "List all workspaces the user has access to, with ids and names.",
  {},
  async () => text(await client.request("GET", "/api/user/workspace")),
);

server.tool(
  "search",
  "Full-text / semantic search across a workspace. Returns matching pages, rows, and snippets.",
  {
    workspace_id: z.string().describe("Workspace UUID"),
    query: z.string().describe("Search query"),
    limit: z.number().int().positive().max(50).optional().describe("Max results (default 10)"),
  },
  async ({ workspace_id, query, limit }) =>
    text(
      await client.request("GET", `/api/search/${workspace_id}`, {
        query: { query, limit: limit ?? 10 },
      }),
    ),
);

server.tool(
  "fetch_page",
  "Fetch a page view by id. Returns metadata and markdown/plain content when available.",
  {
    workspace_id: z.string(),
    view_id: z.string().describe("Page (view) UUID"),
  },
  async ({ workspace_id, view_id }) =>
    text(await client.request("GET", `/api/workspace/${workspace_id}/page-view/${view_id}`)),
);

server.tool(
  "fetch_page_markdown",
  "Fetch a page and render its Yjs document as markdown. Only works for `document` layouts.",
  {
    workspace_id: z.string(),
    view_id: z.string(),
  },
  async ({ workspace_id, view_id }) => {
    const res: any = await client.request(
      "GET",
      `/api/workspace/${workspace_id}/page-view/${view_id}`,
    );
    const encoded = res?.data?.data?.encoded_collab;
    if (!Array.isArray(encoded)) {
      throw new Error("Page has no encoded_collab payload (not a document page?).");
    }
    const md = decodeDocumentMarkdown(encoded as number[]);
    const name = res?.data?.view?.name ?? "";
    return text(name ? `# ${name}\n\n${md}` : md);
  },
);

server.tool(
  "get_folder",
  "Get the page tree of a workspace. Returns nested pages with their view_ids — essential for finding parent_view_id when creating pages.",
  {
    workspace_id: z.string(),
    depth: z.number().int().min(1).max(10).optional().describe("Tree depth (default 3)"),
  },
  async ({ workspace_id, depth }) =>
    text(
      await client.request("GET", `/api/workspace/${workspace_id}/folder`, {
        query: { depth: depth ?? 3 },
      }),
    ),
);

server.tool(
  "list_databases",
  "List all databases in a workspace.",
  { workspace_id: z.string() },
  async ({ workspace_id }) =>
    text(await client.request("GET", `/api/workspace/${workspace_id}/database`)),
);

server.tool(
  "get_database_rows",
  "List rows of a database. Returns row ids and cell values.",
  {
    workspace_id: z.string(),
    database_id: z.string(),
  },
  async ({ workspace_id, database_id }) =>
    text(
      await client.request(
        "GET",
        `/api/workspace/${workspace_id}/database/${database_id}/row`,
      ),
    ),
);

const filterOpSchema = z.object({
  field_id: z.string(),
  op: z.enum(["eq", "neq", "contains", "not_contains", "empty", "not_empty", "gt", "lt", "gte", "lte"]),
  value: z.any().optional(),
});

const sortSpecSchema = z.object({
  field_id: z.string(),
  direction: z.enum(["asc", "desc"]).default("asc"),
});

const getCellString = (cell: unknown): string => {
  if (cell == null) return "";
  if (typeof cell === "string") return cell;
  if (typeof cell === "number" || typeof cell === "boolean") return String(cell);
  // AppFlowy cells are often objects; prefer `data` then JSON-stringify
  const anyCell = cell as any;
  if (typeof anyCell?.data === "string") return anyCell.data;
  if (typeof anyCell?.data === "number") return String(anyCell.data);
  try {
    return JSON.stringify(cell);
  } catch {
    return "";
  }
};

const getCellNumber = (cell: unknown): number | null => {
  if (cell == null) return null;
  if (typeof cell === "number") return cell;
  if (typeof cell === "string") {
    const n = Number(cell);
    return Number.isFinite(n) ? n : null;
  }
  const anyCell = cell as any;
  if (typeof anyCell?.data === "number") return anyCell.data;
  if (typeof anyCell?.data === "string") {
    const n = Number(anyCell.data);
    return Number.isFinite(n) ? n : null;
  }
  return null;
};

const applyFilter = (
  row: { cells: Record<string, any> },
  flt: z.infer<typeof filterOpSchema>,
): boolean => {
  const raw = row.cells?.[flt.field_id];
  const str = getCellString(raw).toLowerCase();
  const targetStr = flt.value != null ? String(flt.value).toLowerCase() : "";
  switch (flt.op) {
    case "eq":
      return str === targetStr;
    case "neq":
      return str !== targetStr;
    case "contains":
      return str.includes(targetStr);
    case "not_contains":
      return !str.includes(targetStr);
    case "empty":
      return str.length === 0;
    case "not_empty":
      return str.length > 0;
    case "gt":
    case "lt":
    case "gte":
    case "lte": {
      const n = getCellNumber(raw);
      const t = Number(flt.value);
      if (n == null || !Number.isFinite(t)) return false;
      if (flt.op === "gt") return n > t;
      if (flt.op === "lt") return n < t;
      if (flt.op === "gte") return n >= t;
      return n <= t;
    }
  }
};

server.tool(
  "query_database_rows",
  "Query database rows with client-side filter/sort/paging. IMPORTANT: AppFlowy-Cloud's REST API does NOT support server-side filter/sort — this tool fetches row details via /row/detail and applies filters in memory. For large databases consider tighter `limit`. Filter ops: eq, neq, contains, not_contains, empty, not_empty, gt, lt, gte, lte. Sort direction: asc | desc.",
  {
    workspace_id: z.string(),
    database_id: z.string(),
    filter: z.array(filterOpSchema).optional(),
    sort: z.array(sortSpecSchema).optional(),
    limit: z.number().int().positive().max(500).optional(),
    offset: z.number().int().min(0).optional(),
    with_doc: z.boolean().optional().describe("Fetch row document markdown (default false)"),
  },
  async ({ workspace_id, database_id, filter, sort, limit, offset, with_doc }) => {
    // 1. Get all row ids
    const idsRes: any = await client.request(
      "GET",
      `/api/workspace/${workspace_id}/database/${database_id}/row`,
    );
    const idsArr = (idsRes?.data ?? idsRes) as Array<{ id: string }>;
    if (!Array.isArray(idsArr) || idsArr.length === 0) {
      return text({ total: 0, returned: 0, rows: [] });
    }
    // 2. Fetch details in batches of 50 (URL length safety)
    const allRows: Array<{ id: string; cells: Record<string, any>; has_doc: boolean; doc?: string }> = [];
    const batchSize = 50;
    for (let i = 0; i < idsArr.length; i += batchSize) {
      const batch = idsArr.slice(i, i + batchSize).map((r) => r.id).join(",");
      const detailRes: any = await client.request(
        "GET",
        `/api/workspace/${workspace_id}/database/${database_id}/row/detail`,
        { query: { ids: batch, with_doc: with_doc ? "true" : "false" } },
      );
      const rows = (detailRes?.data ?? detailRes) as any[];
      if (Array.isArray(rows)) allRows.push(...rows);
    }
    // 3. Filter
    let filtered = allRows;
    if (filter && filter.length > 0) {
      filtered = filtered.filter((r) => filter.every((f) => applyFilter(r, f)));
    }
    // 4. Sort
    if (sort && sort.length > 0) {
      filtered = [...filtered].sort((a, b) => {
        for (const s of sort) {
          const av = getCellString(a.cells?.[s.field_id]);
          const bv = getCellString(b.cells?.[s.field_id]);
          const an = Number(av);
          const bn = Number(bv);
          let cmp = 0;
          if (Number.isFinite(an) && Number.isFinite(bn)) cmp = an - bn;
          else cmp = av.localeCompare(bv);
          if (cmp !== 0) return s.direction === "desc" ? -cmp : cmp;
        }
        return 0;
      });
    }
    // 5. Page
    const total = filtered.length;
    const start = offset ?? 0;
    const end = limit != null ? start + limit : filtered.length;
    const paged = filtered.slice(start, end);
    return text({
      total,
      returned: paged.length,
      offset: start,
      rows: paged,
      note: "Filter/sort applied client-side — AppFlowy-Cloud REST has no server-side query support.",
    });
  },
);

server.tool(
  "list_database_views",
  "List the views (Grid/Board/Calendar) of a specific database. Note: AppFlowy-Cloud has no dedicated endpoint — this filters `/workspace/{wid}/database` output by database_id and returns its `views` field.",
  {
    workspace_id: z.string(),
    database_id: z.string(),
  },
  async ({ workspace_id, database_id }) => {
    const res: any = await client.request(
      "GET",
      `/api/workspace/${workspace_id}/database`,
    );
    const arr = (res?.data ?? res) as Array<{ id: string; views: any[] }>;
    const db = Array.isArray(arr) ? arr.find((d) => d.id === database_id) : undefined;
    if (!db) {
      return text({ database_id, views: [], note: "Database not found in workspace." });
    }
    return text({ database_id, views: db.views ?? [] });
  },
);

server.tool(
  "create_database_view",
  "Create a new view (Grid/Board/Calendar) on an existing database page. Hits POST /page-view/{view_id}/database-view. `view_id` is the DATABASE page view id (not the workspace). Layout: 1=Grid, 2=Board, 3=Calendar.",
  {
    workspace_id: z.string(),
    view_id: z.string().describe("Database page view UUID"),
    name: z.string().optional(),
    layout: z.enum(["grid", "board", "calendar"]).describe("Sub-view layout type"),
  },
  async ({ workspace_id, view_id, name, layout }) => {
    const layoutCode = { grid: 1, board: 2, calendar: 3 }[layout];
    return text(
      await client.request(
        "POST",
        `/api/workspace/${workspace_id}/page-view/${view_id}/database-view`,
        { body: { layout: layoutCode, name } },
      ),
    );
  },
);

server.tool(
  "get_database_fields",
  "List database columns (id, name, type). Use the field `id`s as keys for `cells` in insert_database_row / upsert_database_row.",
  {
    workspace_id: z.string(),
    database_id: z.string(),
  },
  async ({ workspace_id, database_id }) =>
    text(
      await client.request(
        "GET",
        `/api/workspace/${workspace_id}/database/${database_id}/fields`,
      ),
    ),
);

server.tool(
  "insert_database_row",
  "Insert a new row in a database. `cells` is a map keyed by field_id (from get_database_fields). Rich field types (date, select, relation) may need AppFlowy-specific cell encoding — see README limitations.",
  {
    workspace_id: z.string(),
    database_id: z.string(),
    cells: z.record(z.any()).optional().describe("Map field_id -> value. Defaults to empty."),
    document: z.string().optional().describe("Optional row document (markdown-ish)."),
  },
  async ({ workspace_id, database_id, cells, document }) =>
    text(
      await client.request(
        "POST",
        `/api/workspace/${workspace_id}/database/${database_id}/row`,
        { body: { cells: cells ?? {}, document } },
      ),
    ),
);

server.tool(
  "upsert_database_row",
  "Insert-or-update a row. The row id is derived as sha256(workspace_id + database_id + pre_hash). Reuse the same `pre_hash` to update an existing row (AppFlowy does NOT let you update by raw row id).",
  {
    workspace_id: z.string(),
    database_id: z.string(),
    pre_hash: z.string().describe("Stable key that determines the row id"),
    cells: z.record(z.any()).optional(),
    document: z.string().optional(),
  },
  async ({ workspace_id, database_id, pre_hash, cells, document }) =>
    text(
      await client.request(
        "PUT",
        `/api/workspace/${workspace_id}/database/${database_id}/row`,
        { body: { pre_hash, cells: cells ?? {}, document } },
      ),
    ),
);

const typedFieldSchema = z.object({
  field_id: z.string(),
  field_type: z.union([z.number().int(), z.string()]).optional().describe(
    "Optional sanity-check — rejects if it mismatches the real field type.",
  ),
  value: z.any(),
});

const fetchDatabaseFields = async (workspace_id: string, database_id: string): Promise<FieldDescriptor[]> => {
  const res: any = await client.request(
    "GET",
    `/api/workspace/${workspace_id}/database/${database_id}/fields`,
  );
  const arr = res?.data ?? res;
  if (!Array.isArray(arr)) throw new Error("Unexpected fields response");
  return arr as FieldDescriptor[];
};

server.tool(
  "insert_database_row_typed",
  "Insert a database row with typed cells (rich types supported: RichText, Number, DateTime, SingleSelect, MultiSelect, Checkbox, URL, Checklist, Relation). Fetches fields first and encodes per type. DateTime value: number (unix seconds) or {timestamp, include_time?, is_range?, end_timestamp?}. Select values: array of option names OR option ids. Relation: array of row_ids. See README for per-type details.",
  {
    workspace_id: z.string(),
    database_id: z.string(),
    fields: z.array(typedFieldSchema).describe("Array of {field_id, field_type?, value}"),
    document: z.string().optional(),
  },
  async ({ workspace_id, database_id, fields, document }) => {
    const fieldDescs = await fetchDatabaseFields(workspace_id, database_id);
    const cells = encodeCellsTyped(fieldDescs, fields);
    return text(
      await client.request(
        "POST",
        `/api/workspace/${workspace_id}/database/${database_id}/row`,
        { body: { cells, document } },
      ),
    );
  },
);

server.tool(
  "upsert_database_row_typed",
  "Upsert (insert-or-update) a database row with typed cells. Row id is derived as sha256(workspace_id + database_id + pre_hash). Reuse pre_hash to update. See insert_database_row_typed for value encoding.",
  {
    workspace_id: z.string(),
    database_id: z.string(),
    pre_hash: z.string(),
    fields: z.array(typedFieldSchema),
    document: z.string().optional(),
  },
  async ({ workspace_id, database_id, pre_hash, fields, document }) => {
    const fieldDescs = await fetchDatabaseFields(workspace_id, database_id);
    const cells = encodeCellsTyped(fieldDescs, fields);
    return text(
      await client.request(
        "PUT",
        `/api/workspace/${workspace_id}/database/${database_id}/row`,
        { body: { pre_hash, cells, document } },
      ),
    );
  },
);

server.tool(
  "upload_asset",
  "Upload a file (image, PDF, etc.) to workspace blob storage. Reads the file from disk and PUTs it to /api/file_storage/{ws}/v1/blob/{parent_dir}. Returns {file_id, url}. The server computes the file_id from the content hash.",
  {
    workspace_id: z.string(),
    file_path: z.string().describe("Absolute path to the local file"),
    parent_dir: z.string().optional().describe("Logical parent dir / bucket (default: workspace_id)"),
    mime_type: z.string().optional().describe("Content-Type override; auto-guessed from extension if omitted"),
  },
  async ({ workspace_id, file_path, parent_dir, mime_type }) => {
    const buf = await readFile(file_path);
    const ct = mime_type ?? guessMime(file_path);
    const dir = parent_dir ?? workspace_id;
    const url = new URL(
      `${client.baseUrl}/api/file_storage/${workspace_id}/v1/blob/${encodeURIComponent(dir)}`,
    );
    const token = await client.ensureToken();
    const res = await fetch(url, {
      method: "PUT",
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": ct,
        "Content-Length": String(buf.byteLength),
        Accept: "application/json",
      },
      body: buf,
    });
    const body = await res.text();
    if (!res.ok) throw new Error(`upload_asset PUT → HTTP ${res.status}: ${body.slice(0, 500)}`);
    const parsed = body ? JSON.parse(body) : {};
    const file_id = parsed?.data?.file_id ?? parsed?.file_id;
    const name = basename(file_path);
    return text({
      file_id,
      parent_dir: dir,
      name,
      url: `/api/file_storage/${workspace_id}/v1/blob/${encodeURIComponent(dir)}/${file_id}`,
      raw: parsed,
    });
  },
);

const guessMime = (path: string): string => {
  const ext = path.split(".").pop()?.toLowerCase() ?? "";
  const map: Record<string, string> = {
    png: "image/png",
    jpg: "image/jpeg",
    jpeg: "image/jpeg",
    gif: "image/gif",
    webp: "image/webp",
    svg: "image/svg+xml",
    pdf: "application/pdf",
    txt: "text/plain",
    md: "text/markdown",
    json: "application/json",
  };
  return map[ext] ?? "application/octet-stream";
};

server.tool(
  "create_page",
  "Create a new page under a parent page. Layout: document | grid | board | calendar | chat. parent_view_id is REQUIRED — get it from list_workspaces (the space view ids) or from an existing page.",
  {
    workspace_id: z.string(),
    parent_view_id: z.string().describe("Parent page / space UUID"),
    name: z.string().describe("Page title"),
    layout: z.enum(["document", "grid", "board", "calendar", "chat"]).optional().default("document"),
  },
  async ({ workspace_id, parent_view_id, name, layout }) => {
    const layoutCode = { document: 0, grid: 1, board: 2, calendar: 3, chat: 4 }[layout ?? "document"];
    return text(
      await client.request("POST", `/api/workspace/${workspace_id}/page-view`, {
        body: { parent_view_id, name, layout: layoutCode },
      }),
    );
  },
);

server.tool(
  "rename_page",
  "Rename a page. AppFlowy exposes page renaming but NOT arbitrary content patching via REST — use append_to_page for content.",
  {
    workspace_id: z.string(),
    view_id: z.string(),
    name: z.string(),
  },
  async ({ workspace_id, view_id, name }) =>
    text(
      await client.request(
        "POST",
        `/api/workspace/${workspace_id}/page-view/${view_id}/update-name`,
        { body: { name } },
      ),
    ),
);

server.tool(
  "append_to_page",
  "Append content to the end of a page. Provide either `text` (plain text — split by blank lines into paragraph blocks) or `blocks` (raw AppFlowy block objects) for power users.",
  {
    workspace_id: z.string(),
    view_id: z.string(),
    text: z.string().optional().describe("Plain text; paragraphs separated by blank lines"),
    blocks: z
      .array(z.any())
      .optional()
      .describe("Raw AppFlowy block objects (type, data, children). Overrides `text` if set."),
  },
  async ({ workspace_id, view_id, text: body, blocks }) => {
    const finalBlocks =
      blocks && blocks.length > 0
        ? blocks
        : (body ?? "")
            .split(/\n{2,}/)
            .map((s) => s.trim())
            .filter(Boolean)
            .map((line) => ({
              type: "paragraph",
              data: { delta: [{ insert: line }] },
              children: [],
            }));
    if (finalBlocks.length === 0) {
      throw new Error("Provide either `text` or `blocks`");
    }
    return text(
      await client.request(
        "POST",
        `/api/workspace/${workspace_id}/page-view/${view_id}/append-block`,
        { body: { blocks: finalBlocks } },
      ),
    );
  },
);

server.tool(
  "duplicate_page",
  "Duplicate a page (and its subtree) in place. Optional `suffix` is appended to the copy's name (default `(copy)`).",
  {
    workspace_id: z.string(),
    view_id: z.string().describe("Page UUID to duplicate"),
    suffix: z.string().optional().describe("Name suffix for the duplicate"),
  },
  async ({ workspace_id, view_id, suffix }) =>
    text(
      await client.request(
        "POST",
        `/api/workspace/${workspace_id}/page-view/${view_id}/duplicate`,
        { body: { suffix } },
      ),
    ),
);

server.tool(
  "trash_page",
  "Move a page (and its subtree) to the workspace trash. Reversible via restore_page.",
  {
    workspace_id: z.string(),
    view_id: z.string(),
  },
  async ({ workspace_id, view_id }) =>
    text(
      await client.request(
        "POST",
        `/api/workspace/${workspace_id}/page-view/${view_id}/move-to-trash`,
      ),
    ),
);

server.tool(
  "restore_page",
  "Restore a trashed page back to its parent.",
  {
    workspace_id: z.string(),
    view_id: z.string(),
  },
  async ({ workspace_id, view_id }) =>
    text(
      await client.request(
        "POST",
        `/api/workspace/${workspace_id}/page-view/${view_id}/restore-from-trash`,
      ),
    ),
);

server.tool(
  "list_trash",
  "List pages currently in the workspace trash.",
  { workspace_id: z.string() },
  async ({ workspace_id }) =>
    text(await client.request("GET", `/api/workspace/${workspace_id}/trash`)),
);

server.tool(
  "favorite_page",
  "Mark or unmark a page as favorite. `is_pinned` pins it to the top of the favorites sidebar.",
  {
    workspace_id: z.string(),
    view_id: z.string(),
    is_favorite: z.boolean(),
    is_pinned: z.boolean().optional(),
  },
  async ({ workspace_id, view_id, is_favorite, is_pinned }) =>
    text(
      await client.request(
        "POST",
        `/api/workspace/${workspace_id}/page-view/${view_id}/favorite`,
        { body: { is_favorite, is_pinned: is_pinned ?? false } },
      ),
    ),
);

server.tool(
  "list_favorites",
  "List pages favorited in the workspace.",
  { workspace_id: z.string() },
  async ({ workspace_id }) =>
    text(await client.request("GET", `/api/workspace/${workspace_id}/favorite`)),
);

server.tool(
  "update_page_icon",
  "Set a page icon. `ty`: 0=Emoji, 1=Url, 2=Icon. `value` is the emoji char, URL, or icon identifier.",
  {
    workspace_id: z.string(),
    view_id: z.string(),
    ty: z.number().int().min(0).max(2).describe("0=Emoji, 1=Url, 2=Icon"),
    value: z.string(),
  },
  async ({ workspace_id, view_id, ty, value }) =>
    text(
      await client.request(
        "POST",
        `/api/workspace/${workspace_id}/page-view/${view_id}/update-icon`,
        { body: { icon: { ty, value } } },
      ),
    ),
);

server.tool(
  "remove_page_icon",
  "Remove a page's icon.",
  {
    workspace_id: z.string(),
    view_id: z.string(),
  },
  async ({ workspace_id, view_id }) =>
    text(
      await client.request(
        "POST",
        `/api/workspace/${workspace_id}/page-view/${view_id}/remove-icon`,
      ),
    ),
);

server.tool(
  "list_members",
  "List members of a workspace (uid, email, role, avatar).",
  { workspace_id: z.string() },
  async ({ workspace_id }) =>
    text(await client.request("GET", `/api/workspace/${workspace_id}/member`)),
);

server.tool(
  "invite_member",
  "Invite an email to join a workspace. Role: Owner | Member | Guest (default Member). Sends an invite email via the server's mailer.",
  {
    workspace_id: z.string(),
    email: z.string().email(),
    role: z.enum(["Owner", "Member", "Guest"]).optional(),
    skip_email_send: z.boolean().optional(),
  },
  async ({ workspace_id, email, role, skip_email_send }) =>
    text(
      await client.request("POST", `/api/workspace/${workspace_id}/invite`, {
        body: [
          {
            email,
            role: role ?? "Member",
            skip_email_send: skip_email_send ?? false,
            wait_email_send: false,
          },
        ],
      }),
    ),
);

server.tool(
  "ai_complete",
  "Run an AI completion. completion_type: 1=ImproveWriting, 2=SpellingAndGrammar, 3=MakeShorter, 4=MakeLonger, 5=ContinueWriting, 6=Explain, 7=AskAI, 8=CustomPrompt. Returns the concatenated streamed text.",
  {
    workspace_id: z.string(),
    text: z.string(),
    completion_type: z.number().int().min(1).max(8).optional(),
    custom_prompt: z.string().optional().describe("System prompt; only used with completion_type=8"),
  },
  async ({ workspace_id, text: input, completion_type, custom_prompt }) => {
    const body: any = {
      text: input,
      completion_type: completion_type ?? 7,
      format: { output_layout: 0, output_content: 0 },
    };
    if (custom_prompt) {
      body.metadata = { custom_prompt: { system: custom_prompt } };
    }
    const res = await client.request<string>(
      "POST",
      `/api/ai/${workspace_id}/complete/stream`,
      { body },
    );
    return text(typeof res === "string" ? res : JSON.stringify(res));
  },
);

server.tool(
  "ai_summarize_row",
  "Summarize a row's cell values via AI. `cells` is a JSON object of column name -> value.",
  {
    workspace_id: z.string(),
    cells: z.record(z.any()).describe("Map column name -> value"),
  },
  async ({ workspace_id, cells }) =>
    text(
      await client.request("POST", `/api/ai/${workspace_id}/summarize_row`, {
        body: { workspace_id, data: { Content: cells } },
      }),
    ),
);

server.tool(
  "ai_translate_row",
  "Translate a row's cell values via AI. `cells` is an array of {title, content} pairs.",
  {
    workspace_id: z.string(),
    cells: z.array(z.object({ title: z.string(), content: z.string() })),
    language: z.string().describe("Target language, e.g. 'Spanish'"),
    include_header: z.boolean().optional(),
  },
  async ({ workspace_id, cells, language, include_header }) =>
    text(
      await client.request("POST", `/api/ai/${workspace_id}/translate_row`, {
        body: {
          workspace_id,
          data: { cells, language, include_header: include_header ?? true },
        },
      }),
    ),
);

server.tool(
  "list_ai_models",
  "List AI models available for completion / chat in this workspace.",
  { workspace_id: z.string() },
  async ({ workspace_id }) =>
    text(await client.request("GET", `/api/ai/${workspace_id}/model/list`)),
);

server.tool(
  "move_page",
  "Move a page to a different parent or reorder within its parent.",
  {
    workspace_id: z.string(),
    view_id: z.string(),
    new_parent_view_id: z.string().describe("Target parent page UUID"),
    prev_view_id: z.string().optional().describe("Place this page after prev_view_id (omit to place first)"),
  },
  async ({ workspace_id, view_id, new_parent_view_id, prev_view_id }) =>
    text(
      await client.request(
        "POST",
        `/api/workspace/${workspace_id}/page-view/${view_id}/move`,
        { body: { new_parent_view_id, prev_view_id } },
      ),
    ),
);

const blockInSchema = z.object({
  type: z.string(),
  data: z.record(z.any()).optional(),
  text: z.string().optional(),
});

server.tool(
  "edit_page_block",
  "Replace the text of a block in a document page. `text` is parsed as inline markdown: **bold**, *italic*/_italic_, `code`, ~~strike~~, [label](url). Pass `raw_delta` to supply Delta ops directly (power users). If `text` contains no markdown syntax it's written verbatim — identical behavior to v0.4.",
  {
    workspace_id: z.string(),
    view_id: z.string(),
    block_id: z.string().describe("Target block id"),
    text: z.string().optional().describe("Inline-markdown text (bold/italic/code/strike/link)"),
    raw_delta: z
      .array(z.object({ insert: z.string(), attributes: z.record(z.any()).optional() }))
      .optional()
      .describe("Direct Yjs Delta ops; overrides `text`"),
  },
  async ({ workspace_id, view_id, block_id, text: newText, raw_delta }) => {
    if (!raw_delta && newText === undefined) {
      throw new Error("Provide `text` or `raw_delta`");
    }
    const loaded = await loadPageDoc(client, workspace_id, view_id);
    editBlockText(loaded, block_id, newText ?? "", raw_delta);
    await pushUpdate(client, workspace_id, view_id, loaded);
    return text({ ok: true, block_id });
  },
);

server.tool(
  "delete_page_block",
  "Remove a block (and its subtree) from a document page by block_id.",
  {
    workspace_id: z.string(),
    view_id: z.string(),
    block_id: z.string(),
  },
  async ({ workspace_id, view_id, block_id }) => {
    const loaded = await loadPageDoc(client, workspace_id, view_id);
    deleteBlock(loaded, block_id);
    await pushUpdate(client, workspace_id, view_id, loaded);
    return text({ ok: true, deleted: block_id });
  },
);

server.tool(
  "insert_page_block_before",
  "Insert a new block immediately BEFORE an existing block (ref_block_id) in its parent. Block spec: {type, data?, text?}.",
  {
    workspace_id: z.string(),
    view_id: z.string(),
    ref_block_id: z.string(),
    block: blockInSchema,
  },
  async ({ workspace_id, view_id, ref_block_id, block }) => {
    const loaded = await loadPageDoc(client, workspace_id, view_id);
    const newId = insertBlock(loaded, ref_block_id, block, "before");
    await pushUpdate(client, workspace_id, view_id, loaded);
    return text({ ok: true, inserted_block_id: newId });
  },
);

server.tool(
  "insert_page_block_after",
  "Insert a new block immediately AFTER an existing block (ref_block_id) in its parent.",
  {
    workspace_id: z.string(),
    view_id: z.string(),
    ref_block_id: z.string(),
    block: blockInSchema,
  },
  async ({ workspace_id, view_id, ref_block_id, block }) => {
    const loaded = await loadPageDoc(client, workspace_id, view_id);
    const newId = insertBlock(loaded, ref_block_id, block, "after");
    await pushUpdate(client, workspace_id, view_id, loaded);
    return text({ ok: true, inserted_block_id: newId });
  },
);

server.tool(
  "replace_page_content",
  "WIPE the entire page body and replace it with markdown-derived blocks. Supports: headings (#..######), bullet/numbered lists, - [ ] todos, > quotes, --- dividers, paragraphs. Inline marks (bold, italic, code, strike, links) are parsed within each block.",
  {
    workspace_id: z.string(),
    view_id: z.string(),
    markdown: z.string(),
  },
  async ({ workspace_id, view_id, markdown }) => {
    const loaded = await loadPageDoc(client, workspace_id, view_id);
    const specs = markdownToBlocks(markdown);
    replacePageContent(loaded, specs);
    await pushUpdate(client, workspace_id, view_id, loaded);
    return text({ ok: true, blocks_written: specs.length });
  },
);

await server.connect(new StdioServerTransport());
