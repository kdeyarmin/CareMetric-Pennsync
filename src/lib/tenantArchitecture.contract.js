import test from 'node:test';
import assert from 'node:assert/strict';
import {
  PHYSICIAN_AGENCY_OVERLAY_FIELDS,
  PHYSICIAN_MASTER_FIELDS,
  READINESS_FIXTURE_TARGET,
  buildReadinessFixturePlan,
  inheritContentScope,
  splitPhysicianMasterAndAgencyOverlay,
  validateContentScopeBinding,
  validateReadinessFixtureActorBindings,
} from './tenantArchitecture.js';

const actorBindings = () => ({
  admin_a: { user_id: 'user-admin-a', email: 'Admin-A@Example.test' },
  clinician_a: { user_id: 'user-clinician-a', email: 'Clinician-A@Example.test' },
  clinician_a_empty: { user_id: 'user-clinician-a-empty', email: 'Empty-A@Example.test' },
  admin_b: { user_id: 'user-admin-b', email: 'Admin-B@Example.test' },
});

test('readiness fixture is pinned to the reviewed isolated staging target and exact topology', () => {
  const plan = buildReadinessFixturePlan(actorBindings());
  assert.equal(plan.target, READINESS_FIXTURE_TARGET);
  assert.equal(plan.target.appId, '6a9881683dc68a0bd54f1ef7');
  assert.equal(plan.target.fixtureSetId, 'lr01-lr02-two-agency-v1');
  assert.deepEqual(Object.keys(plan.actors), [
    'admin_a', 'clinician_a', 'clinician_a_empty', 'admin_b',
  ]);
  assert.deepEqual(Object.keys(plan.agencies), ['agency_a', 'agency_b']);
  assert.deepEqual(plan.agencies, {
    agency_a: { status: 'active', adminActor: 'admin_a' },
    agency_b: { status: 'active', adminActor: 'admin_b' },
  });
  assert.deepEqual(Object.keys(plan.patients), ['a1', 'a2', 'b1']);
  assert.deepEqual(plan.assignments, [
    { patient: 'a1', actor: 'clinician_a', status: 'active', source: 'manual' },
  ]);
  assert.deepEqual(plan.patients.a1, {
    agency: 'agency_a',
    creator: 'admin_a',
    status: 'active',
    isSample: false,
    isArchived: false,
  });
  assert.deepEqual(plan.forbiddenData, ['password', 'token', 'secret', 'production_phi']);
});

test('readiness fixture rejects missing, extra, duplicate, or non-canonical actor identities', () => {
  const valid = actorBindings();
  assert.equal(validateReadinessFixtureActorBindings(valid).admin_a.email, 'admin-a@example.test');

  const missing = actorBindings();
  delete missing.admin_b;
  assert.throws(() => validateReadinessFixtureActorBindings(missing), /exactly/);

  assert.throws(
    () => validateReadinessFixtureActorBindings({ ...actorBindings(), extra: valid.admin_b }),
    /exactly/,
  );

  const duplicate = actorBindings();
  duplicate.admin_b = { ...duplicate.admin_b, user_id: duplicate.admin_a.user_id };
  assert.throws(() => validateReadinessFixtureActorBindings(duplicate), /distinct/);

  const injected = actorBindings();
  injected.admin_b = { ...injected.admin_b, user_id: '$ne' };
  assert.throws(() => validateReadinessFixtureActorBindings(injected), /exact identifier/);
});

test('hybrid content scope requires either global scope or one exact agency', () => {
  assert.deepEqual(validateContentScopeBinding({
    entity_name: 'EducationMaterial',
    resource_id: 'material-1',
    scope_type: 'global',
  }), {
    entityName: 'EducationMaterial',
    resourceId: 'material-1',
    scopeType: 'global',
    agencyId: null,
  });

  assert.deepEqual(validateContentScopeBinding({
    entity_name: 'PDFTemplate',
    resource_id: 'template-1',
    scope_type: 'agency',
    agency_id: 'agency-a',
  }).agencyId, 'agency-a');

  assert.throws(() => validateContentScopeBinding({
    entity_name: 'EducationMaterial',
    resource_id: 'material-1',
    scope_type: 'global',
    agency_id: 'agency-a',
  }), /exactly/);
  assert.throws(() => validateContentScopeBinding({
    entity_name: 'TrainingModule',
    resource_id: 'module-1',
    scope_type: 'global',
  }), /allowlisted scope root/);
});

test('learning-plan courses and training modules inherit only from exact verified parents', () => {
  const inherited = inheritContentScope({
    entity_name: 'TrainingCourse',
    resource_id: 'course-1',
    scope_type: 'agency',
    agency_id: 'agency-a',
  }, 'TrainingModule', 'module-1', 'course-1');
  assert.deepEqual(inherited, {
    entityName: 'TrainingModule',
    resourceId: 'module-1',
    parentEntity: 'TrainingCourse',
    parentResourceId: 'course-1',
    scopeType: 'agency',
    agencyId: 'agency-a',
  });
  assert.throws(() => inheritContentScope({
    entity_name: 'TrainingCourse',
    resource_id: 'course-other',
    scope_type: 'global',
  }, 'TrainingModule', 'module-1', 'course-1'), /exact verified parent/);
});

test('physician master and agency-private overlay fields cannot be mixed accidentally', () => {
  const split = splitPhysicianMasterAndAgencyOverlay({
    full_name: 'Taylor Example, MD',
    fax_number: '5550001000',
    npi_number: '1234567893',
    notes: 'Agency-private note',
    tags: ['preferred'],
    referral_count: 2,
  });
  assert.deepEqual(split.master, {
    full_name: 'Taylor Example, MD',
    fax_number: '5550001000',
    npi_number: '1234567893',
  });
  assert.deepEqual(split.overlay, {
    status: 'quarantined',
    notes: 'Agency-private note',
    tags: ['preferred'],
    referral_count: 2,
  });
  assert.deepEqual(splitPhysicianMasterAndAgencyOverlay({
    full_name: 'Active Example, MD',
    fax_number: '5550001002',
    is_active: true,
  }).overlay, { status: 'active' });
  assert.deepEqual(splitPhysicianMasterAndAgencyOverlay({
    full_name: 'Inactive Example, MD',
    fax_number: '5550001001',
    is_active: false,
  }).overlay, { status: 'inactive' });
  assert.throws(
    () => splitPhysicianMasterAndAgencyOverlay({
      full_name: 'X', fax_number: '1', is_active: 'yes',
    }),
    /must be a boolean/,
  );
  assert.throws(
    () => splitPhysicianMasterAndAgencyOverlay({
      full_name: 'X', fax_number: '1', referral_count: 1.5,
    }),
    /non-negative integer/,
  );
  assert.throws(
    () => splitPhysicianMasterAndAgencyOverlay({ full_name: 'X', fax_number: '1', agency_id: 'a' }),
    /Unsupported Physician field/,
  );
});

test('physician split fields are backed by their exact persisted schemas', async () => {
  const { readFile } = await import('node:fs/promises');
  const JSON5 = (await import('json5')).default;
  const physician = JSON5.parse(await readFile(
    new URL('../../base44/entities/Physician.jsonc', import.meta.url),
    'utf8',
  ));
  const profile = JSON5.parse(await readFile(
    new URL('../../base44/entities/PhysicianAgencyProfile.jsonc', import.meta.url),
    'utf8',
  ));

  assert.deepEqual(
    PHYSICIAN_MASTER_FIELDS.filter((field) => !physician.properties[field]),
    [],
  );
  assert.deepEqual(
    PHYSICIAN_AGENCY_OVERLAY_FIELDS.filter((field) => !profile.properties[field]),
    [],
  );
  assert.equal(profile.properties.is_active, undefined);
});
