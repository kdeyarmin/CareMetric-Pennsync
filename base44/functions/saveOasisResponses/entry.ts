import { createClientFromRequest } from 'npm:@base44/sdk@0.8.31';

// The ONE protected write path for OASIS responses.
//
// WHY THIS FUNCTION EXISTS
// `OASISAssessment` has open write RLS (`"write": {}`), so UI-only enforcement
// is not enforcement: any authenticated client could PUT an assessment row with
// whatever `oasis_items[]` it liked — a legacy code, an AI-chosen code, a
// screening answer wearing an M-number, an item at a time point where CMS does
// not collect it. Every one of those is indistinguishable downstream from a
// clinician-selected official response.
//
// This function re-validates server-side what the frontend builder validated,
// so a caller that skips the builder gains nothing. It refuses:
//   * a missing or unknown response schema, and any obsolete (v1) schema;
//   * an unresolved instrument (missing/invalid assessment date);
//   * an unresolved or inapplicable time point;
//   * an invalid code, response shape, or grid row;
//   * a screening item carrying an M-number;
//   * an official response without an explicit clinician selection;
//   * an AI-originated official response;
//   * inconsistent schema metadata;
//   * a stale client writing an obsolete schema after cutover.
//
// It never converts, recodes or repairs a value. A row that does not validate is
// rejected with a named reason so the client can tell the clinician what to fix.

// <<<BEGIN SHARED HELPER: requireActiveUser — generated, edit base44/_shared/backendHelpers.mjs>>>
const isDeactivatedUser = (u) => !!u && u.is_active === false;
const DEACTIVATED_USER_RESPONSE = () => Response.json(
  { error: 'Unauthorized - account is deactivated' },
  { status: 403 },
);
// <<<END SHARED HELPER: requireActiveUser>>>

// <<<BEGIN SHARED HELPER: resolveAgencySettings — generated, edit base44/_shared/backendHelpers.mjs>>>
async function resolveAgencySettings(base44, agencyName) {
  let settings = [];
  const key = String(agencyName || '').trim();
  if (key) {
    settings = await base44.asServiceRole.entities.AgencySettings
      .filter({ agency_code: key }, '-created_date', 1)
      .catch(() => []);
    if (!settings?.length) {
      settings = await base44.asServiceRole.entities.AgencySettings
        .filter({ office_name: key }, '-created_date', 1)
        .catch(() => []);
    }
  }
  if (!settings?.length) {
    // Fail closed when the agency hint missed (or no hint but multiple tenant
    // rows exist). Newest-row-wins would silently apply another agency's fax
    // line / dial allowlist / wage index / quiet-hour timezone.
    if (key) return null;
    const newest = await base44.asServiceRole.entities.AgencySettings
      .list('-created_date', 5)
      .catch(() => []);
    if ((newest || []).length > 1) return null;
    settings = (newest || []).slice(0, 1);
  }
  return settings?.[0] || null;
}
// <<<END SHARED HELPER: resolveAgencySettings>>>

// <<<BEGIN SHARED HELPER: oasisResponseGuard — generated, edit base44/_shared/backendHelpers.mjs>>>
const OASIS_RESPONSE_SCHEMA_V1_LEGACY = 'pennsync-oasis-response-v1-legacy';
const OASIS_RESPONSE_SCHEMA_V2_CMS_E2 = 'pennsync-oasis-response-v2-cms-e2';
const OASIS_KNOWN_RESPONSE_SCHEMAS = [OASIS_RESPONSE_SCHEMA_V1_LEGACY, OASIS_RESPONSE_SCHEMA_V2_CMS_E2];
// Only v2 accepts NEW writes. v1 is frozen history: permanently read-only.
const OASIS_WRITABLE_RESPONSE_SCHEMAS = [OASIS_RESPONSE_SCHEMA_V2_CMS_E2];

// Item applicability, derived from the final OASIS-E2 Time Point instruments
// (effective 2026-04-01). M2420 is agency-discharge only; an inpatient-facility
// transfer is M2410, which PennSync does not implement.
const OASIS_V2_APPLICABILITY = {
  m1100_cms_e2: ['SOC', 'ROC'],
  m1306_cms_e2: ['SOC', 'ROC', 'FU', 'DC'],
  m1340_cms_e2: ['SOC', 'ROC', 'DC'],
  m1400_cms_e2: ['SOC', 'ROC', 'DC'],
  m1620_cms_e2: ['SOC', 'ROC', 'DC'],
  m1740_cms_e2: ['SOC', 'ROC', 'DC'],
  m1830_cms_e2: ['SOC', 'ROC', 'FU', 'DC'],
  m1840_cms_e2: ['SOC', 'ROC', 'FU', 'DC'],
  m1860_cms_e2: ['SOC', 'ROC', 'FU', 'DC'],
  m1870_cms_e2: ['SOC', 'ROC', 'DC'],
  m2001_cms_e2: ['SOC', 'ROC'],
  m2010_cms_e2: ['SOC', 'ROC'],
  m2020_cms_e2: ['SOC', 'ROC', 'DC'],
  m2401_cms_e2: ['TRN', 'DC'],
  m2420_cms_e2: ['DC'],
  ps_hospitalization_risk_tier: ['SOC', 'ROC', 'FU', 'TRN', 'DC'],
  ps_urinary_incontinence_frequency: ['SOC', 'ROC', 'FU', 'TRN', 'DC'],
  ps_ostomy_self_management: ['SOC', 'ROC', 'FU', 'TRN', 'DC'],
};
const OASIS_V2_ITEM_NUMBERS = {
  m1100_cms_e2: 'M1100', m1306_cms_e2: 'M1306', m1340_cms_e2: 'M1340', m1400_cms_e2: 'M1400',
  m1620_cms_e2: 'M1620', m1740_cms_e2: 'M1740', m1830_cms_e2: 'M1830', m1840_cms_e2: 'M1840',
  m1860_cms_e2: 'M1860', m1870_cms_e2: 'M1870', m2001_cms_e2: 'M2001', m2010_cms_e2: 'M2010',
  m2020_cms_e2: 'M2020', m2401_cms_e2: 'M2401', m2420_cms_e2: 'M2420',
};
const OASIS_V2_CODES = {
  m1100_cms_e2: ['01','02','03','04','05','06','07','08','09','10','11','12','13','14','15'],
  m1306_cms_e2: ['0','1'],
  m1340_cms_e2: ['0','1','2'],
  m1400_cms_e2: ['0','1','2','3','4'],
  m1620_cms_e2: ['0','1','2','3','4','5','NA','UK'],
  m1740_cms_e2: ['1','2','3','4','5','6','7'],
  m1830_cms_e2: ['0','1','2','3','4','5','6'],
  m1840_cms_e2: ['0','1','2','3','4'],
  m1860_cms_e2: ['0','1','2','3','4','5','6'],
  m1870_cms_e2: ['0','1','2','3','4','5'],
  m2001_cms_e2: ['0','1','9'],
  m2010_cms_e2: ['0','1','NA'],
  m2020_cms_e2: ['0','1','2','3','NA'],
  m2401_cms_e2: ['0','1','NA'],
  m2420_cms_e2: ['1','2','3','4','UK'],
  ps_hospitalization_risk_tier: ['low','medium','high'],
  ps_urinary_incontinence_frequency: ['none','occasional_stress','daily_pads','continuous','catheter'],
  ps_ostomy_self_management: ['none','independent','needs_assistance'],
};
const OASIS_V2_SHAPES = {
  m1100_cms_e2: 'matrix_choice', m1740_cms_e2: 'multi_select', m2401_cms_e2: 'grid',
};
const OASIS_V2_GRID_ROWS = { m2401_cms_e2: ['b', 'c', 'd', 'e', 'f'] };
const OASIS_V2_EXCLUSIVE_CODES = { m1740_cms_e2: ['7'] };
// Codes CMS omits at a given time point (M1620's UK is omitted on DC).
const OASIS_V2_CODE_OMISSIONS = { m1620_cms_e2: { DC: ['UK'] } };
const OASIS_V2_SCREENING_IDS = [
  'ps_hospitalization_risk_tier', 'ps_urinary_incontinence_frequency', 'ps_ostomy_self_management',
];

function oasisVisitTypeToTimepoint(visitType) {
  switch (String(visitType || '').trim()) {
    case 'Start of Care': return 'SOC';
    case 'Resumption of Care': return 'ROC';
    case 'Recertification': return 'FU';
    case 'Transfer': return 'TRN';
    case 'Discharge': return 'DC';
    case 'Death at Home': return 'DAH';
    default: return null;
  }
}

function oasisResolveInstrument(assessmentDate) {
  if (assessmentDate === null || assessmentDate === undefined || String(assessmentDate).trim() === '') {
    return { resolved: false, reason: 'missing_assessment_date' };
  }
  const t = Date.parse(String(assessmentDate));
  if (!Number.isFinite(t)) return { resolved: false, reason: 'invalid_assessment_date' };
  if (t < Date.parse('2026-04-01')) return { resolved: false, reason: 'assessment_predates_oasis_e2' };
  return { resolved: true, instrument: 'oasis-e2' };
}

function oasisShapeOf(definitionId) {
  return OASIS_V2_SHAPES[definitionId] || 'single';
}

/**
 * Validate ONE incoming official/screening response row.
 * Returns null when valid, or a string reason. Never coerces a value.
 */
function validateOasisResponseRow(row, ctx) {
  if (!row || typeof row !== 'object') return 'row_not_an_object';
  const schemaId = row.response_schema_id;
  if (!schemaId) return 'missing_response_schema';
  if (!OASIS_KNOWN_RESPONSE_SCHEMAS.includes(schemaId)) return 'unknown_response_schema';
  // Stale client / obsolete schema: v1 is never writable again.
  if (!OASIS_WRITABLE_RESPONSE_SCHEMAS.includes(schemaId)) return 'obsolete_response_schema';

  const defId = row.definition_id;
  if (!defId || !Object.prototype.hasOwnProperty.call(OASIS_V2_CODES, defId)) return 'unknown_definition';

  const isScreening = OASIS_V2_SCREENING_IDS.includes(defId);
  if (isScreening && row.item_number) return 'screening_item_wearing_m_number';
  if (!isScreening) {
    const expected = OASIS_V2_ITEM_NUMBERS[defId];
    if (row.item_number && row.item_number !== expected) return 'item_number_mismatch';
    if (row.item_source !== 'cms_item') return 'inconsistent_item_source';
    if (row.item_spec_version !== ctx.instrument) return 'inconsistent_instrument_version';
  } else if (row.item_source !== 'pennsync_screening') {
    return 'inconsistent_item_source';
  }

  const applicable = OASIS_V2_APPLICABILITY[defId] || [];
  if (!ctx.timepoint) return 'unresolved_timepoint';
  if (!applicable.includes(ctx.timepoint)) return 'item_not_applicable_at_timepoint';

  const shape = oasisShapeOf(defId);
  if (row.response_shape && row.response_shape !== shape) return 'invalid_response_shape';
  const valid = OASIS_V2_CODES[defId];
  const omitted = (OASIS_V2_CODE_OMISSIONS[defId] || {})[ctx.timepoint] || [];
  const value = row.response_value;
  if (!value || typeof value !== 'object' || Array.isArray(value)) return 'invalid_response_shape';

  if (shape === 'multi_select') {
    const codes = value.codes;
    if (!Array.isArray(codes) || codes.length === 0) return 'invalid_response_shape';
    if (new Set(codes).size !== codes.length) return 'invalid_code';
    for (const c of codes) {
      if (typeof c !== 'string' || !valid.includes(c) || omitted.includes(c)) return 'invalid_code';
    }
    for (const ex of OASIS_V2_EXCLUSIVE_CODES[defId] || []) {
      if (codes.includes(ex) && codes.length > 1) return 'mutually_exclusive_response';
    }
  } else if (shape === 'grid') {
    const rows = value.rows;
    if (!Array.isArray(rows)) return 'invalid_response_shape';
    const required = OASIS_V2_GRID_ROWS[defId] || [];
    const seen = [];
    for (const r of rows) {
      if (!r || typeof r !== 'object') return 'invalid_grid_row';
      if (!required.includes(r.row_id)) return 'invalid_grid_row';
      if (seen.includes(r.row_id)) return 'invalid_grid_row';
      if (typeof r.code !== 'string' || !valid.includes(r.code) || omitted.includes(r.code)) return 'invalid_code';
      seen.push(r.row_id);
    }
    if (required.some((r) => !seen.includes(r))) return 'missing_grid_row';
  } else {
    const keys = Object.keys(value);
    if (keys.length !== 1 || keys[0] !== 'code') return 'invalid_response_shape';
    if (typeof value.code !== 'string' || !valid.includes(value.code) || omitted.includes(value.code)) return 'invalid_code';
  }

  if (row.response_origin !== 'clinician_selected') return 'response_not_clinician_selected';
  if (row.ai_suggested === true) return 'ai_originated_response';
  if (!row.selected_by || typeof row.selected_by !== 'string') return 'missing_selecting_clinician';
  if (!row.selected_at || Number.isNaN(Date.parse(String(row.selected_at)))) return 'missing_selection_timestamp';
  return null;
}

/**
 * Validate a whole incoming write. Returns { ok, errors: [{index, reason}] }.
 * Fails closed: an unresolved date or time point rejects every row.
 */
function validateOasisResponseWrite(payload) {
  const errors = [];
  const instrument = oasisResolveInstrument(payload && payload.assessment_date);
  if (!instrument.resolved) {
    return { ok: false, errors: [{ index: -1, reason: instrument.reason }] };
  }
  const timepoint = oasisVisitTypeToTimepoint(payload && payload.visit_type);
  if (!timepoint) return { ok: false, errors: [{ index: -1, reason: 'unresolved_timepoint' }] };
  if (payload && payload.response_schema_id
      && !OASIS_WRITABLE_RESPONSE_SCHEMAS.includes(payload.response_schema_id)) {
    return { ok: false, errors: [{ index: -1, reason: 'obsolete_response_schema' }] };
  }
  const rows = Array.isArray(payload && payload.oasis_items) ? payload.oasis_items : [];
  const ctx = { instrument: instrument.instrument, timepoint };
  rows.forEach((row, index) => {
    const reason = validateOasisResponseRow(row, ctx);
    if (reason) errors.push({ index, reason });
  });
  return { ok: errors.length === 0, errors, instrument: instrument.instrument, timepoint };
}
// <<<END SHARED HELPER: oasisResponseGuard>>>

// Rollout flags live on AgencySettings, not Agency.
//
// Two reasons, both fatal to the alternative: `Agency` defines no
// `feature_access`/`features` object at all (only an `enabled_features` page
// list), and its read RLS is admin-only — so a clinician, who is the primary
// caller of this endpoint, could never resolve their own agency's flag. Reading
// it there would have made this path return `feature_disabled` for everyone.
//
// These are FLAT fields on the row, not members of a nested bag. The frontend
// gate in `src/components/oasis/responseSchema/featureFlag.js` reads the same
// two field names off the same entity, so the two layers cannot drift into
// disagreeing about whether the feature is on.
const OASIS_V2_FLAG_FIELD = 'oasis_response_schema_v2_enabled';
const OASIS_WRITE_KILL_SWITCH_FIELD = 'oasis_response_writes_disabled';

Deno.serve(async (req) => {
  if (req.method !== 'POST') {
    return Response.json({ error: 'Method not allowed' }, { status: 405 });
  }

  const base44 = createClientFromRequest(req);
  const user = await base44.auth.me().catch(() => null);
  if (!user) return Response.json({ error: 'Unauthorized' }, { status: 401 });
  if (isDeactivatedUser(user)) return DEACTIVATED_USER_RESPONSE();

  let payload: any;
  try {
    payload = await req.json();
  } catch {
    return Response.json({ error: 'Invalid JSON body' }, { status: 400 });
  }

  const assessmentId = payload?.assessment_id ? String(payload.assessment_id) : '';

  // Feature gate + kill switch. Reading is never gated; only NEW v2 writes are.
  //
  // Resolved through the shared agency-scoped helper, NOT a newest-row-wins
  // `list()`. AgencySettings read RLS is open, so a global newest-row read
  // returns whichever tenant wrote last: agency A's rollout flag would govern
  // agency B's writes, and — the serious direction — B flipping its own kill
  // switch would not stop B's writes while A's newer row still says false. A
  // control that exists to contain an incident without a deploy must not be
  // silently answerable by another tenant.
  //
  // A keyed miss returns null, which both gates below treat as "not enabled".
  const settings: any = await resolveAgencySettings(base44, user?.agency_name);

  if (settings && settings[OASIS_WRITE_KILL_SWITCH_FIELD] === true) {
    return Response.json(
      { error: 'OASIS response writes are temporarily disabled for this agency.', reason: 'write_kill_switch' },
      { status: 423 },
    );
  }
  // Fail closed: no resolvable settings row for THIS agency, or the flag
  // absent/false, means not enabled.
  if (!settings || settings[OASIS_V2_FLAG_FIELD] !== true) {
    return Response.json(
      {
        error: 'CMS-aligned OASIS response entry is not enabled for this agency.',
        reason: 'feature_disabled',
      },
      { status: 403 },
    );
  }

  // ── Selector provenance, established BEFORE validation ────────────────────
  // The selector is the authenticated user, never a client-supplied string: a
  // request could otherwise record a response as chosen by another clinician,
  // which is exactly the attestation provenance this path exists to establish.
  //
  // A row claiming somebody else is REJECTED rather than quietly rewritten, so
  // a client bug surfaces instead of producing a record whose provenance
  // silently differs from what was sent. A row that simply omits the field is
  // fine — the server fills it in below, then the validator still checks it is
  // present, so the guarantee holds even if this injection is ever removed.
  const selectorEmail = String(user?.email || '').trim();
  if (!selectorEmail) {
    return Response.json(
      { error: 'Cannot record a clinician selection without an authenticated email.', reason: 'no_selector_identity' },
      { status: 403 },
    );
  }
  const impostor = (payload.oasis_items || []).findIndex(
    (r: any) => r?.selected_by && String(r.selected_by).trim().toLowerCase() !== selectorEmail.toLowerCase(),
  );
  if (impostor >= 0) {
    return Response.json(
      {
        error: 'A response may only be recorded as selected by the signed-in clinician.',
        reason: 'selector_mismatch',
        errors: [{ index: impostor, reason: 'selector_is_not_the_authenticated_user' }],
      },
      { status: 403 },
    );
  }
  if (Array.isArray(payload.oasis_items)) {
    payload.oasis_items = payload.oasis_items.map((r: any) => ({ ...r, selected_by: selectorEmail }));
  }

  const validation = validateOasisResponseWrite(payload);
  if (!validation.ok) {
    const stale = validation.errors.some((e: any) => e.reason === 'obsolete_response_schema');
    return Response.json(
      {
        error: stale
          ? 'This browser tab is running an older version of PennSync and cannot save OASIS responses. Refresh the page and re-enter the response.'
          : 'One or more responses were rejected. No data was saved.',
        reason: stale ? 'stale_client' : 'validation_failed',
        errors: validation.errors,
      },
      { status: stale ? 409 : 422 },
    );
  }

  // Every stored row is stamped by the server, not trusted from the client.
  const nowIso = new Date().toISOString();
  const rows = (payload.oasis_items || []).map((row: any) => ({
    definition_id: row.definition_id,
    item_number: row.item_number ?? null,
    item_name: row.item_name ?? null,
    item_source: row.item_source,
    item_spec_version: row.item_spec_version ?? null,
    response_schema_id: row.response_schema_id,
    response_shape: row.response_shape ?? null,
    response_value: row.response_value,
    response_origin: 'clinician_selected',
    // Derived from the authenticated identity, NOT copied from the request.
    // A client-supplied selector would let any authenticated caller record a
    // response as having been chosen by another clinician, which is exactly the
    // attestation provenance this path exists to establish.
    selected_by: selectorEmail,
    selected_at: row.selected_at,
    ai_suggested: false,
  }));

  const record: any = {
    patient_id: payload.patient_id,
    visit_id: payload.visit_id ?? null,
    visit_type: payload.visit_type,
    assessment_date: payload.assessment_date,
    oasis_items: rows,
    response_schema_id: 'pennsync-oasis-response-v2-cms-e2',
    instrument_version: validation.instrument,
    response_schema_source: 'final-oasis-e2-all-item-04-01-2026',
    migration_status: 'native_v2',
    last_written_by: user?.email || null,
    last_written_at: nowIso,
  };
  if (payload.status) record.status = payload.status;

  try {
    const saved = assessmentId
      ? await base44.entities.OASISAssessment.update(assessmentId, record)
      : await base44.entities.OASISAssessment.create(record);
    return Response.json({ ok: true, assessment: saved, written: rows.length });
  } catch (err) {
    return Response.json(
      { error: 'Failed to save OASIS responses', detail: String((err as any)?.message || err) },
      { status: 500 },
    );
  }
});
