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

const client = new AppFlowyClient(configFromEnv());

const server = new McpServer({
  name: "appflowy-mcp",
  version: "0.4.0",
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
  "Replace the text of a specific block in a document page. Find block_id via fetch_page markdown or raw encoded_collab. Rewrites the block's Yjs Y.Text wholesale — does NOT preserve inline formatting.",
  {
    workspace_id: z.string(),
    view_id: z.string(),
    block_id: z.string().describe("Target block id"),
    text: z.string().describe("New plain text (no rich formatting applied)"),
  },
  async ({ workspace_id, view_id, block_id, text: newText }) => {
    const loaded = await loadPageDoc(client, workspace_id, view_id);
    editBlockText(loaded, block_id, newText);
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
  "WIPE the entire page body and replace it with markdown-derived blocks. Supports: headings (#..######), bullet/numbered lists, - [ ] todos, > quotes, --- dividers, paragraphs. Does NOT parse inline bold/italic/links.",
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
