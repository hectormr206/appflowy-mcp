// Inline markdown parser -> Yjs Delta ops.
//
// Supports:
//   **text**         -> bold
//   *text* / _text_  -> italic
//   ~~text~~         -> strike
//   `text`           -> code
//   [text](url)      -> href
//
// Rules:
//  - Emit `{insert: string, attributes?}` ops.
//  - If input has no markdown markers, returns a single `{insert: text}` op
//    (backwards compatible with plain-text callers).
//  - Nesting is supported by accumulating attributes.
//  - Greedy: the parser scans left-to-right and uses the FIRST closing marker.

export interface DeltaOp {
  insert: string;
  attributes?: Record<string, any>;
}

// Marker spec (order matters: longer markers first so `**` beats `*`)
interface MarkerSpec {
  open: string;
  close: string;
  attr: string;
}

const MARKERS: MarkerSpec[] = [
  { open: "**", close: "**", attr: "bold" },
  { open: "~~", close: "~~", attr: "strikethrough" },
  { open: "`", close: "`", attr: "code" },
  { open: "*", close: "*", attr: "italic" },
  { open: "_", close: "_", attr: "italic" },
];

export const parseInlineMarkdown = (text: string): DeltaOp[] => {
  if (!text) return [];
  const ops: DeltaOp[] = [];
  // current active attributes (stacked by marker)
  const stack: Array<{ marker: MarkerSpec; attrs: Record<string, any> }> = [];
  let buf = "";
  let i = 0;

  const flushBuf = (attrs: Record<string, any>) => {
    if (!buf) return;
    const op: DeltaOp = { insert: buf };
    if (Object.keys(attrs).length > 0) op.attributes = { ...attrs };
    ops.push(op);
    buf = "";
  };

  const currentAttrs = (): Record<string, any> => {
    const top = stack.length > 0 ? stack[stack.length - 1].attrs : {};
    return top;
  };

  while (i < text.length) {
    const ch = text[i];

    // Link: [label](url)
    if (ch === "[") {
      const close = text.indexOf("]", i + 1);
      if (close > i && text[close + 1] === "(") {
        const urlClose = text.indexOf(")", close + 2);
        if (urlClose > close) {
          const label = text.slice(i + 1, close);
          const url = text.slice(close + 2, urlClose);
          flushBuf(currentAttrs());
          // recursively parse label for nested marks
          const labelOps = parseInlineMarkdown(label);
          for (const op of labelOps) {
            const merged = { ...(currentAttrs()), ...(op.attributes ?? {}), href: url };
            ops.push({ insert: op.insert, attributes: merged });
          }
          i = urlClose + 1;
          continue;
        }
      }
    }

    // Escaped char: \* -> literal *
    if (ch === "\\" && i + 1 < text.length) {
      buf += text[i + 1];
      i += 2;
      continue;
    }

    // Marker open/close detection
    let matched: MarkerSpec | null = null;
    for (const m of MARKERS) {
      if (text.startsWith(m.open, i)) {
        matched = m;
        break;
      }
    }

    if (matched) {
      // is this a close for the top of the stack?
      const top = stack[stack.length - 1];
      if (top && top.marker.open === matched.open) {
        flushBuf(currentAttrs());
        stack.pop();
        i += matched.open.length;
        continue;
      }

      // is it an open? only if there's a matching close somewhere later.
      const closeIdx = findUnescaped(text, matched.close, i + matched.open.length);
      if (closeIdx >= 0) {
        flushBuf(currentAttrs());
        const next = { ...currentAttrs(), [matched.attr]: true };
        stack.push({ marker: matched, attrs: next });
        i += matched.open.length;
        continue;
      }
    }

    buf += ch;
    i++;
  }

  flushBuf(currentAttrs());
  return ops;
};

const findUnescaped = (text: string, needle: string, from: number): number => {
  let i = from;
  while (i < text.length) {
    if (text[i] === "\\") {
      i += 2;
      continue;
    }
    if (text.startsWith(needle, i)) return i;
    i++;
  }
  return -1;
};

// Helper: does a string contain any inline markdown syntax?
// Used to keep backward-compat: if user passes plain text, behavior is identical.
export const hasInlineMarkdown = (text: string): boolean =>
  /[*_`~]|\[[^\]]+\]\([^)]+\)/.test(text);
