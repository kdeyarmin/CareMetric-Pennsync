import {
  LIVE_READINESS_FIXTURE_ACTORS,
  LIVE_READINESS_FIXTURE_AGENCIES,
  LIVE_READINESS_FIXTURE_ASSIGNMENTS,
  LIVE_READINESS_FIXTURE_PATIENTS,
  LIVE_READINESS_FIXTURE_SET_ID,
  LIVE_READINESS_STAGING_TARGET,
} from './liveReadinessFixtureManifest.js';

const TENANT_ACTOR_KEYS = Object.freeze(
  Object.keys(LIVE_READINESS_FIXTURE_ACTORS)
    .filter((actorKey) => actorKey !== 'platform_owner'),
);

const READINESS_FIXTURE_ADMIN_ACTORS = Object.freeze(Object.fromEntries(
  Object.keys(LIVE_READINESS_FIXTURE_AGENCIES).map((agencyKey) => {
    const adminActors = TENANT_ACTOR_KEYS.filter((actorKey) => {
      const actor = LIVE_READINESS_FIXTURE_ACTORS[actorKey];
      return actor.agency === agencyKey && actor.tenant_role === 'agency_admin';
    });
    if (adminActors.length !== 1) {
      throw new Error(`Readiness fixture ${agencyKey} must have exactly one agency admin`);
    }
    return [agencyKey, adminActors[0]];
  }),
));

export const READINESS_FIXTURE_TARGET = Object.freeze({
  environment: LIVE_READINESS_STAGING_TARGET.environment,
  appId: LIVE_READINESS_STAGING_TARGET.app_id,
  origin: LIVE_READINESS_STAGING_TARGET.origin,
  fixtureSetId: LIVE_READINESS_FIXTURE_SET_ID,
});

export const READINESS_FIXTURE_ACTORS = Object.freeze(Object.fromEntries(
  TENANT_ACTOR_KEYS.map((actorKey) => {
    const actor = LIVE_READINESS_FIXTURE_ACTORS[actorKey];
    return [actorKey, Object.freeze({
      agency: actor.agency,
      tenantRole: actor.tenant_role,
    })];
  }),
));

export const READINESS_FIXTURE_PATIENTS = Object.freeze(Object.fromEntries(
  Object.entries(LIVE_READINESS_FIXTURE_PATIENTS).map(([patientKey, patient]) => (
    [patientKey, Object.freeze({
      agency: patient.agency,
      creator: patient.creator,
      status: patient.status,
      isSample: patient.is_sample,
      isArchived: patient.is_archived,
    })]
  )),
));

export const SCOPED_CONTENT_ROOTS = Object.freeze([
  'CustomValidationRule',
  'EducationMaterial',
  'LearningPlan',
  'LibraryDocument',
  'PDFTemplate',
  'TrainingCourse',
]);

export const INHERITED_CONTENT_SCOPE = Object.freeze({
  LearningPlanCourse: Object.freeze({ parentEntity: 'LearningPlan', parentField: 'plan_id' }),
  TrainingModule: Object.freeze({ parentEntity: 'TrainingCourse', parentField: 'course_id' }),
});

export const PHYSICIAN_MASTER_FIELDS = Object.freeze([
  'full_name',
  'credentials',
  'provider_type',
  'specialty',
  'subspecialty',
  'practice_name',
  'company',
  'top_unit',
  'parent_unit',
  'sub_unit',
  'office_address',
  'office_city',
  'office_state',
  'office_zip',
  'phone_number',
  'fax_number',
  'email',
  'npi_number',
  'state_license',
]);

export const PHYSICIAN_LEGACY_AGENCY_OVERLAY_FIELDS = Object.freeze([
  'accepts_home_health',
  'accepts_hospice',
  'preferred_contact_method',
  'office_hours',
  'notes',
  'tags',
  'is_active',
  'last_referral_date',
  'referral_count',
]);

export const PHYSICIAN_AGENCY_OVERLAY_FIELDS = Object.freeze([
  'status',
  ...PHYSICIAN_LEGACY_AGENCY_OVERLAY_FIELDS.filter((field) => field !== 'is_active'),
]);

const ACTOR_KEYS = TENANT_ACTOR_KEYS;
const CONTENT_ROOT_SET = new Set(SCOPED_CONTENT_ROOTS);
const PHYSICIAN_MASTER_SET = new Set(PHYSICIAN_MASTER_FIELDS);
const PHYSICIAN_LEGACY_OVERLAY_SET = new Set(PHYSICIAN_LEGACY_AGENCY_OVERLAY_FIELDS);

function exactIdentifier(value, label) {
  const hasControlCharacter = typeof value === 'string'
    && [...value].some((character) => {
      const code = character.charCodeAt(0);
      return code <= 31 || code === 127;
    });
  if (
    typeof value !== 'string'
    || value.length < 1
    || value.length > 200
    || value.trim() !== value
    || value.startsWith('$')
    || hasControlCharacter
  ) {
    throw new Error(`${label} must be an exact identifier`);
  }
  return value;
}

function canonicalEmail(value, label) {
  if (typeof value !== 'string') throw new Error(`${label} must be an email`);
  const email = value.trim().toLowerCase();
  if (!email || email.length > 320 || !email.includes('@') || /\s/.test(email)) {
    throw new Error(`${label} must be an email`);
  }
  return email;
}

function requireExactKeys(value, expected, label) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error(`${label} must be an object`);
  }
  const actual = Object.keys(value).sort();
  const wanted = [...expected].sort();
  if (JSON.stringify(actual) !== JSON.stringify(wanted)) {
    throw new Error(`${label} must contain exactly: ${wanted.join(', ')}`);
  }
}

export function validateReadinessFixtureActorBindings(bindings) {
  requireExactKeys(bindings, ACTOR_KEYS, 'actor bindings');
  const normalized = {};
  const userIds = new Set();
  const emails = new Set();

  for (const actorKey of ACTOR_KEYS) {
    const actor = bindings[actorKey];
    requireExactKeys(actor, ['user_id', 'email'], `${actorKey} binding`);
    const userId = exactIdentifier(actor.user_id, `${actorKey}.user_id`);
    const email = canonicalEmail(actor.email, `${actorKey}.email`);
    if (userIds.has(userId) || emails.has(email)) {
      throw new Error('Fixture actors must have distinct immutable User ids and emails');
    }
    userIds.add(userId);
    emails.add(email);
    normalized[actorKey] = Object.freeze({ userId, email });
  }

  return Object.freeze(normalized);
}

export function buildReadinessFixturePlan(bindings) {
  const actors = validateReadinessFixtureActorBindings(bindings);
  return Object.freeze({
    target: READINESS_FIXTURE_TARGET,
    actors,
    agencies: Object.freeze(Object.fromEntries(
      Object.entries(LIVE_READINESS_FIXTURE_AGENCIES).map(([agencyKey, agency]) => (
        [agencyKey, Object.freeze({
          status: agency.status,
          adminActor: READINESS_FIXTURE_ADMIN_ACTORS[agencyKey],
        })]
      )),
    )),
    patients: READINESS_FIXTURE_PATIENTS,
    assignments: LIVE_READINESS_FIXTURE_ASSIGNMENTS,
    forbiddenData: Object.freeze(['password', 'token', 'secret', 'production_phi']),
  });
}

export function validateContentScopeBinding(input) {
  requireExactKeys(
    input,
    input?.scope_type === 'agency'
      ? ['entity_name', 'resource_id', 'scope_type', 'agency_id']
      : ['entity_name', 'resource_id', 'scope_type'],
    'content scope binding',
  );
  if (!CONTENT_ROOT_SET.has(input.entity_name)) {
    throw new Error('Content entity must be an allowlisted scope root');
  }
  const resourceId = exactIdentifier(input.resource_id, 'resource_id');
  if (input.scope_type === 'global') {
    return Object.freeze({
      entityName: input.entity_name,
      resourceId,
      scopeType: 'global',
      agencyId: null,
    });
  }
  if (input.scope_type !== 'agency') throw new Error('scope_type must be global or agency');
  return Object.freeze({
    entityName: input.entity_name,
    resourceId,
    scopeType: 'agency',
    agencyId: exactIdentifier(input.agency_id, 'agency_id'),
  });
}

export function inheritContentScope(parentBinding, childEntity, childResourceId, parentResourceId) {
  const inheritance = INHERITED_CONTENT_SCOPE[childEntity];
  if (!inheritance) throw new Error('Child entity does not inherit content scope');
  const parent = validateContentScopeBinding(parentBinding);
  if (parent.entityName !== inheritance.parentEntity || parent.resourceId !== parentResourceId) {
    throw new Error('Child scope must come from its exact verified parent');
  }
  return Object.freeze({
    entityName: childEntity,
    resourceId: exactIdentifier(childResourceId, 'child_resource_id'),
    parentEntity: inheritance.parentEntity,
    parentResourceId: exactIdentifier(parentResourceId, 'parent_resource_id'),
    scopeType: parent.scopeType,
    agencyId: parent.agencyId,
  });
}

export function splitPhysicianMasterAndAgencyOverlay(input) {
  if (!input || typeof input !== 'object' || Array.isArray(input)) {
    throw new Error('Physician payload must be an object');
  }
  const master = {};
  const overlay = { status: 'quarantined' };
  for (const [field, value] of Object.entries(input)) {
    if (PHYSICIAN_MASTER_SET.has(field)) master[field] = value;
    else if (field === 'is_active') {
      if (typeof value !== 'boolean') throw new Error('Physician is_active must be a boolean');
      overlay.status = value ? 'active' : 'inactive';
    } else if (field === 'referral_count') {
      if (!Number.isSafeInteger(value) || value < 0) {
        throw new Error('Physician referral_count must be a non-negative integer');
      }
      overlay[field] = value;
    } else if (PHYSICIAN_LEGACY_OVERLAY_SET.has(field)) overlay[field] = value;
    else throw new Error(`Unsupported Physician field: ${field}`);
  }
  if (typeof master.full_name !== 'string' || !master.full_name.trim()) {
    throw new Error('Physician master requires full_name');
  }
  if (typeof master.fax_number !== 'string' || !master.fax_number.trim()) {
    throw new Error('Physician master requires fax_number');
  }
  return Object.freeze({ master: Object.freeze(master), overlay: Object.freeze(overlay) });
}
