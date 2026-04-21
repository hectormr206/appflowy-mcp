import { test } from "node:test";
import assert from "node:assert/strict";
import {
  encodeCell,
  encodeCellsTyped,
  resolveFieldType,
  FIELD_TYPE_CODE,
  type FieldDescriptor,
} from "../src/cells.js";

test("resolveFieldType accepts numeric code", () => {
  assert.equal(resolveFieldType(0), "RichText");
  assert.equal(resolveFieldType(5), "Checkbox");
});

test("resolveFieldType accepts string name", () => {
  assert.equal(resolveFieldType("Number"), "Number");
});

test("resolveFieldType throws on unknown", () => {
  assert.throws(() => resolveFieldType(999));
  assert.throws(() => resolveFieldType("NotAField"));
});

test("RichText stringifies non-strings", () => {
  assert.equal(encodeCell("RichText", "hi"), "hi");
  assert.equal(encodeCell("RichText", 42), "42");
  assert.equal(encodeCell("RichText", null), "");
});

test("Number passes numbers and numeric strings through", () => {
  assert.equal(encodeCell("Number", 3.14), 3.14);
  assert.equal(encodeCell("Number", "42"), "42");
});

test("URL requires a string", () => {
  assert.equal(encodeCell("URL", "https://x"), "https://x");
  assert.equal(encodeCell("URL", 123), "123");
});

test("Checkbox accepts bool / string / number", () => {
  assert.equal(encodeCell("Checkbox", true), true);
  assert.equal(encodeCell("Checkbox", false), false);
  assert.equal(encodeCell("Checkbox", "yes"), true);
  assert.equal(encodeCell("Checkbox", "true"), true);
  assert.equal(encodeCell("Checkbox", "no"), false);
  assert.equal(encodeCell("Checkbox", 1), true);
  assert.equal(encodeCell("Checkbox", 0), false);
});

test("DateTime accepts number timestamp", () => {
  assert.equal(encodeCell("DateTime", 1776786272), 1776786272);
});

test("DateTime accepts object with timestamp", () => {
  const out = encodeCell("DateTime", { timestamp: 100, include_time: true }) as any;
  assert.equal(out.timestamp, 100);
  assert.equal(out.include_time, true);
  assert.equal(out.is_range, false);
  assert.equal(out.end_timestamp, null);
  assert.equal(out.reminder_id, "");
});

test("DateTime rejects object without numeric timestamp", () => {
  assert.throws(() => encodeCell("DateTime", { include_time: true } as any));
});

test("DateTime rejects non-numeric non-object", () => {
  assert.throws(() => encodeCell("DateTime", "not-a-date"));
});

const singleSelectField: FieldDescriptor = {
  id: "f1",
  name: "Status",
  field_type: FIELD_TYPE_CODE.SingleSelect,
  type_option: {
    content: {
      options: [
        { id: "opt_doing", name: "Doing", color: 0 },
        { id: "opt_done", name: "Done", color: 1 },
      ],
    },
  },
};

test("SingleSelect resolves name to id", () => {
  const out = encodeCell("SingleSelect", ["Doing"], { field: singleSelectField }) as any[];
  assert.deepEqual(out, [{ id: "opt_doing" }]);
});

test("SingleSelect truncates to 1 element", () => {
  const out = encodeCell("SingleSelect", ["Doing", "Done"], { field: singleSelectField }) as any[];
  assert.equal(out.length, 1);
});

test("MultiSelect keeps all elements", () => {
  const field = { ...singleSelectField, field_type: FIELD_TYPE_CODE.MultiSelect };
  const out = encodeCell("MultiSelect", ["Doing", "Done"], { field }) as any[];
  assert.equal(out.length, 2);
  assert.equal(out[0].id, "opt_doing");
  assert.equal(out[1].id, "opt_done");
});

test("Select unknown name passes through by name for server to handle", () => {
  const out = encodeCell("SingleSelect", ["Newbie"], { field: singleSelectField }) as any[];
  assert.deepEqual(out, [{ name: "Newbie" }]);
});

test("Select throws without field descriptor", () => {
  assert.throws(() => encodeCell("SingleSelect", ["x"]));
});

test("Checklist from array of strings", () => {
  const out = encodeCell("Checklist", ["buy milk", "pay rent"]) as any;
  assert.equal(out.options.length, 2);
  assert.equal(out.selected_option_ids.length, 2);
  assert.equal(out.options[0].name, "buy milk");
});

test("Checklist rejects non-array non-object", () => {
  assert.throws(() => encodeCell("Checklist", "nope"));
});

test("Relation from array of row ids", () => {
  const out = encodeCell("Relation", ["r1", "r2"]) as any;
  assert.deepEqual(out.row_ids, ["r1", "r2"]);
});

test("Relation rejects invalid input", () => {
  assert.throws(() => encodeCell("Relation", "not-an-array"));
});

test("unsupported field type throws", () => {
  assert.throws(() => encodeCell("Media", "x"));
  assert.throws(() => encodeCell("Time", "x"));
});

test("encodeCellsTyped composes a full cells map", () => {
  const fields: FieldDescriptor[] = [
    { id: "f_name", name: "Name", field_type: FIELD_TYPE_CODE.RichText },
    { id: "f_ok", name: "OK", field_type: FIELD_TYPE_CODE.Checkbox },
  ];
  const out = encodeCellsTyped(fields, [
    { field_id: "f_name", value: "Hector" },
    { field_id: "f_ok", value: true },
  ]);
  assert.equal(out.f_name, "Hector");
  assert.equal(out.f_ok, true);
});

test("encodeCellsTyped throws on field_type mismatch", () => {
  const fields: FieldDescriptor[] = [
    { id: "f", name: "x", field_type: FIELD_TYPE_CODE.RichText },
  ];
  assert.throws(() =>
    encodeCellsTyped(fields, [{ field_id: "f", field_type: "Number", value: 1 }]),
  );
});

test("encodeCellsTyped throws on unknown field_id", () => {
  assert.throws(() => encodeCellsTyped([], [{ field_id: "nope", value: 1 }]));
});
