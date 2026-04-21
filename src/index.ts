#!/usr/bin/env node
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";
import { AppFlowyClient, configFromEnv } from "./client.js";
import { decodeDocumentMarkdown } from "./yjsDoc.js";

const client = new AppFlowyClient(configFromEnv());

const server = new McpServer({
  name: "appflowy-mcp",
  version: "0.2.0",
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

await server.connect(new StdioServerTransport());
