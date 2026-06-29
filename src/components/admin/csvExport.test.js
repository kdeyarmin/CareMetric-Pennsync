import { test } from "node:test";
import assert from "node:assert/strict";
import { toCsv, toCsvRows, exportTimestamp } from "./csvExport.js";

test("toCsvRows escapes every cell and neutralizes formula injection", () => {
  const csv = toCsvRows([
    ["Name", "Note"],
    ["Jane", "=cmd|calc"],
    ["+15551234567", 'has, comma "and quote"'],
  ]);
  const lines = csv.split("\r\n");
  assert.equal(lines[0], "Name,Note");
  assert.equal(lines[1], "Jane,'=cmd|calc");           // formula prefixed with '
  assert.equal(lines[2], "'+15551234567,\"has, comma \"\"and quote\"\"\"");
});

test("toCsvRows tolerates ragged/non-array rows and bad input", () => {
  assert.equal(toCsvRows([["a"], "b"]), "a\r\nb");
  assert.equal(toCsvRows(null), "");
});

test("toCsv writes a header row from column labels", () => {
  const csv = toCsv([{ key: "a", label: "Col A" }, { key: "b", label: "Col B" }], []);
  assert.equal(csv, "Col A,Col B");
});

test("toCsv neutralizes spreadsheet formula injection", () => {
  const cols = [{ key: "v", label: "V" }];
  // A leading =,+,-,@ is prefixed with a single quote so Excel/Sheets treat it
  // as text instead of evaluating it.
  assert.ok(toCsv(cols, [{ v: "=1+1" }]).endsWith("'=1+1"));
  assert.ok(toCsv(cols, [{ v: "+12155550100" }]).endsWith("'+12155550100"));
  assert.ok(toCsv(cols, [{ v: "@SUM(A1)" }]).endsWith("'@SUM(A1)"));
  assert.ok(toCsv(cols, [{ v: "-5" }]).endsWith("'-5"));
  // Ordinary values are untouched.
  assert.ok(toCsv(cols, [{ v: "Jane Smith" }]).endsWith("Jane Smith"));
});

test("toCsv emits one CRLF-separated line per record", () => {
  const csv = toCsv(
    [{ key: "name", label: "Name" }, { key: "n", label: "Count" }],
    [{ name: "Ada", n: 2 }, { name: "Bob", n: 3 }]
  );
  assert.equal(csv, "Name,Count\r\nAda,2\r\nBob,3");
});

test("toCsv escaping is correct for each special case", () => {
  assert.equal(toCsv([{ key: "v", label: "V" }], [{ v: "a,b" }]), 'V\r\n"a,b"');
  assert.equal(toCsv([{ key: "v", label: "V" }], [{ v: 'x"y' }]), 'V\r\n"x""y"');
  assert.equal(toCsv([{ key: "v", label: "V" }], [{ v: "x\ny" }]), 'V\r\n"x\ny"');
  assert.equal(toCsv([{ key: "v", label: "V" }], [{ v: "plain" }]), "V\r\nplain");
});

test("toCsv renders null/undefined as empty fields", () => {
  const csv = toCsv([{ key: "a", label: "A" }, { key: "b", label: "B" }], [{ a: null }]);
  assert.equal(csv, "A,B\r\n,");
});

test("toCsv applies a column format function (e.g. body -> length, never the body)", () => {
  const csv = toCsv(
    [{ key: "body", label: "Length", format: (v) => (v ? String(v).length : 0) }],
    [{ body: "hello" }, { body: "" }]
  );
  assert.equal(csv, "Length\r\n5\r\n0");
});

test("toCsv format receives the whole row as a second argument", () => {
  const csv = toCsv(
    [{ key: "first", label: "Full", format: (v, row) => `${row.first} ${row.last}` }],
    [{ first: "Ada", last: "Lovelace" }]
  );
  assert.equal(csv, "Full\r\nAda Lovelace");
});

test("toCsv tolerates non-array input", () => {
  assert.equal(toCsv(null, null), "");
});

test("exportTimestamp is filename-safe", () => {
  const ts = exportTimestamp(new Date("2026-06-02T14:30:00"));
  assert.equal(ts, "2026-06-02_1430");
  assert.match(ts, /^[\w-]+$/);
});
