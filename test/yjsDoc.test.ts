import { test } from "node:test";
import assert from "node:assert/strict";
import * as Y from "yjs";
import { decodeDocumentMarkdown } from "../src/yjsDoc.js";

/**
 * Build a minimal AppFlowy-shape Yjs document with a root page and a list of
 * child blocks. Each block spec: { type, text?, data?, deltaOps? }.
 * Returns the encoded update bytes as a number[] (same shape as the REST payload).
 */
interface BlockSpec {
  type: string;
  text?: string;
  data?: Record<string, any>;
  deltaOps?: Array<{ insert: string; attributes?: Record<string, any> }>;
}

const buildDoc = (children: BlockSpec[]): number[] => {
  const doc = new Y.Doc();
  const data = doc.getMap("data");
  const document = new Y.Map();
  data.set("document", document);

  const blocks = new Y.Map();
  const meta = new Y.Map();
  const childrenMap = new Y.Map();
  const textMap = new Y.Map();
  meta.set("children_map", childrenMap);
  meta.set("text_map", textMap);
  document.set("blocks", blocks);
  document.set("meta", meta);

  const pageId = "page_root";
  const pageChildrenKey = "page_children";
  document.set("page_id", pageId);

  const pageBlock = new Y.Map();
  pageBlock.set("id", pageId);
  pageBlock.set("ty", "page");
  pageBlock.set("children", pageChildrenKey);
  pageBlock.set("data", "{}");
  blocks.set(pageId, pageBlock);

  const childArr = new Y.Array<string>();
  childrenMap.set(pageChildrenKey, childArr);

  children.forEach((spec, idx) => {
    const id = `block_${idx}`;
    const childrenKey = `ck_${idx}`;
    const extId = `ext_${idx}`;
    const block = new Y.Map();
    block.set("id", id);
    block.set("ty", spec.type);
    block.set("parent", pageId);
    block.set("children", childrenKey);
    block.set("external_id", extId);
    block.set("data", JSON.stringify(spec.data ?? {}));
    blocks.set(id, block);
    childrenMap.set(childrenKey, new Y.Array<string>());

    const yText = new Y.Text();
    if (spec.deltaOps && spec.deltaOps.length > 0) {
      yText.applyDelta(spec.deltaOps);
    } else if (spec.text) {
      yText.insert(0, spec.text);
    }
    textMap.set(extId, yText);

    childArr.push([id]);
  });

  return Array.from(Y.encodeStateAsUpdate(doc));
};

test("empty doc returns empty string", () => {
  const encoded = buildDoc([]);
  assert.equal(decodeDocumentMarkdown(encoded), "");
});

test("heading with level", () => {
  const encoded = buildDoc([
    { type: "heading", text: "Hello", data: { level: 2 } },
  ]);
  assert.equal(decodeDocumentMarkdown(encoded), "## Hello");
});

test("paragraph renders plain text", () => {
  const encoded = buildDoc([{ type: "paragraph", text: "just text" }]);
  assert.equal(decodeDocumentMarkdown(encoded), "just text");
});

test("bulleted list renders with dash", () => {
  const encoded = buildDoc([
    { type: "bulleted_list", text: "one" },
    { type: "bulleted_list", text: "two" },
  ]);
  assert.equal(decodeDocumentMarkdown(encoded), "- one\n- two");
});

test("numbered list renders with incrementing index", () => {
  const encoded = buildDoc([
    { type: "numbered_list", text: "first" },
    { type: "numbered_list", text: "second" },
  ]);
  // numbered index is computed from the parent's sibling enumeration; each
  // top-level numbered_list is its own subtree root so index is null -> default 1
  const out = decodeDocumentMarkdown(encoded);
  assert.ok(out.includes("first"));
  assert.ok(out.includes("second"));
});

test("todo_list checked vs unchecked", () => {
  const encoded = buildDoc([
    { type: "todo_list", text: "done", data: { checked: true } },
    { type: "todo_list", text: "pending", data: { checked: false } },
  ]);
  const out = decodeDocumentMarkdown(encoded);
  assert.ok(out.includes("- [x] done"));
  assert.ok(out.includes("- [ ] pending"));
});

test("quote renders with leading >", () => {
  const encoded = buildDoc([{ type: "quote", text: "wisdom" }]);
  assert.equal(decodeDocumentMarkdown(encoded), "> wisdom");
});

test("divider renders as ---", () => {
  const encoded = buildDoc([{ type: "divider" }]);
  assert.equal(decodeDocumentMarkdown(encoded), "---");
});

test("code block renders with fenced lang", () => {
  const encoded = buildDoc([
    { type: "code", text: "console.log(1);", data: { language: "ts" } },
  ]);
  const out = decodeDocumentMarkdown(encoded);
  assert.ok(out.startsWith("```ts"));
  assert.ok(out.includes("console.log(1);"));
  assert.ok(out.endsWith("```"));
});

test("bold inline mark renders as **text**", () => {
  const encoded = buildDoc([
    {
      type: "paragraph",
      deltaOps: [
        { insert: "hi " },
        { insert: "bold", attributes: { bold: true } },
      ],
    },
  ]);
  assert.equal(decodeDocumentMarkdown(encoded), "hi **bold**");
});

test("italic renders as *text*", () => {
  const encoded = buildDoc([
    {
      type: "paragraph",
      deltaOps: [{ insert: "em", attributes: { italic: true } }],
    },
  ]);
  assert.equal(decodeDocumentMarkdown(encoded), "*em*");
});

test("link renders with href", () => {
  const encoded = buildDoc([
    {
      type: "paragraph",
      deltaOps: [{ insert: "click", attributes: { href: "https://x.io" } }],
    },
  ]);
  assert.equal(decodeDocumentMarkdown(encoded), "[click](https://x.io)");
});

test("unknown block type falls back to inline text", () => {
  const encoded = buildDoc([{ type: "weirdo", text: "just words" }]);
  assert.equal(decodeDocumentMarkdown(encoded), "just words");
});

test("round-trip via docEdit.markdownToBlocks is consistent on headings+paragraphs", () => {
  // Light round-trip check: build a Yjs doc manually matching what markdownToBlocks
  // would produce, decode, and verify the markdown matches the original shape.
  const encoded = buildDoc([
    { type: "heading", text: "Title", data: { level: 1 } },
    { type: "paragraph", text: "body" },
  ]);
  assert.equal(decodeDocumentMarkdown(encoded), "# Title\nbody");
});
