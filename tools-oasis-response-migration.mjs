#!/usr/bin/env node
/**
 * Offline OASIS response-schema provenance migration.
 *
 * EXPAND ONLY: never convert, recode, or reinterpret a clinical response. The
 * tool may add the frozen-v1 response_schema_id to an unversioned legacy row,
 * and response_schema_id/migration_status to its containing assessment. Every
 * other byte is protected by a canonical, full-length SHA-256 digest.
 */
import { createHash } from "node:crypto";
import { readFileSync, realpathSync, statSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";
import { buildOfficialResponseRow } from "./src/components/oasis/responseSchema/responseBuilder.js";
import {
  resolveInstrumentForAssessment,
  visitTypeToTimepoint,
} from "./src/components/oasis/responseSchema/registry.js";

export const V1 = "pennsync-oasis-response-v1-legacy";
export const V2 = "pennsync-oasis-response-v2-cms-e2";

const KNOWN = new Set([V1, V2]);
const KNOWN_MIGRATION_STATUSES = new Set([
  "native_v2", "legacy_unconverted", "legacy_provenance_annotated",
]);
const LEGACY_MIGRATION_STATUSES = new Set([
  "legacy_unconverted", "legacy_provenance_annotated",
]);
const PLAN_VERSION = 2;
const MAX_IDENTIFIER_LENGTH = 200;
const VERIFIED_SCHEMA_SOURCE = "final-oasis-e2-all-item-04-01-2026";
const NATIVE_V2_ROW_KEYS = Object.freeze([
  "definition_id",
  "item_number",
  "item_name",
  "item_source",
  "item_spec_version",
  "response_schema_id",
  "response_shape",
  "response_value",
  "response_origin",
  "selected_by",
  "selected_at",
  "ai_suggested",
]);
const hasOwn = (value, key) => Object.prototype.hasOwnProperty.call(value, key);
const isPlainObject = (value) => value !== null
  && typeof value === "object"
  && !Array.isArray(value)
  && (Object.getPrototypeOf(value) === Object.prototype || Object.getPrototypeOf(value) === null);
const exactIdentifier = (value) => typeof value === "string"
  && value.length > 0
  && value.length <= MAX_IDENTIFIER_LENGTH
  && value.trim() === value
  && !value.startsWith("$");

function canonicalEmail(value) {
  if (typeof value !== "string") return null;
  const normalized = value.trim().toLowerCase();
  return normalized
    && normalized.length <= 320
    && normalized.includes("@")
    && !/\s/.test(normalized)
    ? normalized
    : null;
}

function validInstant(value) {
  return typeof value === "string" && Number.isFinite(Date.parse(value));
}

function validCalendarDate(value) {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const parsed = new Date(`${value}T00:00:00.000Z`);
  return !Number.isNaN(parsed.getTime()) && parsed.toISOString().slice(0, 10) === value;
}

function exactKeys(value, keys) {
  if (!isPlainObject(value)) return false;
  const actual = Object.keys(value).sort();
  const expected = [...keys].sort();
  return actual.length === expected.length
    && actual.every((key, index) => key === expected[index]);
}

export class MigrationInputError extends Error {
  constructor(message) {
    super(message);
    this.name = "MigrationInputError";
  }
}

/** Canonical JSON: recursively sorted object keys; array order is significant. */
export function canonicalJson(value) {
  const stack = new Set();
  function canonicalize(current, path) {
    if (current === null || typeof current === "string" || typeof current === "boolean") return current;
    if (typeof current === "number") {
      if (!Number.isFinite(current)) throw new MigrationInputError(`${path} contains a non-finite number.`);
      if (Number.isInteger(current) && !Number.isSafeInteger(current)) {
        throw new MigrationInputError(`${path} contains an unsafe integer that JSON cannot preserve exactly.`);
      }
      return current;
    }
    if (typeof current === "undefined") {
      throw new MigrationInputError(`${path} contains undefined, which is not valid JSON.`);
    }
    if (typeof current !== "object") {
      throw new MigrationInputError(`${path} contains a value that is not valid JSON.`);
    }
    if (stack.has(current)) throw new MigrationInputError(`${path} contains a circular reference.`);
    stack.add(current);
    let result;
    if (Array.isArray(current)) {
      result = current.map((entry, index) => canonicalize(entry, `${path}[${index}]`));
    } else {
      if (!isPlainObject(current)) throw new MigrationInputError(`${path} must be a plain JSON object.`);
      result = Object.create(null);
      for (const key of Object.keys(current).sort()) {
        result[key] = canonicalize(current[key], `${path}.${key}`);
      }
    }
    stack.delete(current);
    return result;
  }
  return JSON.stringify(canonicalize(value, "$"));
}

/** Full SHA-256 of a canonical JSON value. */
export function canonicalSha256(value) {
  return createHash("sha256").update(canonicalJson(value)).digest("hex");
}

/** Reject datasets that cannot be addressed deterministically. */
export function validateAssessments(assessments) {
  if (!Array.isArray(assessments)) {
    throw new MigrationInputError("Input must be a top-level JSON array of OASISAssessment rows.");
  }
  const ids = new Set();
  assessments.forEach((assessment, index) => {
    if (!isPlainObject(assessment)) {
      throw new MigrationInputError(`Assessment at index ${index} must be a JSON object.`);
    }
    if (!exactIdentifier(assessment.id)) {
      throw new MigrationInputError(
        `Assessment at index ${index} must have an exact, bounded, non-operator string id.`,
      );
    }
    if (ids.has(assessment.id)) throw new MigrationInputError(`Duplicate assessment id: ${assessment.id}`);
    ids.add(assessment.id);
    if (!Array.isArray(assessment.oasis_items)) {
      throw new MigrationInputError(`Assessment ${assessment.id} must have an oasis_items array.`);
    }
  });
  canonicalJson(assessments);
  return assessments;
}

/** Do not treat malformed response_schema_id values as absent. */
export function rowState(row) {
  if (!isPlainObject(row)) return "malformed";
  if (!hasOwn(row, "response_schema_id")) return "unversioned";
  const id = row.response_schema_id;
  if (typeof id !== "string" || id.trim() === "") return "malformed";
  if (id === V1) return "legacy";
  if (id === V2) return "v2";
  return "unknown_schema";
}

function assessmentSchemaState(assessment) {
  if (!hasOwn(assessment, "response_schema_id")) return "unversioned";
  const id = assessment.response_schema_id;
  if (typeof id !== "string" || id.trim() === "") return "malformed";
  if (id === V1) return "legacy";
  if (id === V2) return "v2";
  return "unknown_schema";
}

/**
 * Omit only the three allowed metadata destinations. A row-level
 * migration_status is unsupported and intentionally remains protected.
 */
export function protectedAssessmentValue(assessment) {
  const protectedValue = Object.create(null);
  for (const [key, value] of Object.entries(assessment)) {
    if (key === "response_schema_id" || key === "migration_status") continue;
    if (key === "oasis_items") {
      protectedValue.oasis_items = value.map((row) => {
        if (!isPlainObject(row)) return row;
        const protectedRow = Object.create(null);
        for (const [rowKey, rowValue] of Object.entries(row)) {
          if (rowKey !== "response_schema_id") protectedRow[rowKey] = rowValue;
        }
        return protectedRow;
      });
    } else {
      protectedValue[key] = value;
    }
  }
  return protectedValue;
}

export function protectedAssessmentSha256(assessment) {
  return canonicalSha256(protectedAssessmentValue(assessment));
}

/** Backward-compatible name, now full-length and protecting the complete row. */
export function clinicalChecksum(row) {
  if (!isPlainObject(row)) return canonicalSha256(row);
  const protectedRow = Object.create(null);
  for (const [key, value] of Object.entries(row)) {
    if (key !== "response_schema_id") protectedRow[key] = value;
  }
  return canonicalSha256(protectedRow);
}

/**
 * A native-v2 label is not evidence. Rebuild every row through the canonical
 * response builder, then require the exact protected-writer projection and
 * assessment provenance used by the verified read boundary.
 */
function validateNativeV2Assessment(assessment) {
  const reasons = [];
  const instrument = resolveInstrumentForAssessment(assessment);
  const timepoint = visitTypeToTimepoint(assessment.visit_type);
  const lastWriter = canonicalEmail(assessment.last_written_by);
  const lastWrittenAt = assessment.last_written_at;

  if (!exactIdentifier(assessment.patient_id)) reasons.push("invalid_patient_id");
  if (!validCalendarDate(assessment.assessment_date)) reasons.push("invalid_assessment_date");
  if (!instrument.resolved || assessment.instrument_version !== instrument.instrument) {
    reasons.push("instrument_mismatch");
  }
  if (!timepoint) reasons.push("unresolved_timepoint");
  if (assessment.response_schema_source !== VERIFIED_SCHEMA_SOURCE) {
    reasons.push("unverified_schema_source");
  }
  if (!lastWriter || assessment.last_written_by !== lastWriter) {
    reasons.push("invalid_last_writer");
  }
  if (!validInstant(lastWrittenAt)) reasons.push("invalid_last_written_at");

  const seenDefinitions = new Set();
  const seenItems = new Set();
  assessment.oasis_items.forEach((row, index) => {
    const prefix = `row_${index}`;
    if (!exactKeys(row, NATIVE_V2_ROW_KEYS)) {
      reasons.push(`${prefix}_noncanonical_projection`);
      return;
    }
    if (seenDefinitions.has(row.definition_id)) {
      reasons.push(`${prefix}_duplicate_definition`);
    }
    seenDefinitions.add(row.definition_id);
    const normalizedItem = typeof row.item_number === "string"
      ? row.item_number.toLowerCase().replace(/[^a-z0-9]/g, "")
      : "";
    if (normalizedItem && seenItems.has(normalizedItem)) reasons.push(`${prefix}_duplicate_item`);
    if (normalizedItem) seenItems.add(normalizedItem);

    const selectedBy = canonicalEmail(row.selected_by);
    if (!selectedBy || row.selected_by !== selectedBy || selectedBy !== lastWriter) {
      reasons.push(`${prefix}_invalid_selector`);
    }
    if (!validInstant(row.selected_at)) {
      reasons.push(`${prefix}_invalid_selected_at`);
    } else if (validInstant(lastWrittenAt) && Date.parse(row.selected_at) > Date.parse(lastWrittenAt)) {
      reasons.push(`${prefix}_selection_after_write`);
    }

    const rebuilt = buildOfficialResponseRow({
      definitionId: row.definition_id,
      responseValue: row.response_value,
      assessment,
      clinicianEmail: row.selected_by,
      selectedAt: row.selected_at,
    });
    if (!rebuilt.ok) {
      reasons.push(`${prefix}_${rebuilt.reason}`);
      return;
    }
    for (const key of NATIVE_V2_ROW_KEYS) {
      if (canonicalJson(row[key]) !== canonicalJson(rebuilt.row[key])) {
        reasons.push(`${prefix}_${key}_mismatch`);
      }
    }
  });

  return { ok: reasons.length === 0, reasons: [...new Set(reasons)] };
}

function assessmentDisposition(assessment) {
  const rowStates = assessment.oasis_items.map(rowState);
  const schemaState = assessmentSchemaState(assessment);
  const reasonCodes = [];
  if (assessment.oasis_items.length === 0
      || assessment.oasis_items.some((row) => !isPlainObject(row))
      || rowStates.includes("malformed")
      || assessment.oasis_items.some((row) => isPlainObject(row) && hasOwn(row, "migration_status"))
      || schemaState === "malformed"
      || (hasOwn(assessment, "migration_status")
        && (typeof assessment.migration_status !== "string"
          || !KNOWN_MIGRATION_STATUSES.has(assessment.migration_status)))) {
    reasonCodes.push("malformed_assessment");
  }
  if (!exactIdentifier(assessment.agency_id)) {
    reasonCodes.push("unscoped_tenant");
  }
  if (schemaState === "unknown_schema" || rowStates.includes("unknown_schema")) {
    reasonCodes.push("unknown_schema");
  }
  const distinctRowStates = new Set(rowStates);
  if (distinctRowStates.size > 1) reasonCodes.push("mixed_schema_assessment");

  const onlyRowState = distinctRowStates.size === 1 ? rowStates[0] : null;
  const status = assessment.migration_status;
  if ((schemaState === "legacy" && onlyRowState !== "legacy")
      || (schemaState === "v2" && onlyRowState !== "v2")
      || (schemaState === "unversioned" && onlyRowState === "v2")
      || (schemaState === "unversioned" && hasOwn(assessment, "migration_status"))
      || (schemaState === "legacy" && status === "native_v2")
      || (schemaState === "v2" && status !== "native_v2")
      || (schemaState === "v2" && LEGACY_MIGRATION_STATUSES.has(status))) {
    reasonCodes.push("conflicting_schema_metadata");
  }
  const nativeV2Validation = schemaState === "v2"
    && onlyRowState === "v2"
    && status === "native_v2"
    ? validateNativeV2Assessment(assessment)
    : null;
  if (nativeV2Validation && !nativeV2Validation.ok) {
    reasonCodes.push("invalid_native_v2_provenance");
  }

  const uniqueReasonCodes = [...new Set(reasonCodes)];
  if (uniqueReasonCodes.length > 0) {
    const messages = {
      malformed_assessment: "Assessment or row metadata is malformed; no provenance may be inferred.",
      unscoped_tenant: "Assessment has no explicit agency_id; it cannot be safely included in a tenant migration.",
      unknown_schema: "Assessment contains an unrecognised response schema; refuse rather than guess.",
      mixed_schema_assessment: "Assessment contains more than one row schema state; quarantine the whole assessment.",
      conflicting_schema_metadata: "Assessment-level and row-level response provenance conflict.",
      invalid_native_v2_provenance: "Native-v2 tags failed canonical row, instrument, source, timepoint, or clinician-provenance validation.",
    };
    return {
      disposition: "quarantine",
      reason_codes: uniqueReasonCodes,
      reason: uniqueReasonCodes.map((code) => messages[code]).join(" "),
      row_states: rowStates,
      assessment_schema_state: schemaState,
      native_v2_validation_reasons: nativeV2Validation?.reasons || [],
    };
  }
  if (schemaState === "v2"
      && onlyRowState === "v2"
      && status === "native_v2"
      && nativeV2Validation?.ok) {
    return {
      disposition: "verified_v2", reason_codes: [], row_states: rowStates, assessment_schema_state: schemaState,
    };
  }
  return {
    disposition: "eligible_legacy_annotation",
    reason_codes: [],
    row_states: rowStates,
    assessment_schema_state: schemaState,
  };
}

/** Inventory by tenant, item, claimed writer provenance, and row schema state. */
export function inventory(assessments) {
  validateAssessments(assessments);
  const byTenant = new Map();
  const byItem = new Map();
  const byWriter = new Map();
  const byState = { unversioned: 0, legacy: 0, v2: 0, unknown_schema: 0, malformed: 0 };
  const quarantine = [];
  const assessmentQuarantine = [];
  let rows = 0;

  for (const assessment of assessments) {
    const tenant = exactIdentifier(assessment.agency_id) ? assessment.agency_id : "unscoped";
    const disposition = assessmentDisposition(assessment);
    if (disposition.disposition === "quarantine") {
      assessmentQuarantine.push({
        assessment_id: assessment.id,
        tenant,
        reason_codes: disposition.reason_codes,
        reason: disposition.reason,
        protected_sha256: protectedAssessmentSha256(assessment),
      });
    }
    assessment.oasis_items.forEach((row, rowIndex) => {
      rows += 1;
      const state = rowState(row);
      byState[state] += 1;
      const emptyCounts = () => ({ unversioned: 0, legacy: 0, v2: 0, unknown_schema: 0, malformed: 0 });
      const tenantCount = byTenant.get(tenant) || emptyCounts();
      tenantCount[state] += 1;
      byTenant.set(tenant, tenantCount);
      const item = isPlainObject(row) ? row.item_number || row.definition_id || "unknown" : "malformed";
      const itemCount = byItem.get(item) || emptyCounts();
      itemCount[state] += 1;
      byItem.set(item, itemCount);
      const writer = isPlainObject(row) && row.ai_suggested === true
        ? "ai_path"
        : (isPlainObject(row) && row.selected_by) || assessment.last_written_by
          ? "claimed_clinician_provenance" : "legacy_direct_write";
      const writerCount = byWriter.get(writer) || emptyCounts();
      writerCount[state] += 1;
      byWriter.set(writer, writerCount);
      if (state !== "v2" || disposition.disposition === "quarantine") {
        const stateReasons = {
          unversioned: "No response schema; meanings are unknown until legacy provenance is annotated.",
          legacy: "Frozen legacy response set; never CMS-scorable as v2.",
          malformed: "Malformed response-schema metadata; refuse rather than guess.",
          unknown_schema: "Unrecognised response schema; refuse rather than guess.",
        };
        quarantine.push({
          assessment_id: assessment.id,
          tenant,
          row_index: rowIndex,
          item,
          state,
          reason: disposition.disposition === "quarantine"
            ? `Whole-assessment quarantine: ${disposition.reason}` : stateReasons[state],
          protected_sha256: clinicalChecksum(row),
        });
      }
    });
  }

  const derivedNeedingQuarantine = assessments
    .filter((assessment) => assessmentDisposition(assessment).disposition !== "verified_v2")
    .map((assessment) => ({
      assessment_id: assessment.id,
      reason: "Derived metrics from this assessment lack verified, internally consistent v2 provenance.",
    }));
  return {
    totals: { assessments: assessments.length, rows, ...byState },
    by_tenant: Object.fromEntries(byTenant),
    by_item: Object.fromEntries([...byItem].sort()),
    by_writer: Object.fromEntries(byWriter),
    quarantine,
    assessment_quarantine: assessmentQuarantine,
    derived_records_needing_quarantine: derivedNeedingQuarantine,
  };
}

function unsignedPlan(assessments) {
  const changes = [];
  const quarantinedAssessments = [];
  for (const assessment of assessments) {
    const disposition = assessmentDisposition(assessment);
    const protectedSha256 = protectedAssessmentSha256(assessment);
    if (disposition.disposition === "quarantine") {
      quarantinedAssessments.push({
        assessment_id: assessment.id,
        agency_id: exactIdentifier(assessment.agency_id) ? assessment.agency_id : null,
        reason_codes: disposition.reason_codes,
        reason: disposition.reason,
        protected_sha256: protectedSha256,
      });
      continue;
    }
    if (disposition.disposition === "verified_v2") continue;

    const assessmentSet = {};
    if (!hasOwn(assessment, "response_schema_id")) assessmentSet.response_schema_id = V1;
    if (!hasOwn(assessment, "migration_status")) assessmentSet.migration_status = "legacy_provenance_annotated";
    const rowSets = [];
    assessment.oasis_items.forEach((row, rowIndex) => {
      if (rowState(row) === "unversioned") {
        rowSets.push({
          row_index: rowIndex,
          item: row.item_number || row.definition_id || "unknown",
          set: { response_schema_id: V1 },
        });
      }
    });
    if (Object.keys(assessmentSet).length === 0 && rowSets.length === 0) continue;
    changes.push({
      assessment_id: assessment.id,
      agency_id: assessment.agency_id,
      before_protected_sha256: protectedSha256,
      assessment_set: assessmentSet,
      row_sets: rowSets,
      after_protected_sha256: protectedSha256,
    });
  }
  return {
    plan_version: PLAN_VERSION,
    input_sha256: canonicalSha256(assessments),
    changes,
    quarantined_assessments: quarantinedAssessments,
    no_conversion_guarantee: "No response, response_value, item identity, or other protected byte is changed.",
  };
}

/** Build a deterministic plan; plan_sha256 covers every field except itself. */
export function planProvenanceAnnotation(assessments) {
  validateAssessments(assessments);
  const unsigned = unsignedPlan(assessments);
  return { ...unsigned, plan_sha256: canonicalSha256(unsigned) };
}

function detachedPlanFrom(document) {
  if (!isPlainObject(document)) throw new MigrationInputError("Detached plan must be a JSON object.");
  const plan = isPlainObject(document.provenance_plan) ? document.provenance_plan : document;
  if (!isPlainObject(plan) || typeof plan.plan_sha256 !== "string") {
    throw new MigrationInputError("Detached plan is missing plan_sha256.");
  }
  return plan;
}

/** Verify detached contents, manual digest binding, current input, and exact plan. */
export function verifyDetachedPlan(assessments, detachedDocument, expected = {}) {
  validateAssessments(assessments);
  const detached = detachedPlanFrom(detachedDocument);
  if (typeof expected.input_sha256 !== "string" || typeof expected.plan_sha256 !== "string") {
    throw new MigrationInputError("Apply requires expected input_sha256 and plan_sha256 from the reviewed dry run.");
  }
  if (expected.input_sha256 !== detached.input_sha256) {
    throw new MigrationInputError("Expected input_sha256 does not match the detached plan.");
  }
  if (expected.plan_sha256 !== detached.plan_sha256) {
    throw new MigrationInputError("Expected plan_sha256 does not match the detached plan.");
  }
  const { plan_sha256: claimedPlanSha256, ...unsignedDetached } = detached;
  if (canonicalSha256(unsignedDetached) !== claimedPlanSha256) {
    throw new MigrationInputError("Detached plan contents do not match its plan_sha256.");
  }
  const current = planProvenanceAnnotation(assessments);
  if (current.input_sha256 !== detached.input_sha256) {
    throw new MigrationInputError("Current input does not match the reviewed input_sha256.");
  }
  if (current.plan_sha256 !== detached.plan_sha256 || canonicalJson(current) !== canonicalJson(detached)) {
    throw new MigrationInputError("Detached plan is not the exact plan for the current input.");
  }
  return current;
}

/** Apply a verified plan atomically in memory; quarantined assessments stay exact. */
export function applyProvenanceAnnotation(assessments, detachedDocument, expected = {}) {
  const plan = verifyDetachedPlan(assessments, detachedDocument, expected);
  const indexById = new Map(assessments.map((assessment, index) => [assessment.id, index]));
  const replacements = new Map();
  let appliedRows = 0;
  let metadataFieldsApplied = 0;
  for (const change of plan.changes) {
    const index = indexById.get(change.assessment_id);
    if (index === undefined) throw new MigrationInputError(`Plan references missing assessment ${change.assessment_id}.`);
    const current = assessments[index];
    if (protectedAssessmentSha256(current) !== change.before_protected_sha256) {
      throw new MigrationInputError(`Protected bytes changed for assessment ${change.assessment_id}.`);
    }
    const replacement = structuredClone(current);
    for (const [key, value] of Object.entries(change.assessment_set)) {
      replacement[key] = value;
      metadataFieldsApplied += 1;
    }
    for (const rowSet of change.row_sets) {
      const row = replacement.oasis_items[rowSet.row_index];
      if (!isPlainObject(row)) throw new MigrationInputError(`Plan row is missing for assessment ${change.assessment_id}.`);
      row.response_schema_id = rowSet.set.response_schema_id;
      appliedRows += 1;
      metadataFieldsApplied += 1;
    }
    if (protectedAssessmentSha256(replacement) !== change.after_protected_sha256) {
      throw new MigrationInputError(`Refusing to apply: protected bytes would change for ${change.assessment_id}.`);
    }
    replacements.set(index, replacement);
  }
  for (const [index, replacement] of replacements) assessments[index] = replacement;
  return {
    applied: appliedRows,
    applied_rows: appliedRows,
    applied_assessments: replacements.size,
    metadata_fields_applied: metadataFieldsApplied,
    plan,
  };
}

function option(name) {
  const index = process.argv.indexOf(name);
  if (index < 0) return undefined;
  const value = process.argv[index + 1];
  if (!value || value.startsWith("--")) throw new MigrationInputError(`${name} requires a value.`);
  return value;
}
const has = (name) => process.argv.includes(name);

function readJson(path, label) {
  try {
    return JSON.parse(readFileSync(path, "utf8"));
  } catch (error) {
    throw new MigrationInputError(`Could not read ${label}: ${error.message}`);
  }
}

function writeJsonExclusive(path, value, label) {
  const contents = `${JSON.stringify(value, null, 2)}\n`;
  try {
    writeFileSync(path, contents, {
      encoding: "utf8",
      flag: "wx",
      mode: 0o600,
    });
  } catch (error) {
    throw new MigrationInputError(`Could not securely create ${label}: ${error.message}`);
  }
  return createHash("sha256").update(contents, "utf8").digest("hex");
}

function sameFile(left, right) {
  const leftPath = resolve(left);
  const rightPath = resolve(right);
  if (leftPath === rightPath) return true;
  try {
    if (realpathSync(leftPath) === realpathSync(rightPath)) return true;
    const leftStat = statSync(leftPath);
    const rightStat = statSync(rightPath);
    return leftStat.dev === rightStat.dev && leftStat.ino === rightStat.ino;
  } catch {
    // A new output has no inode yet; normalized absolute-path comparison above
    // remains the applicable check.
    return false;
  }
}

function runCli() {
  const inPath = option("--in");
  if (!inPath) {
    throw new MigrationInputError(
      "Usage: node tools-oasis-response-migration.mjs --in <export.json> [--out report.json] "
      + "[--apply --data-out annotated-export.json --plan reviewed-report.json --expect-input-sha256 <sha> "
      + "--expect-plan-sha256 <sha> --i-have-read-the-plan]",
    );
  }
  const outPath = option("--out");
  const dataOutPath = option("--data-out");
  const planPath = option("--plan");
  if (has("--apply") && !dataOutPath) {
    throw new MigrationInputError("--apply requires a separate --data-out top-level assessment array.");
  }
  if (!has("--apply") && dataOutPath) {
    throw new MigrationInputError("--data-out is only valid with --apply.");
  }
  if (outPath && sameFile(outPath, inPath)) {
    throw new MigrationInputError("Refusing --out equal to --in; the source export must never be overwritten.");
  }
  if (dataOutPath && sameFile(dataOutPath, inPath)) {
    throw new MigrationInputError("Refusing --data-out equal to --in; the source export must never be overwritten.");
  }
  if (outPath && planPath && sameFile(outPath, planPath)) {
    throw new MigrationInputError("Refusing to overwrite the detached reviewed plan.");
  }
  if (dataOutPath && planPath && sameFile(dataOutPath, planPath)) {
    throw new MigrationInputError("Refusing to overwrite the detached reviewed plan with applied data.");
  }
  if (outPath && dataOutPath && sameFile(outPath, dataOutPath)) {
    throw new MigrationInputError("Report --out and applied --data-out must be separate files.");
  }

  const assessments = readJson(inPath, "input export");
  validateAssessments(assessments);
  const plan = planProvenanceAnnotation(assessments);
  const report = {
    tool: "tools-oasis-response-migration",
    mode: has("--apply") ? "apply" : "dry-run",
    generated_at: new Date().toISOString(),
    known_schemas: [...KNOWN],
    input_sha256: plan.input_sha256,
    plan_sha256: plan.plan_sha256,
    no_conversion_guarantee: plan.no_conversion_guarantee,
    inventory: inventory(assessments),
    provenance_plan: plan,
  };

  if (has("--apply")) {
    if (!has("--i-have-read-the-plan")) throw new MigrationInputError("--apply requires --i-have-read-the-plan.");
    if (!planPath) throw new MigrationInputError("--apply requires a detached --plan from a prior dry run.");
    const result = applyProvenanceAnnotation(assessments, readJson(planPath, "detached plan"), {
      input_sha256: option("--expect-input-sha256"),
      plan_sha256: option("--expect-plan-sha256"),
    });
    report.provenance_plan = result.plan;
    report.applied = result.applied;
    report.applied_rows = result.applied_rows;
    report.applied_assessments = result.applied_assessments;
    report.metadata_fields_applied = result.metadata_fields_applied;
  }

  if (dataOutPath) {
    // The PHI-bearing data is the primary apply artifact. Persist it first and
    // bind its exact serialized bytes into the completion report. A data-write
    // failure therefore cannot leave behind a success-looking apply report.
    report.data_output_sha256 = writeJsonExclusive(
      dataOutPath,
      assessments,
      "applied assessment output",
    );
    console.log(`Wrote ${dataOutPath}`);
  }
  if (outPath) {
    writeJsonExclusive(outPath, report, "report output");
    console.log(`Wrote ${outPath}`);
  } else {
    console.log(JSON.stringify(report, null, 2));
  }
  const totals = report.inventory.totals;
  console.error(
    `${totals.assessments} assessment(s), ${totals.rows} row(s): ${totals.v2} v2, `
    + `${totals.legacy} legacy, ${totals.unversioned} unversioned, `
    + `${totals.unknown_schema} unknown, ${totals.malformed} malformed.`,
  );
  console.error(`${report.inventory.assessment_quarantine.length} assessment(s) require whole-assessment quarantine.`);
}

const isMain = process.argv[1] && fileURLToPath(import.meta.url) === resolve(process.argv[1]);
if (isMain) {
  try {
    runCli();
  } catch (error) {
    console.error(`Error: ${error.message}`);
    process.exit(2);
  }
}
