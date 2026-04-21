import * as Y from "yjs";
import { AppFlowyClient } from "./client.js";

export interface BlockIn {
  type: string;
  data?: Record<string, any>;
  text?: string;
  children?: BlockIn[];
}

interface LoadedDoc {
  doc: Y.Doc;
  pageId: string;
  blocks: Y.Map<any>;
  childrenMap: Y.Map<any>;
  textMap: Y.Map<any>;
  stateVector: Uint8Array;
}

const randId = (): string => {
  const chars = "abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789-_";
  let s = "";
  for (let i = 0; i < 10; i++) s += chars[Math.floor(Math.random() * chars.length)];
  return s;
};

export const loadPageDoc = async (
  client: AppFlowyClient,
  workspaceId: string,
  viewId: string,
): Promise<LoadedDoc> => {
  const res: any = await client.request(
    "GET",
    `/api/workspace/${workspaceId}/page-view/${viewId}`,
  );
  const encoded = res?.data?.data?.encoded_collab;
  if (!Array.isArray(encoded)) {
    throw new Error("Page has no encoded_collab (not a document page?).");
  }
  const doc = new Y.Doc();
  Y.applyUpdate(doc, Uint8Array.from(encoded));
  const stateVector = Y.encodeStateVector(doc);
  const data = doc.getMap("data") as Y.Map<any>;
  const document = data.get("document") as Y.Map<any>;
  const pageId = document.get("page_id") as string;
  const blocks = document.get("blocks") as Y.Map<any>;
  const meta = document.get("meta") as Y.Map<any>;
  const childrenMap = meta.get("children_map") as Y.Map<any>;
  const textMap = meta.get("text_map") as Y.Map<any>;
  return { doc, pageId, blocks, childrenMap, textMap, stateVector };
};

export const pushUpdate = async (
  client: AppFlowyClient,
  workspaceId: string,
  viewId: string,
  loaded: LoadedDoc,
): Promise<void> => {
  const update = Y.encodeStateAsUpdate(loaded.doc, loaded.stateVector);
  if (update.length === 0) return;
  await client.request(
    "POST",
    `/api/workspace/v1/${workspaceId}/collab/${viewId}/web-update`,
    { body: { doc_state: Array.from(update), collab_type: 0 } },
  );
};

const findParent = (
  loaded: LoadedDoc,
  blockId: string,
): { parentId: string; childrenKey: string; arr: Y.Array<string>; index: number } | null => {
  for (const [pid, pblock] of loaded.blocks.entries()) {
    const childrenKey = (pblock as Y.Map<any>).get("children") as string | undefined;
    if (!childrenKey) continue;
    const arr = loaded.childrenMap.get(childrenKey) as Y.Array<string> | undefined;
    if (!arr) continue;
    const idx = arr.toArray().indexOf(blockId);
    if (idx >= 0) return { parentId: pid, childrenKey, arr, index: idx };
  }
  return null;
};

export const editBlockText = (loaded: LoadedDoc, blockId: string, newText: string): void => {
  const block = loaded.blocks.get(blockId) as Y.Map<any> | undefined;
  if (!block) throw new Error(`Block ${blockId} not found`);
  const externalId = block.get("external_id") as string | undefined;
  loaded.doc.transact(() => {
    if (externalId) {
      const yText = loaded.textMap.get(externalId) as Y.Text | undefined;
      if (yText) {
        yText.delete(0, yText.length);
        if (newText) yText.insert(0, newText);
        return;
      }
    }
    // Fallback: no text_map entry — create one.
    const extId = randId();
    const yText = new Y.Text();
    if (newText) yText.insert(0, newText);
    loaded.textMap.set(extId, yText);
    block.set("external_id", extId);
  });
};

export const deleteBlock = (loaded: LoadedDoc, blockId: string): void => {
  if (blockId === loaded.pageId) throw new Error("Cannot delete the page root block");
  const parent = findParent(loaded, blockId);
  if (!parent) throw new Error(`Block ${blockId} not found in any parent`);
  loaded.doc.transact(() => {
    parent.arr.delete(parent.index, 1);
    const block = loaded.blocks.get(blockId) as Y.Map<any> | undefined;
    const ext = block?.get("external_id") as string | undefined;
    if (ext) loaded.textMap.delete(ext);
    const childrenKey = block?.get("children") as string | undefined;
    if (childrenKey) loaded.childrenMap.delete(childrenKey);
    loaded.blocks.delete(blockId);
  });
};

const makeBlock = (loaded: LoadedDoc, parentId: string, spec: BlockIn): string => {
  const id = randId();
  const childrenKey = randId();
  const extId = randId();
  const block = new Y.Map<any>();
  block.set("id", id);
  block.set("ty", spec.type);
  block.set("parent", parentId);
  block.set("children", childrenKey);
  block.set("external_id", extId);
  block.set("data", JSON.stringify(spec.data ?? {}));
  loaded.blocks.set(id, block);
  loaded.childrenMap.set(childrenKey, new Y.Array<string>());
  const yText = new Y.Text();
  if (spec.text) yText.insert(0, spec.text);
  loaded.textMap.set(extId, yText);
  return id;
};

export const insertBlock = (
  loaded: LoadedDoc,
  refBlockId: string,
  spec: BlockIn,
  position: "before" | "after",
): string => {
  const parent = findParent(loaded, refBlockId);
  if (!parent) throw new Error(`Reference block ${refBlockId} not found`);
  let newId = "";
  loaded.doc.transact(() => {
    newId = makeBlock(loaded, parent.parentId, spec);
    const insertAt = position === "before" ? parent.index : parent.index + 1;
    parent.arr.insert(insertAt, [newId]);
  });
  return newId;
};

export const replacePageContent = (loaded: LoadedDoc, specs: BlockIn[]): void => {
  const root = loaded.blocks.get(loaded.pageId) as Y.Map<any>;
  const rootChildrenKey = root.get("children") as string;
  const rootArr = loaded.childrenMap.get(rootChildrenKey) as Y.Array<string>;
  loaded.doc.transact(() => {
    const existing = rootArr.toArray();
    rootArr.delete(0, rootArr.length);
    for (const cid of existing) {
      const block = loaded.blocks.get(cid) as Y.Map<any> | undefined;
      const ext = block?.get("external_id") as string | undefined;
      if (ext) loaded.textMap.delete(ext);
      const ck = block?.get("children") as string | undefined;
      if (ck) loaded.childrenMap.delete(ck);
      loaded.blocks.delete(cid);
    }
    for (const spec of specs) {
      const id = makeBlock(loaded, loaded.pageId, spec);
      rootArr.push([id]);
    }
  });
};

export const markdownToBlocks = (md: string): BlockIn[] => {
  const out: BlockIn[] = [];
  for (const raw of md.split(/\n/)) {
    const line = raw.replace(/\s+$/, "");
    if (!line.trim()) continue;
    const h = /^(#{1,6})\s+(.*)$/.exec(line);
    if (h) {
      out.push({ type: "heading", data: { level: h[1].length }, text: h[2] });
      continue;
    }
    const bullet = /^[-*]\s+(.*)$/.exec(line);
    if (bullet) {
      out.push({ type: "bulleted_list", text: bullet[1] });
      continue;
    }
    const num = /^\d+\.\s+(.*)$/.exec(line);
    if (num) {
      out.push({ type: "numbered_list", text: num[1] });
      continue;
    }
    const todo = /^[-*]\s+\[( |x|X)\]\s+(.*)$/.exec(line);
    if (todo) {
      out.push({ type: "todo_list", data: { checked: todo[1].toLowerCase() === "x" }, text: todo[2] });
      continue;
    }
    if (line.startsWith("> ")) {
      out.push({ type: "quote", text: line.slice(2) });
      continue;
    }
    if (line === "---") {
      out.push({ type: "divider" });
      continue;
    }
    out.push({ type: "paragraph", text: line });
  }
  return out;
};
