export const READINESS_FIXTURE_TARGET = Object.freeze({
  environment: 'staging',
  appId: '6a9881683dc68a0bd54f1ef7',
  origin: 'https://caremetric-pennsync-staging-2026-09-d54f1ef7.base44.app/',
  fixtureSetId: 'lr01-lr02-two-agency-v1',
});

export const READINESS_FIXTURE_ACTORS = Object.freeze({
  admin_a: Object.freeze({ agency: 'agency_a', tenantRole: 'agency_admin' }),
  clinician_a: Object.freeze({ agency: 'agency_a', tenantRole: 'clinician' }),
  clinician_a_empty: Object.freeze({ agency: 'agency_a', tenantRole: 'clinician' }),
  admin_b: Object.freeze({ agency: 'agency_b', tenantRole: 'agency_admin' }),
});

export const READINESS_FIXTURE_PATIENTS = Object.freeze({
  a1: Object.freeze({ agency: 'agency_a', creator: 'admin_a' }),
  a2: Object.freeze({ agency: 'agency_a', creator: 'admin_a' }),
  b1: Object.freeze({ agency: 'agency_b', creator: 'admin_b' }),
});

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

export const PHYSICIAN_AGENCY_OVERLAY_FIELDS = Object.freeze([
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

const ACTOR_KEYS = Object.freeze(Object.keys(READINESS_FIXTURE_ACTORS));
const CONTENT_ROOT_SET = new Set(SCOPED_CONTENT_ROOTS);
const PHYSICIAN_MASTER_SET = new Set(PHYSICIAN_MASTER_FIELDS);
const PHYSICIAN_OVERLAY_SET = new Set(PHYSICIAN_AGENCY_OVERLAY_FIELDS);

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
    agencies: Object.freeze({
      agency_a: Object.freeze({ status: 'active', adminActor: 'admin_a' }),
      agency_b: Object.freeze({ status: 'active', adminActor: 'admin_b' }),
    }),
    patients: READINESS_FIXTURE_PATIENTS,
    assignments: Object.freeze([
      Object.freeze({ patient: 'a1', actor: 'clinician_a', status: 'active', source: 'manual' }),
    ]),
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
  const overlay = {};
  for (const [field, value] of Object.entries(input)) {
    if (PHYSICIAN_MASTER_SET.has(field)) master[field] = value;
    else if (PHYSICIAN_OVERLAY_SET.has(field)) overlay[field] = value;
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
