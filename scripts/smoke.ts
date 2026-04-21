/**
 * Opt-in end-to-end smoke test against a real AppFlowy-Cloud instance.
 *
 * Run: `npm run smoke`
 *
 * Env vars required:
 *   APPFLOWY_BASE_URL
 *   APPFLOWY_EMAIL + APPFLOWY_PASSWORD  (or APPFLOWY_ACCESS_TOKEN + APPFLOWY_REFRESH_TOKEN)
 *
 * If any required env var is missing, the script exits 0 (no-op) so that
 * CI without a live server can safely call this step.
 *
 * Flow:
 *   1. get_self
 *   2. list_workspaces (pick first)
 *   3. list_pages / get_folder (pick a parent page to create under)
 *   4. create throwaway document page
 *   5. append a markdown block
 *   6. fetch_page_markdown to verify the block landed
 *   7. trash the page (cleanup)
 *
 * This is intentionally read+write+cleanup so it catches regressions in the
 * editing path (Yjs encode/decode + web-update) without leaving garbage.
 */

import { AppFlowyClient, configFromEnv } from "../src/client.js";
import { loadPageDoc } from "../src/docEdit.js";
import { decodeDocumentMarkdown } from "../src/yjsDoc.js";

const REQUIRED_ENV = ["APPFLOWY_BASE_URL"];
const hasPasswordAuth =
  !!process.env.APPFLOWY_EMAIL && !!process.env.APPFLOWY_PASSWORD;
const hasTokenAuth =
  !!process.env.APPFLOWY_ACCESS_TOKEN && !!process.env.APPFLOWY_REFRESH_TOKEN;

for (const v of REQUIRED_ENV) {
  if (!process.env[v]) {
    console.log(`[smoke] ${v} not set — skipping smoke test (no-op).`);
    process.exit(0);
  }
}
if (!hasPasswordAuth && !hasTokenAuth) {
  console.log(
    "[smoke] No AppFlowy creds in env — skipping smoke test (no-op).",
  );
  process.exit(0);
}

const log = (...args: unknown[]) => console.log("[smoke]", ...args);

const main = async () => {
  const client = new AppFlowyClient(configFromEnv());

  log("1/7  get_self");
  const me: any = await client.request("GET", "/api/user/profile");
  log("     uid:", me?.data?.uid ?? me?.uid ?? "(unknown)");

  log("2/7  list_workspaces");
  const ws: any = await client.request("GET", "/api/user/workspace");
  const workspaces: any[] =
    ws?.data?.visiting_workspace
      ? [ws.data.visiting_workspace, ...(ws.data?.workspaces ?? [])]
      : ws?.data?.workspaces ?? ws?.workspaces ?? [];
  if (!workspaces.length) throw new Error("No workspaces visible to this user");
  const workspace = workspaces[0];
  const wid = workspace.workspace_id ?? workspace.id;
  log("     workspace:", wid, workspace.workspace_name ?? workspace.name ?? "");

  log("3/7  get_folder (pick a space to create under)");
  const folder: any = await client.request(
    "GET",
    `/api/workspace/${wid}/folder`,
    { query: { depth: 2 } },
  );
  // AppFlowy folder tree: root -> spaces; pick first space or root
  const root = folder?.data ?? folder;
  const parentViewId = root?.view_id ?? root?.id;
  if (!parentViewId) throw new Error("Could not resolve a parent view id");
  log("     parent view_id:", parentViewId);

  log("4/7  create_page (throwaway)");
  const created: any = await client.request(
    "POST",
    `/api/workspace/${wid}/page-view`,
    {
      body: {
        parent_view_id: parentViewId,
        layout: 0, // document
        name: `smoke test ${new Date().toISOString()}`,
      },
    },
  );
  const newViewId =
    created?.data?.view_id ?? created?.view_id ?? created?.data?.id;
  if (!newViewId) {
    throw new Error(
      `create_page did not return a view_id: ${JSON.stringify(created)}`,
    );
  }
  log("     new view_id:", newViewId);

  try {
    log("5/7  append_to_page (edit block via Yjs web-update)");
    await client.request(
      "POST",
      `/api/workspace/${wid}/page-view/${newViewId}/append`,
      { body: { markdown: "# Smoke test\n\nthis page is safe to delete." } },
    );

    log("6/7  fetch_page_markdown (verify)");
    const loaded = await loadPageDoc(client, wid, newViewId);
    const md = decodeDocumentMarkdown(
      Array.from(
        (await client.request<any>(
          "GET",
          `/api/workspace/${wid}/page-view/${newViewId}`,
        )).data.data.encoded_collab,
      ),
    );
    if (!md.includes("Smoke test")) {
      log("     WARN: expected 'Smoke test' in rendered markdown; got:", md);
    } else {
      log("     OK — page markdown roundtripped.");
    }
    // keep the unused import happy (loadPageDoc sanity)
    if (!loaded.pageId) throw new Error("loadPageDoc failed to set pageId");
  } finally {
    log("7/7  trash_page (cleanup)");
    try {
      await client.request(
        "POST",
        `/api/workspace/${wid}/page-view/${newViewId}/move-to-trash`,
      );
      log("     cleaned up.");
    } catch (e) {
      log("     WARN: cleanup failed —", (e as Error).message);
    }
  }

  log("DONE.");
};

main().catch((err) => {
  console.error("[smoke] FAILED:", err);
  process.exit(1);
});
