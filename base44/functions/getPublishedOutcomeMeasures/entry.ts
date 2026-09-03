import { createClientFromRequest } from 'npm:@base44/sdk@0.8.31';

// <<<BEGIN SHARED HELPER: requireActiveUser — generated, edit base44/_shared/backendHelpers.mjs>>>
const isDeactivatedUser = (u) => !!u && u.is_active === false;
const DEACTIVATED_USER_RESPONSE = () => Response.json(
  { error: 'Unauthorized - account is deactivated' },
  { status: 403 },
);
// <<<END SHARED HELPER: requireActiveUser>>>

/**
 * Publication-aware, read-only broker for derived outcome data.
 *
 * The browser cannot read the service-owned outcome entities directly. This
 * broker resolves a server-owned tenant membership, selects one complete
 * published generation, reconciles both cohorts, and returns a narrow view.
 * It deliberately has no computation or mutation path.
 */

const PAGE_SIZE = 100;
const MEMBERSHIP_ROW_CAP = 100;
const AGENCY_ROW_CAP = 10;
const PUBLISHED_RUN_ROW_CAP = 25;
// This endpoint returns a rich, agency-wide PHI payload rather than a cursor.
// Until a separately designed snapshot-bound pagination contract exists, a
// published cohort above 500 rows is unavailable instead of being truncated or
// returned as one oversized response.
const PATIENT_METRIC_ROW_CAP = 500;
const AGENCY_KPI_ROW_CAP = 100;
const MAX_IDENTIFIER_LENGTH = 200;
const MAX_TEXT_LENGTH = 1_000;
const MAX_MEMBERSHIP_REASON_LENGTH = 500;
const PUBLICATION_MODE = 'single_run_record_gate_v1';
const HASH_PATTERN = /^[a-f0-9]{64}$/;
const DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;
const PERIOD_TYPES = new Set([
  'daily',
  'weekly',
  'monthly',
  'quarterly',
  'yearly',
  'custom',
]);
const TENANT_ROLES = new Set([
  'agency_admin',
  'manager',
  'clinician',
  'office_staff',
  'social_worker',
  'spiritual_care',
]);
const MEMBERSHIP_STATUSES = new Set(['pending', 'active', 'suspended', 'revoked']);
const OUTCOME_READER_ROLES = new Set(['agency_admin', 'manager']);
const ACTIVE_AGENCY_STATUSES = new Set(['active', 'trial']);
const OPTIONAL_METRIC_FIELDS = new Set([
  'discharge_disposition',
  'primary_diagnosis',
  'internal_gg_18_item_raw_sum',
]);
const DISCHARGE_DISPOSITIONS = new Set([
  'remained_home',
  'remained_community_with_hha',
  'non_institutional_hospice',
  'moved_out_of_service_area',
  'hospital',
  'snf',
  'deceased',
  'other',
]);
const IMPROVEMENT_FIELDS = [
  'ambulation_improved',
  'bathing_improved',
  'transferring_improved',
  'medication_management_improved',
  'dyspnea_improved',
] as const;
const MEASURE_STATUSES = new Set(['improved', 'not_improved', 'excluded']);
const KPI_STATUSES = new Set(['on_target', 'warning', 'critical']);

type EntityRow = Record<string, any>;

type BrokerRequest = {
  agencyId: string;
  periodType: string;
  periodStart: string;
  periodEnd: string;
};

type PublishedRun = {
  id: string;
  agencyId: string;
  runKey: string;
  windowKey: string;
  attemptId: string;
  publicationMode: string;
  periodType: string;
  periodStart: string;
  periodEnd: string;
  calculationVersion: string;
  startedAt: string;
  publishedAt: string;
  generationFingerprint: string;
  patientMetricCount: number;
  agencyKpiCount: number;
};

class PublicError extends Error {
  status: number;

  constructor(status: number, message: string) {
    super(message);
    this.name = 'PublicError';
    this.status = status;
  }
}

const conflict = (message: string): never => {
  throw new PublicError(409, message);
};

const normalizeEmail = (value: unknown) =>
  typeof value === 'string' ? value.trim().toLowerCase() : '';

function canonicalEmail(value: unknown) {
  const normalized = normalizeEmail(value);
  if (!normalized || normalized.length > 320 || !normalized.includes('@') || /\s/.test(normalized)) {
    return null;
  }
  return normalized;
}

function exactIdentifier(value: unknown) {
  if (
    typeof value !== 'string'
    || !value
    || value.length > MAX_IDENTIFIER_LENGTH
    || value.trim() !== value
  ) return null;
  return value;
}

function exactText(value: unknown, maxLength = MAX_TEXT_LENGTH) {
  if (
    typeof value !== 'string'
    || !value
    || value.length > maxLength
    || value.trim() !== value
  ) return null;
  return value;
}

function boundedMembershipReason(value: unknown) {
  if (typeof value !== 'string') return null;
  const reason = value.trim();
  if (!reason || reason.length > MAX_MEMBERSHIP_REASON_LENGTH) return null;
  return reason;
}

function exactDate(value: unknown) {
  if (typeof value !== 'string' || !DATE_PATTERN.test(value)) return null;
  const parsed = new Date(`${value}T00:00:00.000Z`);
  if (!Number.isFinite(parsed.getTime()) || parsed.toISOString().slice(0, 10) !== value) return null;
  return value;
}

function exactTimestamp(value: unknown) {
  if (typeof value !== 'string') return null;
  const parsed = new Date(value);
  if (!Number.isFinite(parsed.getTime()) || parsed.toISOString() !== value) return null;
  return value;
}

function requireRows(value: unknown, label: string) {
  if (!Array.isArray(value)) throw new Error(`${label} returned a non-array result`);
  return value as EntityRow[];
}

function isProtectedPlatformOwner(user: EntityRow) {
  const configuredEmail = canonicalEmail(Deno.env.get('SUPER_ADMIN_EMAIL'));
  return !!configuredEmail
    && user.role === 'admin'
    && canonicalEmail(user.email) === configuredEmail;
}

async function sha256Hex(value: string) {
  const bytes = new TextEncoder().encode(value);
  const digest = await crypto.subtle.digest('SHA-256', bytes);
  return Array.from(new Uint8Array(digest))
    .map((byte) => byte.toString(16).padStart(2, '0'))
    .join('');
}

// <<<BEGIN OUTCOME ROW CONTENT HASH V1>>>
const PATIENT_OUTCOME_METRIC_CONTENT_FIELDS = Object.freeze([
  'agency_id',
  'outcome_computation_run_id',
  'outcome_computation_attempt_id',
  'generation_fingerprint',
  'optional_fields_present',
  'patient_id',
  'episode_start',
  'episode_end',
  'discharge_disposition',
  'primary_diagnosis',
  'functional_improvement',
  'internal_gg_18_item_raw_sum',
  'measure_results',
  'outcome_measure_source',
  'input_response_schema_ids',
  'source_assessment_ids',
  'instrument_versions',
  'calculation_version',
]);
const AGENCY_KPI_CONTENT_FIELDS = Object.freeze([
  'agency_id',
  'outcome_computation_run_id',
  'outcome_computation_attempt_id',
  'generation_fingerprint',
  'is_current',
  'metric_name',
  'metric_category',
  'period_type',
  'period_start',
  'period_end',
  'metric_value',
  'benchmark_value',
  'unit',
  'status',
  'input_response_schema_ids',
  'calculation_version',
  'excluded_episode_count',
  'contributing_factors',
]);

function canonicalOutcomeJsonValue(value) {
  if (value === null || typeof value === 'string' || typeof value === 'boolean') return value;
  if (typeof value === 'number') {
    if (!Number.isFinite(value)) throw new Error('Outcome row content contains a non-finite number');
    return value;
  }
  if (Array.isArray(value)) return value.map((item) => canonicalOutcomeJsonValue(item));
  if (value && typeof value === 'object') {
    const result = {};
    for (const key of Object.keys(value).sort()) {
      if (value[key] !== undefined) result[key] = canonicalOutcomeJsonValue(value[key]);
    }
    return result;
  }
  throw new Error('Outcome row content contains an unsupported value');
}

function canonicalOutcomeRowPayload(row, fields) {
  const payload = {};
  for (const field of fields) {
    if (Object.hasOwn(row, field) && row[field] !== undefined) payload[field] = row[field];
  }
  return canonicalOutcomeJsonValue(payload);
}

async function outcomeRowContentHash(row, fields) {
  return sha256Hex(JSON.stringify(canonicalOutcomeRowPayload(row, fields)));
}
// <<<END OUTCOME ROW CONTENT HASH V1>>>

async function requireMatchingRowContentHash(
  row: EntityRow,
  fields: readonly string[],
  label: string,
) {
  const storedHash = typeof row?.row_content_hash === 'string' ? row.row_content_hash : '';
  if (!HASH_PATTERN.test(storedHash)) conflict(`${label} has a missing or invalid content hash`);
  let recomputedHash: string;
  try {
    recomputedHash = await outcomeRowContentHash(row, fields);
  } catch {
    conflict(`${label} contains unhashable content`);
  }
  if (storedHash !== recomputedHash) conflict(`${label} content changed after hashing`);
}

async function parseRequest(req: Request): Promise<BrokerRequest> {
  if (req.method !== 'POST') {
    throw new PublicError(405, 'Method not allowed');
  }

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    throw new PublicError(400, 'Invalid JSON body');
  }
  if (!body || typeof body !== 'object' || Array.isArray(body)) {
    throw new PublicError(400, 'Request body must be an object');
  }

  const record = body as Record<string, unknown>;
  const allowedKeys = new Set(['agency_id', 'period_type', 'period_start', 'period_end']);
  if (Object.keys(record).some((key) => !allowedKeys.has(key))) {
    throw new PublicError(400, 'Request body contains unsupported fields');
  }

  const agencyId = exactIdentifier(record.agency_id);
  const periodType = typeof record.period_type === 'string' ? record.period_type : '';
  const periodStart = exactDate(record.period_start);
  const periodEnd = exactDate(record.period_end);
  if (!agencyId) throw new PublicError(400, 'agency_id is required and must be exact');
  if (!PERIOD_TYPES.has(periodType)) throw new PublicError(400, 'period_type is invalid');
  if (!periodStart || !periodEnd || periodStart > periodEnd) {
    throw new PublicError(400, 'period_start and period_end must be valid ordered YYYY-MM-DD dates');
  }

  return { agencyId, periodType, periodStart, periodEnd };
}

async function fetchBounded(
  entity: Record<string, any>,
  query: Record<string, unknown>,
  label: string,
  maxRows: number,
) {
  if (!Number.isInteger(maxRows) || maxRows < 1) throw new Error(`${label} has an invalid row cap`);
  const rows: EntityRow[] = [];
  let skip = 0;

  while (rows.length < maxRows) {
    const limit = Math.min(PAGE_SIZE, maxRows - rows.length);
    const page = requireRows(
      await entity.filter(query, 'created_date', limit, skip),
      `${label}.filter`,
    );
    if (page.length > limit) throw new Error(`${label}.filter exceeded its requested page size`);
    rows.push(...page);
    skip += page.length;
    if (page.length < limit) return { rows, truncated: false };
  }

  const overflow = requireRows(
    await entity.filter(query, 'created_date', 1, skip),
    `${label}.filter overflow`,
  );
  if (overflow.length > 1) throw new Error(`${label}.filter overflow exceeded its requested page size`);
  return { rows, truncated: overflow.length > 0 };
}

function validateMembership(row: EntityRow, userId: string, userEmail: string) {
  const id = exactIdentifier(row?.id);
  const agencyId = exactIdentifier(row?.agency_id);
  const membershipKey = exactIdentifier(row?.membership_key);
  const storedUserId = exactIdentifier(row?.user_id);
  const storedEmail = canonicalEmail(row?.user_email_normalized);
  const tenantRole = typeof row?.tenant_role === 'string' ? row.tenant_role : '';
  const createdBy = exactIdentifier(row?.created_by_user_id);
  const transitionedBy = exactIdentifier(row?.last_transition_by_user_id);
  const transitionEmail = canonicalEmail(row?.last_transition_by_email_normalized);
  const transitionAt = Date.parse(String(row?.last_transition_at || ''));
  const transitionReason = boundedMembershipReason(row?.last_transition_reason);
  const membershipStatus = typeof row?.status === 'string' ? row.status : '';
  const activatedAt = Date.parse(String(row?.activated_at || ''));
  const revokedAt = Date.parse(String(row?.revoked_at || ''));
  const revocationReason = boundedMembershipReason(row?.revocation_reason);
  if (
    !id
    || !agencyId
    || !membershipKey
    || storedUserId !== userId
    || !storedEmail
    || row.user_email_normalized !== storedEmail
    || storedEmail !== userEmail
    || membershipKey !== `${agencyId}:${userId}`
    || !TENANT_ROLES.has(tenantRole)
    || !MEMBERSHIP_STATUSES.has(membershipStatus)
    || !Number.isSafeInteger(row?.version)
    || row.version < 1
    || !createdBy
    || !transitionedBy
    || !transitionEmail
    || row.last_transition_by_email_normalized !== transitionEmail
    || !Number.isFinite(transitionAt)
    || !transitionReason
    || ((membershipStatus === 'active' || membershipStatus === 'suspended')
      && !Number.isFinite(activatedAt))
    || (membershipStatus === 'revoked'
      && (!Number.isFinite(revokedAt) || !revocationReason))
  ) {
    conflict('Tenant membership integrity check failed');
  }
  return { id, agencyId, membershipKey, tenantRole, status: membershipStatus };
}

async function authorizeAgency(entities: Record<string, any>, user: EntityRow, agencyId: string) {
  const userId = exactIdentifier(user?.id);
  const userEmail = canonicalEmail(user?.email);
  if (!userId || !userEmail) throw new PublicError(403, 'Immutable user identity is required');

  const membershipPage = await fetchBounded(
    entities.AgencyMembership,
    { user_id: userId },
    'AgencyMembership',
    MEMBERSHIP_ROW_CAP,
  );
  if (membershipPage.truncated) conflict('Tenant membership is ambiguous');

  // Read every lifecycle state for this immutable user id. Filtering only
  // active rows would hide an active+revoked duplicate and let ambiguous
  // authority survive indefinitely.
  const exactUserRows = membershipPage.rows.filter((row) => row?.user_id === userId);
  const memberships = exactUserRows.map((row) => validateMembership(row, userId, userEmail));
  const seenIds = new Set<string>();
  const seenKeys = new Set<string>();
  const seenAgencies = new Set<string>();
  for (const membership of memberships) {
    if (
      seenIds.has(membership.id)
      || seenKeys.has(membership.membershipKey)
      || seenAgencies.has(membership.agencyId)
    ) conflict('Tenant membership is ambiguous');
    seenIds.add(membership.id);
    seenKeys.add(membership.membershipKey);
    seenAgencies.add(membership.agencyId);
  }

  const selected = memberships.find(
    (membership) => membership.agencyId === agencyId && membership.status === 'active',
  ) || null;
  const isPlatformOwner = isProtectedPlatformOwner(user);
  if (isPlatformOwner) {
    return {
      source: 'protected_platform_owner',
      isPlatformOwner: true,
    };
  }
  if (!selected) {
    throw new PublicError(403, 'No active membership for agency');
  }
  if (!OUTCOME_READER_ROLES.has(selected.tenantRole)) {
    throw new PublicError(403, 'Agency administrator or manager membership is required');
  }
  return {
    source: 'agency_membership',
    isPlatformOwner: false,
  };
}

async function loadExactActiveAgency(entities: Record<string, any>, agencyId: string) {
  const page = await fetchBounded(
    entities.Agency,
    { id: agencyId },
    'Agency',
    AGENCY_ROW_CAP,
  );
  if (page.truncated) conflict('Agency is ambiguous');
  const matches = page.rows.filter((row) => row?.id === agencyId);
  if (matches.length === 0) throw new PublicError(403, 'Agency is unavailable');
  if (matches.length !== 1) conflict('Agency is ambiguous');
  if (!ACTIVE_AGENCY_STATUSES.has(String(matches[0].status || ''))) {
    throw new PublicError(403, 'Agency is unavailable');
  }
}

function validatePublishedRun(
  row: EntityRow,
  request: BrokerRequest,
  expectedWindowKey: string,
): PublishedRun {
  const id = exactIdentifier(row?.id);
  const runKey = typeof row?.run_key === 'string' && HASH_PATTERN.test(row.run_key)
    ? row.run_key
    : null;
  const windowKey = typeof row?.window_key === 'string' && HASH_PATTERN.test(row.window_key)
    ? row.window_key
    : null;
  const attemptId = exactIdentifier(row?.attempt_id);
  const calculationVersion = exactIdentifier(row?.calculation_version);
  const startedAt = exactTimestamp(row?.started_at);
  const publishedAt = exactTimestamp(row?.published_at);
  const fingerprint = typeof row?.generation_fingerprint === 'string'
    && HASH_PATTERN.test(row.generation_fingerprint)
    ? row.generation_fingerprint
    : null;
  const patientMetricCount = row?.patient_outcome_metric_count;
  const agencyKpiCount = row?.agency_kpi_count;
  const summary = row?.result_summary;

  if (Number.isSafeInteger(patientMetricCount) && patientMetricCount > PATIENT_METRIC_ROW_CAP) {
    conflict(`Published patient outcome cohort exceeds the ${PATIENT_METRIC_ROW_CAP}-row response safety cap`);
  }

  if (
    !id
    || !runKey
    || !windowKey
    || windowKey !== expectedWindowKey
    || !attemptId
    || !calculationVersion
    || !startedAt
    || !publishedAt
    || publishedAt < startedAt
    || !fingerprint
    || row?.agency_id !== request.agencyId
    || row?.status !== 'published'
    || row?.publication_mode !== PUBLICATION_MODE
    || row?.period_type !== request.periodType
    || row?.period_start !== request.periodStart
    || row?.period_end !== request.periodEnd
    || !Number.isSafeInteger(patientMetricCount)
    || patientMetricCount < 0
    || !Number.isSafeInteger(agencyKpiCount)
    || agencyKpiCount < 0
    || agencyKpiCount > AGENCY_KPI_ROW_CAP
    || !summary
    || typeof summary !== 'object'
    || Array.isArray(summary)
    || summary.success !== true
    || summary.agency_id !== request.agencyId
    || summary.period_type !== request.periodType
    || summary.period_start !== request.periodStart
    || summary.period_end !== request.periodEnd
    || summary.calculation_version !== calculationVersion
    || summary.generation_fingerprint !== fingerprint
    || summary.patient_outcome_metrics_written !== patientMetricCount
    || summary.agency_kpis_written !== agencyKpiCount
  ) {
    conflict('Published outcome run metadata is incomplete or inconsistent');
  }

  return {
    id,
    agencyId: request.agencyId,
    runKey,
    windowKey,
    attemptId,
    publicationMode: PUBLICATION_MODE,
    periodType: request.periodType,
    periodStart: request.periodStart,
    periodEnd: request.periodEnd,
    calculationVersion,
    startedAt,
    publishedAt,
    generationFingerprint: fingerprint,
    patientMetricCount,
    agencyKpiCount,
  };
}

async function loadOnlyPublishedRun(
  entities: Record<string, any>,
  request: BrokerRequest,
  expectedWindowKey: string,
) {
  const query = {
    agency_id: request.agencyId,
    status: 'published',
    period_type: request.periodType,
    period_start: request.periodStart,
    period_end: request.periodEnd,
  };
  const page = await fetchBounded(
    entities.OutcomeComputationRun,
    query,
    'OutcomeComputationRun',
    PUBLISHED_RUN_ROW_CAP,
  );
  if (page.truncated) conflict('Published outcome run set exceeds the safety cap');
  const matches = page.rows.filter((row) =>
    row?.agency_id === request.agencyId
    && row?.status === 'published'
    && row?.period_type === request.periodType
    && row?.period_start === request.periodStart
    && row?.period_end === request.periodEnd);
  if (matches.length === 0) {
    throw new PublicError(404, 'No published outcome run exists for this reporting window');
  }
  if (matches.length !== 1) conflict('Multiple published outcome runs exist for this reporting window');
  return validatePublishedRun(matches[0], request, expectedWindowKey);
}

function validateTextArray(value: unknown, label: string, maxItems: number) {
  if (!Array.isArray(value) || value.length > maxItems) conflict(`${label} is invalid`);
  const result: string[] = [];
  for (const item of value) {
    const text = exactText(item);
    if (!text) conflict(`${label} is invalid`);
    result.push(text);
  }
  return result;
}

async function validateMetric(row: EntityRow, run: PublishedRun, request: BrokerRequest) {
  await requireMatchingRowContentHash(
    row,
    PATIENT_OUTCOME_METRIC_CONTENT_FIELDS,
    'Published patient outcome metric',
  );
  const id = exactIdentifier(row?.id);
  const patientId = exactIdentifier(row?.patient_id);
  const episodeStart = exactDate(row?.episode_start);
  const episodeEnd = exactDate(row?.episode_end);
  if (
    !id
    || !patientId
    || !episodeStart
    || !episodeEnd
    || episodeStart > episodeEnd
    || episodeEnd < request.periodStart
    || episodeEnd > request.periodEnd
    || row?.agency_id !== request.agencyId
    || row?.outcome_computation_run_id !== run.id
    || row?.outcome_computation_attempt_id !== run.attemptId
    || row?.generation_fingerprint !== run.generationFingerprint
    || row?.calculation_version !== run.calculationVersion
    || row?.outcome_measure_source !== 'outcome_run_staged'
  ) conflict('Published patient outcome metric metadata is inconsistent');

  if (!Array.isArray(row?.optional_fields_present) || row.optional_fields_present.length > 3) {
    conflict('Published patient outcome metric optional-field metadata is invalid');
  }
  const optionalFields = new Set<string>();
  for (const field of row.optional_fields_present) {
    if (typeof field !== 'string' || !OPTIONAL_METRIC_FIELDS.has(field) || optionalFields.has(field)) {
      conflict('Published patient outcome metric optional-field metadata is invalid');
    }
    optionalFields.add(field);
  }
  for (const field of OPTIONAL_METRIC_FIELDS) {
    if (Object.hasOwn(row, field) !== optionalFields.has(field)) {
      conflict('Published patient outcome metric optional-field metadata is inconsistent');
    }
  }

  if (optionalFields.has('discharge_disposition')
      && !DISCHARGE_DISPOSITIONS.has(row.discharge_disposition)) {
    conflict('Published patient outcome metric discharge disposition is invalid');
  }
  if (optionalFields.has('primary_diagnosis') && !exactText(row.primary_diagnosis, 500)) {
    conflict('Published patient outcome metric primary diagnosis is invalid');
  }
  if (optionalFields.has('internal_gg_18_item_raw_sum')
      && (!Number.isFinite(row.internal_gg_18_item_raw_sum)
        || row.internal_gg_18_item_raw_sum < 0
        || row.internal_gg_18_item_raw_sum > 108)) {
    conflict('Published patient outcome metric internal GG value is invalid');
  }

  const improvement = row?.functional_improvement;
  if (!improvement || typeof improvement !== 'object' || Array.isArray(improvement)) {
    conflict('Published patient outcome metric functional improvement is invalid');
  }
  const publicImprovement: Record<string, boolean | number> = {};
  for (const field of IMPROVEMENT_FIELDS) {
    if (Object.hasOwn(improvement, field)) {
      if (typeof improvement[field] !== 'boolean') {
        conflict('Published patient outcome metric functional improvement is invalid');
      }
      publicImprovement[field] = improvement[field];
    }
  }
  if (Object.hasOwn(improvement, 'overall_improvement_score')) {
    const score = improvement.overall_improvement_score;
    if (!Number.isFinite(score) || score < 0 || score > 100) {
      conflict('Published patient outcome metric functional improvement is invalid');
    }
    publicImprovement.overall_improvement_score = score;
  }

  if (!Array.isArray(row?.measure_results) || row.measure_results.length < 1
      || row.measure_results.length > 25) {
    conflict('Published patient outcome metric measure results are invalid');
  }
  const measureNames = new Set<string>();
  const measureResults = row.measure_results.map((item: unknown) => {
    if (!item || typeof item !== 'object' || Array.isArray(item)) {
      conflict('Published patient outcome metric measure results are invalid');
    }
    const measure = exactIdentifier((item as EntityRow).measure);
    const status = (item as EntityRow).status;
    const reason = exactText((item as EntityRow).reason);
    if (!measure || measureNames.has(measure) || !MEASURE_STATUSES.has(status) || !reason) {
      conflict('Published patient outcome metric measure results are invalid');
    }
    measureNames.add(measure);
    const projected: EntityRow = { measure, status, reason };
    for (const field of ['start_value', 'discharge_value']) {
      if (Object.hasOwn(item as EntityRow, field)) {
        const code = exactText((item as EntityRow)[field], MAX_IDENTIFIER_LENGTH);
        if (!code) conflict('Published patient outcome metric measure result code is invalid');
        projected[field] = code;
      }
    }
    return projected;
  });
  const schemaIds = validateTextArray(
    row?.input_response_schema_ids,
    'Published patient outcome metric response schema provenance',
    10,
  );
  if (schemaIds.length !== 2) {
    conflict('Published patient outcome metric response schema provenance is invalid');
  }

  return {
    id,
    patient_id: patientId,
    episode_start: episodeStart,
    episode_end: episodeEnd,
    optional_fields_present: [...optionalFields],
    ...(optionalFields.has('discharge_disposition')
      ? { discharge_disposition: row.discharge_disposition }
      : {}),
    ...(optionalFields.has('primary_diagnosis')
      ? { primary_diagnosis: row.primary_diagnosis }
      : {}),
    ...(optionalFields.has('internal_gg_18_item_raw_sum')
      ? { internal_gg_18_item_raw_sum: row.internal_gg_18_item_raw_sum }
      : {}),
    functional_improvement: publicImprovement,
    measure_results: measureResults,
    input_response_schema_ids: schemaIds,
    calculation_version: run.calculationVersion,
  };
}

async function validateKpi(row: EntityRow, run: PublishedRun, request: BrokerRequest) {
  await requireMatchingRowContentHash(
    row,
    AGENCY_KPI_CONTENT_FIELDS,
    'Published agency KPI',
  );
  const id = exactIdentifier(row?.id);
  const metricName = exactText(row?.metric_name, 500);
  if (
    !id
    || !metricName
    || row?.agency_id !== request.agencyId
    || row?.outcome_computation_run_id !== run.id
    || row?.outcome_computation_attempt_id !== run.attemptId
    || row?.generation_fingerprint !== run.generationFingerprint
    || row?.calculation_version !== run.calculationVersion
    || row?.is_current !== false
    || row?.metric_category !== 'quality'
    || row?.period_type !== request.periodType
    || row?.period_start !== request.periodStart
    || row?.period_end !== request.periodEnd
    || !Number.isFinite(row?.metric_value)
    || row.metric_value < 0
    || row.metric_value > 100
    || row?.unit !== '%'
    || !KPI_STATUSES.has(row?.status)
    || !Number.isInteger(row?.excluded_episode_count)
    || row.excluded_episode_count < 0
  ) conflict('Published agency KPI metadata is inconsistent');
  if (Object.hasOwn(row, 'benchmark_value')
      && (!Number.isFinite(row.benchmark_value)
        || row.benchmark_value < 0
        || row.benchmark_value > 100)) {
    conflict('Published agency KPI benchmark is invalid');
  }
  const schemaIds = validateTextArray(
    row?.input_response_schema_ids,
    'Published agency KPI response schema provenance',
    10,
  );
  if (schemaIds.length < 1) conflict('Published agency KPI response schema provenance is invalid');
  const contributingFactors = validateTextArray(
    row?.contributing_factors,
    'Published agency KPI contributing factors',
    20,
  );

  return {
    id,
    metric_name: metricName,
    metric_category: 'quality',
    period_type: request.periodType,
    period_start: request.periodStart,
    period_end: request.periodEnd,
    metric_value: row.metric_value,
    ...(Object.hasOwn(row, 'benchmark_value') ? { benchmark_value: row.benchmark_value } : {}),
    unit: '%',
    status: row.status,
    excluded_episode_count: row.excluded_episode_count,
    contributing_factors: contributingFactors,
    input_response_schema_ids: schemaIds,
    calculation_version: run.calculationVersion,
  };
}

async function loadPublishedCohort(
  entity: Record<string, any>,
  entityName: string,
  run: PublishedRun,
  expectedCount: number,
  validator: (row: EntityRow) => Promise<EntityRow>,
) {
  const page = await fetchBounded(
    entity,
    {
      agency_id: run.agencyId,
      outcome_computation_run_id: run.id,
      outcome_computation_attempt_id: run.attemptId,
    },
    entityName,
    expectedCount + 1,
  );
  if (page.truncated || page.rows.length !== expectedCount) {
    conflict(`${entityName} published cohort does not match its recorded count`);
  }

  const projected = await Promise.all(page.rows.map(validator));
  const ids = projected.map((row) => row.id);
  if (new Set(ids).size !== ids.length) conflict(`${entityName} published cohort contains duplicate ids`);
  return projected;
}

function publicationIdentity(run: PublishedRun) {
  return JSON.stringify([
    run.id,
    run.agencyId,
    run.runKey,
    run.windowKey,
    run.attemptId,
    run.publicationMode,
    run.periodType,
    run.periodStart,
    run.periodEnd,
    run.calculationVersion,
    run.startedAt,
    run.publishedAt,
    run.generationFingerprint,
    run.patientMetricCount,
    run.agencyKpiCount,
  ]);
}

Deno.serve(async (req) => {
  try {
    const base44 = createClientFromRequest(req);
    const user = await base44.auth.me().catch(() => null);
    if (isDeactivatedUser(user)) return DEACTIVATED_USER_RESPONSE();
    if (!user) return Response.json({ error: 'Unauthorized' }, { status: 401 });
    // These are deny-only built-in identity signals. An absent property does
    // not grant privilege, while any explicit unsafe value blocks before a
    // service-role entity can be read. The protected owner cannot bypass them.
    if (user.disabled === true || user.is_service === true || user.is_verified === false) {
      return Response.json({ error: 'Forbidden' }, { status: 403 });
    }

    const request = await parseRequest(req);
    const entities = base44.asServiceRole.entities;
    const authorization = await authorizeAgency(entities, user, request.agencyId);
    await loadExactActiveAgency(entities, request.agencyId);

    const expectedWindowKey = await sha256Hex(JSON.stringify([
      request.agencyId,
      request.periodType,
      request.periodStart,
      request.periodEnd,
    ]));
    const run = await loadOnlyPublishedRun(entities, request, expectedWindowKey);

    const metrics = await loadPublishedCohort(
      entities.PatientOutcomeMetric,
      'PatientOutcomeMetric',
      run,
      run.patientMetricCount,
      (row) => validateMetric(row, run, request),
    );
    const kpis = await loadPublishedCohort(
      entities.AgencyKPI,
      'AgencyKPI',
      run,
      run.agencyKpiCount,
      (row) => validateKpi(row, run, request),
    );

    const metricKeys = metrics.map((row) => JSON.stringify([
      row.patient_id,
      row.episode_start,
      row.episode_end,
    ]));
    if (new Set(metricKeys).size !== metricKeys.length) {
      conflict('PatientOutcomeMetric published cohort contains duplicate episode keys');
    }
    const kpiKeys = kpis.map((row) => JSON.stringify([
      row.metric_name,
      row.metric_category,
      row.period_start,
      row.period_end,
    ]));
    if (new Set(kpiKeys).size !== kpiKeys.length) {
      conflict('AgencyKPI published cohort contains duplicate metric keys');
    }

    // Re-read the window after both paged cohorts. If another publication became
    // visible, or the selected gate was edited, no mixed/superseded snapshot is
    // returned. Base44 does not expose snapshot isolation, so this is a bounded
    // fail-closed check rather than a claim of transactional reads.
    const finalRun = await loadOnlyPublishedRun(entities, request, expectedWindowKey);
    if (publicationIdentity(finalRun) !== publicationIdentity(run)) {
      conflict('Published outcome run changed while it was being read');
    }

    // Authorization is time-sensitive even though the published outcome rows
    // are append-only. Re-resolve the immutable membership and Agency after the
    // paged reads so a concurrent revoke, suspension, role downgrade, or tenant
    // disable cannot return an agency-wide PHI payload on stale authority.
    const finalAuthorization = await authorizeAgency(entities, user, request.agencyId);
    await loadExactActiveAgency(entities, request.agencyId);
    if (
      finalAuthorization.source !== authorization.source
      || finalAuthorization.isPlatformOwner !== authorization.isPlatformOwner
    ) {
      conflict('Agency authorization changed while outcome data was being read');
    }

    metrics.sort((a, b) => JSON.stringify([
      a.patient_id, a.episode_start, a.episode_end, a.id,
    ]).localeCompare(JSON.stringify([
      b.patient_id, b.episode_start, b.episode_end, b.id,
    ])));
    kpis.sort((a, b) => JSON.stringify([a.metric_name, a.id])
      .localeCompare(JSON.stringify([b.metric_name, b.id])));

    return Response.json({
      success: true,
      scope: {
        agency_id: request.agencyId,
        period_type: request.periodType,
        period_start: request.periodStart,
        period_end: request.periodEnd,
        authorization_source: authorization.source,
        is_platform_owner: authorization.isPlatformOwner,
      },
      publication: {
        outcome_computation_run_id: run.id,
        outcome_computation_attempt_id: run.attemptId,
        status: 'published',
        publication_mode: run.publicationMode,
        published_at: run.publishedAt,
        calculation_version: run.calculationVersion,
        generation_fingerprint: run.generationFingerprint,
        patient_outcome_metric_count: run.patientMetricCount,
        agency_kpi_count: run.agencyKpiCount,
      },
      patient_outcome_metrics: metrics,
      agency_kpis: kpis,
    });
  } catch (error) {
    if (error instanceof PublicError) {
      return Response.json({ error: error.message }, { status: error.status });
    }
    console.error('getPublishedOutcomeMeasures failed:', error);
    return Response.json({ error: 'Internal server error' }, { status: 500 });
  }
});
