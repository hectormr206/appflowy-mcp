import * as Y from "yjs";

interface DeltaOp {
  insert?: string;
  attributes?: Record<string, any>;
}

const renderDelta = (delta: DeltaOp[] | undefined): string => {
  if (!delta) return "";
  return delta
    .map((op) => {
      if (typeof op.insert !== "string") return "";
      let out = op.insert;
      const attrs = op.attributes ?? {};
      if (attrs.mention?.page_id) {
        const pid = attrs.mention.page_id;
        return out === "$" || out === "@" ? `[[page:${pid}]]` : `[${out}](page:${pid})`;
      }
      if (attrs.code) out = `\`${out}\``;
      if (attrs.bold && attrs.italic) out = `***${out}***`;
      else if (attrs.bold) out = `**${out}**`;
      else if (attrs.italic) out = `*${out}*`;
      if (attrs.strikethrough) out = `~~${out}~~`;
      if (attrs.href) out = `[${out}](${attrs.href})`;
      return out;
    })
    .join("");
};

const textOf = (block: Y.Map<any>, textMap: Y.Map<any>): string => {
  const externalId = block.get("external_id");
  if (externalId) {
    const yText = textMap.get(externalId);
    if (yText && typeof yText.toDelta === "function") {
      return renderDelta(yText.toDelta());
    }
    if (typeof yText === "string") return yText;
  }
  const dataRaw = block.get("data");
  if (typeof dataRaw === "string") {
    try {
      const parsed = JSON.parse(dataRaw);
      if (Array.isArray(parsed?.delta)) return renderDelta(parsed.delta);
    } catch {
      // ignore
    }
  }
  return "";
};

const parseData = (block: Y.Map<any>): Record<string, any> => {
  const raw = block.get("data");
  if (typeof raw !== "string" || !raw) return {};
  try {
    return JSON.parse(raw);
  } catch {
    return {};
  }
};

const renderBlock = (
  block: Y.Map<any>,
  blocks: Y.Map<any>,
  childrenMap: Y.Map<any>,
  textMap: Y.Map<any>,
  depth: number,
  listIndex: number | null,
): string => {
  const ty = block.get("ty") as string;
  const data = parseData(block);
  const indent = "  ".repeat(Math.max(depth, 0));
  const inline = textOf(block, textMap);
  let line = "";

  switch (ty) {
    case "heading": {
      const level = Math.min(Math.max(Number(data.level) || 1, 1), 6);
      line = `${"#".repeat(level)} ${inline}`;
      break;
    }
    case "paragraph":
      line = inline;
      break;
    case "bulleted_list":
      line = `${indent}- ${inline}`;
      break;
    case "numbered_list":
      line = `${indent}${listIndex ?? 1}. ${inline}`;
      break;
    case "todo_list": {
      const checked = data.checked === true ? "x" : " ";
      line = `${indent}- [${checked}] ${inline}`;
      break;
    }
    case "toggle_list":
      line = `${indent}- ${inline}`;
      break;
    case "quote":
      line = `> ${inline}`;
      break;
    case "callout":
      line = `> ${inline}`;
      break;
    case "code": {
      const lang = typeof data.language === "string" ? data.language : "";
      line = `\`\`\`${lang}\n${inline}\n\`\`\``;
      break;
    }
    case "divider":
      line = "---";
      break;
    case "image": {
      const url = typeof data.url === "string" ? data.url : "";
      line = url ? `![](${url})` : "";
      break;
    }
    case "page":
      line = "";
      break;
    default:
      line = inline;
      break;
  }

  const parts: string[] = [];
  if (line) parts.push(line);

  const childrenKey = block.get("children") as string | undefined;
  const childIds: string[] = childrenKey
    ? Array.from((childrenMap.get(childrenKey) ?? []) as Iterable<string>)
    : [];

  let numbered = 0;
  for (const childId of childIds) {
    const child = blocks.get(childId);
    if (!child) continue;
    const childTy = child.get("ty");
    const nextIndex = childTy === "numbered_list" ? ++numbered : null;
    if (childTy !== "numbered_list") numbered = 0;
    const childDepth = isListType(ty) ? depth + 1 : depth;
    parts.push(
      renderBlock(child, blocks, childrenMap, textMap, childDepth, nextIndex),
    );
  }
  return parts.filter(Boolean).join("\n");
};

const isListType = (ty: string): boolean =>
  ty === "bulleted_list" ||
  ty === "numbered_list" ||
  ty === "todo_list" ||
  ty === "toggle_list";

export const decodeDocumentMarkdown = (encodedCollab: number[]): string => {
  const doc = new Y.Doc();
  Y.applyUpdate(doc, Uint8Array.from(encodedCollab));

  const dataMap = doc.getMap("data") as Y.Map<any>;
  const document = dataMap.get("document") as Y.Map<any> | undefined;
  if (!document) return "";

  const blocks = document.get("blocks") as Y.Map<any> | undefined;
  const meta = document.get("meta") as Y.Map<any> | undefined;
  const pageId = document.get("page_id") as string | undefined;
  if (!blocks || !meta || !pageId) return "";

  const childrenMap = meta.get("children_map") as Y.Map<any>;
  const textMap = meta.get("text_map") as Y.Map<any>;
  const root = blocks.get(pageId);
  if (!root) return "";

  return renderBlock(root, blocks, childrenMap, textMap, 0, null).trim();
};
