// Response shapes for OASIS answers, and their validators.
//
// WHY CODES ARE STRINGS
// CMS response codes are opaque labels, not numbers. `01` is not `1`, `NA` and
// `UK` are not numeric at all, and M2001's `9` is "NA — patient is not taking
// any medications" rather than a magnitude. PennSync's legacy set stored them
// as JS numbers, which is how `01` became `1` and how a missing answer could
// coerce to `0` — a valid, clinically wrong response. Nothing in this module
// calls parseInt/Number on a code, and nothing sorts codes numerically.
//
// Pure data + pure functions. No React, no SDK — unit-testable offline.

/** Every response shape a v2 definition may declare. */
export const RESPONSE_SHAPES = Object.freeze([
  // Exactly one code: { code: "2" }
  "single",
  // Check-all-that-apply: { codes: ["1", "3"] }
  "multi_select",
  // One cell of a published matrix: { code: "07" }
  "matrix_choice",
  // One code per required row: { rows: [{ row_id: "b", code: "NA" }, ...] }
  "grid",
]);

/** A code is an opaque, non-empty string. Never a number. */
export function isOpaqueCode(code) {
  return typeof code === "string" && code.length > 0 && code.trim() === code;
}

/**
 * Validate a response value against the shape and codes a definition declares.
 *
 * Returns `{ ok: true }` or `{ ok: false, reason, detail }`. Never throws, and
 * never "fixes" a value — a caller that cannot get a valid value must refuse to
 * write, not write a coerced one.
 *
 * @param {object} definition A v2 response definition.
 * @param {unknown} value     The candidate structured response value.
 */
export function validateResponseValue(definition, value) {
  if (!definition || typeof definition !== "object") {
    return { ok: false, reason: "unknown_definition", detail: "No response definition supplied." };
  }
  const shape = definition.response_shape;
  if (!RESPONSE_SHAPES.includes(shape)) {
    return { ok: false, reason: "invalid_shape", detail: `Unknown response shape "${shape}".` };
  }
  if (value === null || value === undefined || typeof value !== "object" || Array.isArray(value)) {
    return { ok: false, reason: "invalid_shape", detail: "Response value must be an object." };
  }

  const valid = new Set(definition.codes.map((c) => c.code));

  if (shape === "single" || shape === "matrix_choice") {
    const keys = Object.keys(value);
    if (keys.length !== 1 || keys[0] !== "code") {
      return { ok: false, reason: "invalid_shape", detail: `${shape} requires exactly { code }.` };
    }
    if (!isOpaqueCode(value.code)) {
      return { ok: false, reason: "invalid_code", detail: "Code must be a non-empty string." };
    }
    if (!valid.has(value.code)) {
      return { ok: false, reason: "invalid_code", detail: `"${value.code}" is not a valid ${definition.item_number || definition.definition_id} code.` };
    }
    return { ok: true };
  }

  if (shape === "multi_select") {
    const keys = Object.keys(value);
    if (keys.length !== 1 || keys[0] !== "codes") {
      return { ok: false, reason: "invalid_shape", detail: "multi_select requires exactly { codes }." };
    }
    const codes = value.codes;
    if (!Array.isArray(codes) || codes.length === 0) {
      return { ok: false, reason: "invalid_shape", detail: "multi_select requires a non-empty codes array." };
    }
    if (!codes.every(isOpaqueCode)) {
      return { ok: false, reason: "invalid_code", detail: "Every code must be a non-empty string." };
    }
    if (new Set(codes).size !== codes.length) {
      return { ok: false, reason: "invalid_code", detail: "Duplicate codes are not a valid response." };
    }
    for (const c of codes) {
      if (!valid.has(c)) {
        return { ok: false, reason: "invalid_code", detail: `"${c}" is not a valid ${definition.item_number || definition.definition_id} code.` };
      }
    }
    // Mutually exclusive codes (for example M1740's "None of the above")
    const exclusive = definition.codes.filter((c) => c.exclusive).map((c) => c.code);
    for (const ex of exclusive) {
      if (codes.includes(ex) && codes.length > 1) {
        return {
          ok: false,
          reason: "mutually_exclusive",
          detail: `Code "${ex}" cannot be combined with any other response.`,
        };
      }
    }
    return { ok: true };
  }

  // shape === "grid"
  const keys = Object.keys(value);
  if (keys.length !== 1 || keys[0] !== "rows") {
    return { ok: false, reason: "invalid_shape", detail: "grid requires exactly { rows }." };
  }
  const rows = value.rows;
  if (!Array.isArray(rows)) {
    return { ok: false, reason: "invalid_shape", detail: "grid rows must be an array." };
  }
  const required = definition.rows.map((r) => r.row_id);
  const seen = [];
  for (const row of rows) {
    if (!row || typeof row !== "object" || Array.isArray(row)) {
      return { ok: false, reason: "invalid_row", detail: "Each grid row must be an object." };
    }
    const rk = Object.keys(row).sort();
    if (rk.length !== 2 || rk[0] !== "code" || rk[1] !== "row_id") {
      return { ok: false, reason: "invalid_row", detail: "Each grid row requires exactly { row_id, code }." };
    }
    if (!required.includes(row.row_id)) {
      return { ok: false, reason: "invalid_row", detail: `"${row.row_id}" is not a row of ${definition.item_number || definition.definition_id}.` };
    }
    if (seen.includes(row.row_id)) {
      return { ok: false, reason: "invalid_row", detail: `Row "${row.row_id}" answered more than once.` };
    }
    if (!isOpaqueCode(row.code) || !valid.has(row.code)) {
      return { ok: false, reason: "invalid_code", detail: `"${row.code}" is not a valid ${definition.item_number || definition.definition_id} row code.` };
    }
    seen.push(row.row_id);
  }
  const missing = required.filter((r) => !seen.includes(r));
  if (missing.length) {
    return { ok: false, reason: "missing_rows", detail: `Missing required row(s): ${missing.join(", ")}.` };
  }
  return { ok: true };
}

/**
 * A stable, display-only rendering of a structured response value.
 *
 * Used for read-only surfaces and quarantine notices. Deliberately NOT parseable
 * back into a code — a caller that needs the code must read `response_value`.
 */
export function describeResponseValue(definition, value) {
  if (!definition || !value || typeof value !== "object") return "";
  const label = (code) => {
    const hit = (definition.codes || []).find((c) => c.code === code);
    return hit ? `${code} — ${hit.label}` : String(code);
  };
  if (definition.response_shape === "multi_select") {
    return (Array.isArray(value.codes) ? value.codes : []).map(label).join("; ");
  }
  if (definition.response_shape === "grid") {
    return (Array.isArray(value.rows) ? value.rows : [])
      .map((r) => {
        const row = (definition.rows || []).find((x) => x.row_id === r.row_id);
        return `${row ? row.label : r.row_id}: ${label(r.code)}`;
      })
      .join("; ");
  }
  return typeof value.code === "string" ? label(value.code) : "";
}
