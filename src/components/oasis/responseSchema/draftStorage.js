// Versioned localStorage / offline drafts for OASIS assessments.
//
// WHY THE KEY CARRIES SO MUCH
// A draft key that names only the patient will happily restore a Discharge draft
// into a Start of Care form, or a draft answered under the legacy response set
// into v2 answer state — where a legacy `6` would be read as "bathed totally by
// another person". The key therefore carries patient, assessment type/time
// point, instrument version and response schema, and a draft whose schema does
// not match the form being opened is NEVER hydrated.
//
// An incompatible draft is not deleted. It stays available for read-only
// recovery until the clinician deliberately discards it, because the clinical
// content in it is real work.
//
// Pure functions plus a narrow storage seam, so this is unit-testable offline.

import { RESPONSE_SCHEMA_V2_CMS_E2, visitTypeToTimepoint } from "./registry.js";

export const DRAFT_KEY_PREFIX = "pennsync.oasis.draft.v2";

/**
 * Build the storage key for a draft.
 * Returns null when the context is not complete enough to be safe.
 */
export function draftKey({ patientId, visitType, instrumentVersion, responseSchemaId }) {
  const tp = visitTypeToTimepoint(visitType);
  if (!patientId || !tp || !instrumentVersion || !responseSchemaId) return null;
  return [DRAFT_KEY_PREFIX, patientId, tp, instrumentVersion, responseSchemaId].join("|");
}

/** The payload written under that key. Self-describing so a reader can refuse it. */
export function draftPayload({ patientId, visitType, instrumentVersion, responseSchemaId, answers, savedAt }) {
  return {
    schema_version: 2,
    patient_id: patientId,
    visit_type: visitType,
    timepoint: visitTypeToTimepoint(visitType),
    instrument_version: instrumentVersion,
    response_schema_id: responseSchemaId,
    answers: answers && typeof answers === "object" ? answers : {},
    saved_at: savedAt || new Date().toISOString(),
  };
}

/** Why a draft cannot be restored, in words a clinician can act on. */
export const DRAFT_REFUSAL_REASONS = Object.freeze({
  unversioned:
    "This draft was saved before PennSync recorded which response set an answer was picked from, "
    + "so its answers cannot be matched to the current items.",
  legacy_schema:
    "This draft was answered under the legacy PennSync response set. Those codes mean different "
    + "things than the CMS-aligned items now shown.",
  unknown_schema: "This draft was saved by a newer version of PennSync than this browser is running.",
  wrong_patient: "This draft belongs to a different patient.",
  wrong_timepoint: "This draft was started for a different assessment type.",
  wrong_instrument: "This draft was started under a different OASIS instrument version.",
});

/**
 * Decide what may be done with a stored draft against the form now open.
 *
 * @returns {{ restorable: boolean, reason: string|null, message: string, recoverable: boolean }}
 */
export function evaluateDraft(draft, context) {
  const refuse = (reason) => ({
    restorable: false,
    reason,
    message: DRAFT_REFUSAL_REASONS[reason] || reason,
    // Always true: an unrestorable draft is still readable and still preserved.
    recoverable: true,
  });

  if (!draft || typeof draft !== "object") return refuse("unversioned");
  if (!draft.response_schema_id) return refuse("unversioned");
  if (draft.response_schema_id !== RESPONSE_SCHEMA_V2_CMS_E2) {
    return refuse(draft.response_schema_id === "pennsync-oasis-response-v1-legacy" ? "legacy_schema" : "unknown_schema");
  }
  if (context?.patientId && draft.patient_id !== context.patientId) return refuse("wrong_patient");
  const tp = visitTypeToTimepoint(context?.visitType);
  if (tp && draft.timepoint !== tp) return refuse("wrong_timepoint");
  if (context?.instrumentVersion && draft.instrument_version !== context.instrumentVersion) {
    return refuse("wrong_instrument");
  }
  return { restorable: true, reason: null, message: "", recoverable: true };
}

/** What the UI must say about a draft it will not restore. */
export const DRAFT_REFUSAL_ACTION =
  "The draft is kept so you can read it, but its answers will not be filled in. Choose each "
  + "official response again from the wording in your EMR.";

// --- storage seam -----------------------------------------------------------

function store(storage) {
  return storage || (typeof localStorage !== "undefined" ? localStorage : null);
}

/** Save a draft. No-op when the context is incomplete — never writes a loose key. */
export function saveDraft(context, answers, storage) {
  const s = store(storage);
  const key = draftKey(context);
  if (!s || !key) return null;
  const payload = draftPayload({ ...context, answers });
  try {
    s.setItem(key, JSON.stringify(payload));
    return key;
  } catch {
    return null;
  }
}

/** Read the draft for exactly this context, if any. */
export function readDraft(context, storage) {
  const s = store(storage);
  const key = draftKey(context);
  if (!s || !key) return null;
  try {
    const raw = s.getItem(key);
    return raw ? JSON.parse(raw) : null;
  } catch {
    return null;
  }
}

/**
 * Every stored PennSync OASIS draft, with its verdict against this context.
 *
 * Used by the recovery surface: incompatible drafts are listed WITH the reason,
 * not hidden, so a clinician can still read work they did.
 */
export function listDrafts(context, storage) {
  const s = store(storage);
  if (!s) return [];
  const out = [];
  for (let i = 0; i < s.length; i++) {
    const key = s.key(i);
    if (!key || !key.startsWith(DRAFT_KEY_PREFIX)) continue;
    let draft;
    try { draft = JSON.parse(s.getItem(key)); } catch { draft = null; }
    out.push({ key, draft, verdict: evaluateDraft(draft, context) });
  }
  return out;
}

/** Explicit discard. The only way a draft leaves storage. */
export function discardDraft(key, storage) {
  const s = store(storage);
  if (!s || !key) return false;
  try { s.removeItem(key); return true; } catch { return false; }
}
