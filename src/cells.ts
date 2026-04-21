// Friendly -> on-wire cell encoders for AppFlowy database rows.
// Derived from AppFlowy-Collab collab-database TypeOptionCellWriter::convert_json_to_cell
// (rev e59260e524f33104b0ddcd6bb8f6218cad0f7e18).

export type FieldTypeName =
  | "RichText"
  | "Number"
  | "DateTime"
  | "SingleSelect"
  | "MultiSelect"
  | "Checkbox"
  | "URL"
  | "Checklist"
  | "LastEditedTime"
  | "CreatedTime"
  | "Relation"
  | "Summary"
  | "Translate"
  | "Time"
  | "Media";

export const FIELD_TYPE_CODE: Record<FieldTypeName, number> = {
  RichText: 0,
  Number: 1,
  DateTime: 2,
  SingleSelect: 3,
  MultiSelect: 4,
  Checkbox: 5,
  URL: 6,
  Checklist: 7,
  LastEditedTime: 8,
  CreatedTime: 9,
  Relation: 10,
  Summary: 11,
  Translate: 12,
  Time: 13,
  Media: 14,
};

const CODE_TO_NAME: Record<number, FieldTypeName> = Object.fromEntries(
  Object.entries(FIELD_TYPE_CODE).map(([k, v]) => [v, k as FieldTypeName]),
) as Record<number, FieldTypeName>;

export const resolveFieldType = (field_type: number | string): FieldTypeName => {
  if (typeof field_type === "number") {
    const n = CODE_TO_NAME[field_type];
    if (!n) throw new Error(`Unknown field_type code: ${field_type}`);
    return n;
  }
  if (field_type in FIELD_TYPE_CODE) return field_type as FieldTypeName;
  throw new Error(`Unknown field_type: ${field_type}`);
};

export interface FieldDescriptor {
  id: string;
  name: string;
  field_type: number;
  type_option?: any;
}

const extractSelectOptions = (field: FieldDescriptor): Array<{ id: string; name: string }> => {
  const to = field.type_option ?? {};
  // REST shape: type_option.content = { disable_color, options: [{id,name,color}] }
  const content = to?.content;
  if (content && typeof content === "object" && Array.isArray(content.options)) {
    return content.options.map((o: any) => ({ id: String(o.id), name: String(o.name) }));
  }
  if (typeof content === "string") {
    try {
      const parsed = JSON.parse(content);
      if (Array.isArray(parsed?.options)) {
        return parsed.options.map((o: any) => ({ id: String(o.id), name: String(o.name) }));
      }
    } catch {
      /* ignore */
    }
  }
  return [];
};

// The server's select writer already accepts array-of-strings (names or ids) and
// array-of-{id|name}. We normalize to array-of-{id|name} objects so the server
// can resolve reliably even when we only have the name.
const encodeSelectValue = (value: unknown, options: Array<{ id: string; name: string }>) => {
  const list = Array.isArray(value) ? value : [value];
  return list
    .map((item) => {
      if (item == null) return null;
      if (typeof item === "string") {
        const byId = options.find((o) => o.id === item);
        if (byId) return { id: byId.id };
        const byName = options.find((o) => o.name === item);
        if (byName) return { id: byName.id };
        return { name: item };
      }
      if (typeof item === "object") {
        const obj = item as any;
        if (obj.id) return { id: String(obj.id) };
        if (obj.name) return { name: String(obj.name) };
      }
      return null;
    })
    .filter(Boolean);
};

export interface EncodeOptions {
  // For Checklist we need the raw option list on the field to resolve selected names to ids.
  field?: FieldDescriptor;
}

// Convert a friendly input value into the JSON value expected by the
// AppFlowy REST layer (which feeds convert_json_to_cell).
export const encodeCell = (
  field_type: number | string,
  value: unknown,
  opts: EncodeOptions = {},
): unknown => {
  const name = resolveFieldType(field_type);
  const field = opts.field;

  switch (name) {
    case "RichText":
      return typeof value === "string" ? value : String(value ?? "");

    case "Number":
      if (typeof value === "number") return value;
      if (typeof value === "string") return value;
      return String(value ?? "");

    case "URL":
      // URLTypeOption writer only accepts Value::String.
      return typeof value === "string" ? value : String(value ?? "");

    case "Checkbox":
      // CheckboxTypeOption accepts bool, string, or number.
      if (typeof value === "boolean") return value;
      if (typeof value === "number") return value > 0;
      if (typeof value === "string") {
        const s = value.toLowerCase();
        return s === "yes" || s === "true" || s === "1";
      }
      return false;

    case "DateTime": {
      // Accepts integer timestamp OR { timestamp, end_timestamp?, include_time?, is_range?, reminder_id? }
      if (typeof value === "number") return value;
      if (value && typeof value === "object") {
        const v = value as any;
        if (typeof v.timestamp !== "number") {
          throw new Error("DateTime cell requires numeric `timestamp` (seconds since epoch)");
        }
        return {
          timestamp: v.timestamp,
          end_timestamp: v.end_timestamp ?? null,
          include_time: Boolean(v.include_time ?? false),
          is_range: Boolean(v.is_range ?? false),
          reminder_id: String(v.reminder_id ?? ""),
        };
      }
      if (typeof value === "string") {
        const n = Number(value);
        if (!Number.isNaN(n)) return n;
      }
      throw new Error("DateTime cell requires a numeric timestamp or object with {timestamp}");
    }

    case "SingleSelect":
    case "MultiSelect": {
      if (!field) {
        throw new Error(`${name} cell requires the field descriptor to resolve option names/ids`);
      }
      const options = extractSelectOptions(field);
      const encoded = encodeSelectValue(value, options);
      return name === "SingleSelect" ? encoded.slice(0, 1) : encoded;
    }

    case "Checklist": {
      // ChecklistCellData { options: [{id,name,color}], selected_option_ids: [id] }
      // Friendly input:
      //   - array of strings -> use as option NAMES, all selected
      //   - { options: [{name}|string], selected?: [name|id] }
      if (Array.isArray(value)) {
        const opts = value.map((v) =>
          typeof v === "string" ? { id: cryptoId(), name: v, color: 0 } : v,
        );
        return { options: opts, selected_option_ids: opts.map((o: any) => o.id) };
      }
      if (value && typeof value === "object") {
        const v = value as any;
        const options = (v.options ?? []).map((o: any) =>
          typeof o === "string"
            ? { id: cryptoId(), name: o, color: 0 }
            : { id: o.id ?? cryptoId(), name: o.name, color: o.color ?? 0 },
        );
        const sel: string[] = (v.selected ?? v.selected_option_ids ?? []).map((s: any) => {
          if (typeof s !== "string") return String(s);
          const match = options.find((o: any) => o.id === s || o.name === s);
          return match ? match.id : s;
        });
        return { options, selected_option_ids: sel };
      }
      throw new Error("Checklist cell requires an array of names or {options, selected}");
    }

    case "Relation": {
      // RelationCellData { row_ids: [string] }
      const ids = Array.isArray(value)
        ? value.map(String)
        : value && typeof value === "object" && Array.isArray((value as any).row_ids)
          ? (value as any).row_ids.map(String)
          : null;
      if (!ids) throw new Error("Relation cell requires an array of row_ids");
      return { row_ids: ids };
    }

    default:
      throw new Error(
        `Field type \`${name}\` has no friendly encoder yet — pass raw value via insert_database_row.`,
      );
  }
};

const cryptoId = (): string => {
  // Small random id for new checklist options. Not cryptographic.
  return (
    Math.random().toString(36).slice(2, 10) +
    Math.random().toString(36).slice(2, 10)
  );
};

export const encodeCellsTyped = (
  fields: FieldDescriptor[],
  inputs: Array<{ field_id: string; field_type?: number | string; value?: unknown }>,
): Record<string, unknown> => {
  const byId = new Map(fields.map((f) => [f.id, f]));
  const out: Record<string, unknown> = {};
  for (const item of inputs) {
    const field = byId.get(item.field_id);
    if (!field) throw new Error(`Unknown field_id: ${item.field_id}`);
    const ft = item.field_type ?? field.field_type;
    if (item.field_type !== undefined) {
      const provided = resolveFieldType(item.field_type);
      const actual = resolveFieldType(field.field_type);
      if (provided !== actual) {
        throw new Error(
          `field_type mismatch for ${item.field_id}: provided ${provided}, actual ${actual}`,
        );
      }
    }
    out[item.field_id] = encodeCell(ft, item.value, { field });
  }
  return out;
};
