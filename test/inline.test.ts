import { test } from "node:test";
import assert from "node:assert/strict";
import { parseInlineMarkdown, hasInlineMarkdown } from "../src/inline.js";

test("empty string returns empty ops", () => {
  assert.deepEqual(parseInlineMarkdown(""), []);
});

test("plain text returns a single insert op with no attributes", () => {
  const ops = parseInlineMarkdown("hello world");
  assert.deepEqual(ops, [{ insert: "hello world" }]);
});

test("bold emits bold attribute", () => {
  const ops = parseInlineMarkdown("hi **bold** world");
  assert.deepEqual(ops, [
    { insert: "hi " },
    { insert: "bold", attributes: { bold: true } },
    { insert: " world" },
  ]);
});

test("italic with * emits italic attribute", () => {
  const ops = parseInlineMarkdown("a *em* b");
  assert.deepEqual(ops, [
    { insert: "a " },
    { insert: "em", attributes: { italic: true } },
    { insert: " b" },
  ]);
});

test("italic with _ emits italic attribute", () => {
  const ops = parseInlineMarkdown("a _em_ b");
  assert.deepEqual(ops, [
    { insert: "a " },
    { insert: "em", attributes: { italic: true } },
    { insert: " b" },
  ]);
});

test("inline code emits code attribute", () => {
  const ops = parseInlineMarkdown("run `npm test` now");
  assert.deepEqual(ops, [
    { insert: "run " },
    { insert: "npm test", attributes: { code: true } },
    { insert: " now" },
  ]);
});

test("strikethrough emits strikethrough attribute", () => {
  const ops = parseInlineMarkdown("~~gone~~");
  assert.deepEqual(ops, [{ insert: "gone", attributes: { strikethrough: true } }]);
});

test("link emits href attribute", () => {
  const ops = parseInlineMarkdown("see [docs](https://x.io)");
  assert.deepEqual(ops, [
    { insert: "see " },
    { insert: "docs", attributes: { href: "https://x.io" } },
  ]);
});

test("mixed bold + italic nested: bold containing italic", () => {
  const ops = parseInlineMarkdown("**b _i_ b**");
  // bold applied to all segments; italic inner
  assert.equal(ops.length, 3);
  assert.equal(ops[0].attributes?.bold, true);
  assert.equal(ops[1].attributes?.bold, true);
  assert.equal(ops[1].attributes?.italic, true);
  assert.equal(ops[1].insert, "i");
});

test("link with inner bold merges attributes", () => {
  const ops = parseInlineMarkdown("[**bold link**](https://x)");
  assert.equal(ops.length, 1);
  assert.equal(ops[0].insert, "bold link");
  assert.equal(ops[0].attributes?.bold, true);
  assert.equal(ops[0].attributes?.href, "https://x");
});

test("unbalanced asterisk treated as literal", () => {
  const ops = parseInlineMarkdown("2 * 3 = 6");
  // No matching close for *, so the * should stay literal
  assert.equal(ops.length, 1);
  assert.equal(ops[0].insert.includes("*"), true);
});

test("escaped star is literal", () => {
  const ops = parseInlineMarkdown("literal \\*star\\*");
  assert.equal(ops.length, 1);
  assert.equal(ops[0].insert, "literal *star*");
});

test("hasInlineMarkdown detects markers", () => {
  assert.equal(hasInlineMarkdown("hello"), false);
  assert.equal(hasInlineMarkdown("**x**"), true);
  assert.equal(hasInlineMarkdown("_x_"), true);
  assert.equal(hasInlineMarkdown("`x`"), true);
  assert.equal(hasInlineMarkdown("~x~"), true);
  assert.equal(hasInlineMarkdown("[a](b)"), true);
});

test("adjacent markers do not merge incorrectly", () => {
  const ops = parseInlineMarkdown("**a**`b`");
  assert.equal(ops.length, 2);
  assert.equal(ops[0].attributes?.bold, true);
  assert.equal(ops[1].attributes?.code, true);
});
