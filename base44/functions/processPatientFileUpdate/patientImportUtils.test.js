import { test } from "node:test";
import assert from "node:assert/strict";
import {
  toIsoDate,
  parseCsv,
  parseFullName,
  normalizeStatus,
  buildAddress,
  buildRowObject,
  getNameDobKey,
  buildExistingLookups,
  parseUploadedPatient,
  buildUploadKeys,
  resolveMatch,
} from "./patientImportUtils.js";

// --- Date normalization (DOB-critical for duplicate detection) ---

test("toIsoDate passes through valid ISO dates", () => {
  assert.equal(toIsoDate("1945-04-15"), "1945-04-15");
});

test("toIsoDate normalizes US slash dates with 4-digit years", () => {
  assert.equal(toIsoDate("04/15/1945"), "1945-04-15");
  assert.equal(toIsoDate("4/5/1945"), "1945-04-05");
});

test("toIsoDate pivots 2-digit years into the past, not the future", () => {
  // Born in '45 means 1945 for a home-health patient, never 2045.
  assert.equal(toIsoDate("04/15/45", 2026), "1945-04-15");
  assert.equal(toIsoDate("12/31/99", 2026), "1999-12-31");
});

test("toIsoDate keeps recent 2-digit years in the current century", () => {
  assert.equal(toIsoDate("01/05/20", 2026), "2020-01-05");
});

test("toIsoDate rejects empty and impossible dates", () => {
  assert.equal(toIsoDate(""), null);
  assert.equal(toIsoDate("not a date"), null);
  assert.equal(toIsoDate("13/40/2020"), null);
  assert.equal(toIsoDate("2020-02-30"), null);
});

test("a 2-digit-year upload matches the same patient stored with a 4-digit DOB", () => {
  // Regression: the previous 20YY expansion produced 2045 and silently
  // created a duplicate of a 1945 patient on re-upload.
  const existing = { first_name: "Jane", last_name: "Doe", date_of_birth: "1945-04-15" };
  const uploaded = { first_name: "Jane", last_name: "Doe", date_of_birth: toIsoDate("04/15/45", 2026) };
  assert.equal(getNameDobKey(uploaded), getNameDobKey(existing));
});

// --- CSV parsing robustness ---

test("parseCsv splits a simple file into records and fields", () => {
  const rows = parseCsv("a,b,c\n1,2,3");
  assert.deepEqual(rows, [["a", "b", "c"], ["1", "2", "3"]]);
});

test("parseCsv handles quoted commas and escaped quotes", () => {
  const rows = parseCsv('name,note\n"Doe, Jane","She said ""hi"""');
  assert.deepEqual(rows, [["name", "note"], ["Doe, Jane", 'She said "hi"']]);
});

test("parseCsv treats mid-field quotes as literal characters", () => {
  // A quote that does not start the field is literal text, not an opener,
  // so the value is preserved verbatim instead of having its quotes stripped.
  const rows = parseCsv('note\nHe said "hi"');
  assert.deepEqual(rows, [["note"], ['He said "hi"']]);
});

test("parseCsv still treats a quote at the field start (after leading spaces) as quoting", () => {
  const rows = parseCsv('a,b\n1, "Doe, Jane"');
  assert.deepEqual(rows, [["a", "b"], ["1", "Doe, Jane"]]);
});

test("parseCsv keeps embedded newlines inside quoted fields in one field", () => {
  const rows = parseCsv('addr\n"123 Main St\nApt 2"');
  assert.deepEqual(rows, [["addr"], ["123 Main St\nApt 2"]]);
});

test("parseCsv tolerates CRLF line endings and trailing newline", () => {
  const rows = parseCsv("a,b\r\n1,2\r\n");
  assert.deepEqual(rows, [["a", "b"], ["1", "2"]]);
});

test("parseCsv drops fully-empty rows", () => {
  const rows = parseCsv("a,b\n\n1,2\n,");
  assert.deepEqual(rows, [["a", "b"], ["1", "2"]]);
});

// --- Name parsing ---

test("parseFullName handles 'Last, First Middle'", () => {
  assert.deepEqual(parseFullName("Smith, John Allen"), {
    first_name: "John",
    middle_name: "Allen",
    last_name: "Smith",
  });
});

test("parseFullName handles space-separated names", () => {
  assert.deepEqual(parseFullName("John Smith"), {
    first_name: "John",
    middle_name: "",
    last_name: "Smith",
  });
});

// --- Status normalization ---

test("normalizeStatus maps variants to the canonical enum", () => {
  assert.equal(normalizeStatus("Discharged"), "discharged");
  assert.equal(normalizeStatus("In Hospital"), "hospitalized");
  assert.equal(normalizeStatus("Active"), "active");
  assert.equal(normalizeStatus(""), "active");
});

// --- Address building ---

test("buildAddress combines street and locality parts", () => {
  const address = buildAddress({
    addr_1_care: "123 Main St",
    apt_care: "2",
    city_care: "Philadelphia",
    state_care: "PA",
    zip_code_care: "19103",
  });
  assert.equal(address, "123 Main St, Apt 2 • Philadelphia, PA, 19103");
});

// --- Identity keys & upload keys ---

test("getNameDobKey requires first, last, and a valid DOB", () => {
  assert.equal(getNameDobKey({ first_name: "John", last_name: "Smith", date_of_birth: "1950-01-01" }), "john|smith|1950-01-01");
  assert.equal(getNameDobKey({ first_name: "John", last_name: "Smith", date_of_birth: "" }), null);
  assert.equal(getNameDobKey({ first_name: "John", last_name: "", date_of_birth: "1950-01-01" }), null);
});

test("getNameDobKey ignores case and punctuation in names", () => {
  const a = getNameDobKey({ first_name: "O'Brien", last_name: "  MARY ", date_of_birth: "1950-01-01" });
  const b = getNameDobKey({ first_name: "obrien", last_name: "mary", date_of_birth: "1950-01-01" });
  assert.equal(a, b);
});

test("buildUploadKeys yields both MRN and name+DOB keys when present", () => {
  const keys = buildUploadKeys({
    first_name: "John",
    last_name: "Smith",
    date_of_birth: "1950-01-01",
    medical_record_number: "MRN-123",
  });
  assert.deepEqual(keys, ["mrn:mrn123", "namedob:john|smith|1950-01-01"]);
});

test("buildUploadKeys returns empty when nothing is verifiable", () => {
  assert.deepEqual(buildUploadKeys({ first_name: "John", last_name: "Smith" }), []);
});

// --- Matching against existing patients ---

const makeLookups = (patients) => buildExistingLookups(patients);

test("resolveMatch matches an existing patient by MRN", () => {
  const existing = [{ id: "p1", first_name: "John", last_name: "Smith", date_of_birth: "1950-01-01", medical_record_number: "00123" }];
  const { existingByMrn, existingByNameDob } = makeLookups(existing);
  const result = resolveMatch(
    { first_name: "Johnny", last_name: "Smith", date_of_birth: "1960-02-02", medical_record_number: "00123" },
    existingByMrn,
    existingByNameDob,
  );
  assert.equal(result.match.id, "p1");
  assert.equal(result.matchedBy, "MRN");
});

test("resolveMatch falls back to name + DOB when MRN is absent", () => {
  const existing = [{ id: "p2", first_name: "Jane", last_name: "Doe", date_of_birth: "1945-04-15", medical_record_number: "" }];
  const { existingByMrn, existingByNameDob } = makeLookups(existing);
  const result = resolveMatch(
    { first_name: "Jane", last_name: "Doe", date_of_birth: "1945-04-15", medical_record_number: "" },
    existingByMrn,
    existingByNameDob,
  );
  assert.equal(result.match.id, "p2");
  assert.equal(result.matchedBy, "Name + DOB");
});

test("resolveMatch returns no match for a genuinely new patient", () => {
  const existing = [{ id: "p3", first_name: "Jane", last_name: "Doe", date_of_birth: "1945-04-15", medical_record_number: "A1" }];
  const { existingByMrn, existingByNameDob } = makeLookups(existing);
  const result = resolveMatch(
    { first_name: "Bob", last_name: "Jones", date_of_birth: "1970-07-07", medical_record_number: "B2" },
    existingByMrn,
    existingByNameDob,
  );
  assert.equal(result.match, null);
  assert.equal(result.matchedBy, null);
});

test("resolveMatch flags ambiguity when an MRN is shared by multiple patients", () => {
  const existing = [
    { id: "p4", first_name: "A", last_name: "One", date_of_birth: "1950-01-01", medical_record_number: "X" },
    { id: "p5", first_name: "B", last_name: "Two", date_of_birth: "1951-01-01", medical_record_number: "X" },
  ];
  const { existingByMrn, existingByNameDob } = makeLookups(existing);
  const result = resolveMatch(
    { first_name: "A", last_name: "One", date_of_birth: "1950-01-01", medical_record_number: "X" },
    existingByMrn,
    existingByNameDob,
  );
  assert.match(result.error, /share this MRN/);
});

test("resolveMatch flags when MRN and name+DOB point at different patients", () => {
  const existing = [
    { id: "p6", first_name: "A", last_name: "One", date_of_birth: "1950-01-01", medical_record_number: "X" },
    { id: "p7", first_name: "C", last_name: "Three", date_of_birth: "1952-02-02", medical_record_number: "Y" },
  ];
  const { existingByMrn, existingByNameDob } = makeLookups(existing);
  const result = resolveMatch(
    { first_name: "C", last_name: "Three", date_of_birth: "1952-02-02", medical_record_number: "X" },
    existingByMrn,
    existingByNameDob,
  );
  assert.match(result.error, /matched a different patient/);
});

test("MRN matching ignores formatting differences", () => {
  const existing = [{ id: "p8", first_name: "Sam", last_name: "Lee", date_of_birth: "1955-05-05", medical_record_number: "MRN 123-456" }];
  const { existingByMrn, existingByNameDob } = makeLookups(existing);
  const result = resolveMatch(
    { first_name: "Sam", last_name: "Lee", date_of_birth: "1900-01-01", medical_record_number: "mrn123456" },
    existingByMrn,
    existingByNameDob,
  );
  assert.equal(result.match.id, "p8");
});

// --- End-to-end style: simulate the dedup decisions over a parsed CSV ---

// Mirrors the per-row classification the edge function performs, so the test
// asserts the actual "don't add duplicates" behavior end to end.
const classifyActiveCensus = (csv, existing) => {
  const records = parseCsv(csv);
  const headers = records[0];
  const { existingByMrn, existingByNameDob } = buildExistingLookups(existing);
  const seenUploadKeys = new Set();
  const summary = { created: [], matchedExisting: 0, inFileDuplicates: 0, errors: [] };

  records.slice(1).forEach((cols, index) => {
    const row = buildRowObject(headers, cols);
    if (!Object.values(row).some(Boolean)) return;
    const patient = parseUploadedPatient(row, index + 2);

    if (!patient.first_name || !patient.last_name) {
      summary.errors.push("missing name");
      return;
    }
    const keys = buildUploadKeys(patient);
    if (keys.length === 0) {
      summary.errors.push("unverifiable");
      return;
    }
    if (keys.some((k) => seenUploadKeys.has(k))) {
      summary.inFileDuplicates++;
      return;
    }
    keys.forEach((k) => seenUploadKeys.add(k));

    const match = resolveMatch(patient, existingByMrn, existingByNameDob);
    if (match.error) {
      summary.errors.push(match.error);
      return;
    }
    if (match.match) {
      summary.matchedExisting++;
      return;
    }
    summary.created.push(`${patient.first_name} ${patient.last_name}`);
  });

  return summary;
};

test("active census creates new patients and skips ones already in the system", () => {
  const existing = [
    { id: "e1", first_name: "Existing", last_name: "Patient", date_of_birth: "1940-03-03", medical_record_number: "E1" },
  ];
  const csv = [
    "patient,dob,mrn",
    '"Patient, Existing",03/03/40,E1', // already in system -> matched, not created
    '"Newcomer, Nancy",07/08/55,N9', // brand new -> created
  ].join("\n");

  const summary = classifyActiveCensus(csv, existing);
  assert.deepEqual(summary.created, ["Nancy Newcomer"]);
  assert.equal(summary.matchedExisting, 1);
  assert.equal(summary.inFileDuplicates, 0);
});

test("active census skips a patient duplicated within the same file", () => {
  const csv = [
    "first_name,last_name,dob,mrn",
    "Nancy,Newcomer,07/08/55,N9",
    "Nancy,Newcomer,07/08/55,N9", // exact dup -> in-file duplicate
    "Nancy,Newcomer,07/08/1955,", // same identity via name+DOB, no MRN -> still caught
  ].join("\n");

  const summary = classifyActiveCensus(csv, []);
  assert.deepEqual(summary.created, ["Nancy Newcomer"]);
  assert.equal(summary.inFileDuplicates, 2);
});

test("active census treats a 2-digit DOB re-upload as an existing match (no duplicate)", () => {
  const existing = [
    { id: "e2", first_name: "Mary", last_name: "Jones", date_of_birth: "1945-04-15", medical_record_number: "" },
  ];
  const csv = [
    "first_name,last_name,dob",
    "Mary,Jones,04/15/45",
  ].join("\n");

  const summary = classifyActiveCensus(csv, existing);
  assert.deepEqual(summary.created, []);
  assert.equal(summary.matchedExisting, 1);
});
