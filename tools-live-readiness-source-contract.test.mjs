import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import JSON5 from "json5";
import {
  LIVE_READINESS_SOURCE_ARTIFACT_PATHS,
  LIVE_READINESS_SOURCE_CONTRACT_VERSION,
  createLiveReadinessSourceContract,
  formatLiveReadinessSourceContractErrors,
} from "./tools-live-readiness-source-contract.mjs";

function readArtifact(path) {
  return readFileSync(new URL(path, import.meta.url), "utf8");
}

function schemaName(path) {
  return path.split("/").at(-1).replace(/\.jsonc$/, "");
}

test("source contract deterministically binds the canonical fixture, schemas, brokers, and tests", () => {
  const first = createLiveReadinessSourceContract();
  const second = createLiveReadinessSourceContract();

  assert.equal(first.status, "valid_source_authority_contract");
  assert.equal(LIVE_READINESS_SOURCE_CONTRACT_VERSION, 4);
  assert.equal(first.schema_version, 4);
  assert.match(first.source_authority_contract_sha256, /^[0-9a-f]{64}$/);
  assert.equal(first.source_authority_contract_sha256, second.source_authority_contract_sha256);
  assert.equal(first.artifact_count, LIVE_READINESS_SOURCE_ARTIFACT_PATHS.length);
  assert.equal(first.checks.network_access, false);
  assert.equal(first.checks.hosted_writes, false);
  assert.equal(first.checks.authenticated_hosted_probes_executed, false);
  assert.equal(first.checks.care_team_assignment_mutations_paused, true);
  assert.equal(first.checks.staging_readiness_read_only_preflight_present, true);
  assert.equal(first.checks.referral_direct_mutation_path_present, false);
  assert.equal(first.checks.referral_immutable_tenant_broker_present, true);
  assert.equal(first.checks.referral_inbound_fax_paths_secured, true);
  assert.equal(first.checks.visit_create_uses_legacy_assignment, false);
  assert.equal(first.checks.clinical_child_schema_semantics, true);
  assert.equal(first.checks.clinical_child_broker_source_markers, true);
  assert.equal(first.checks.clinical_phi_direct_reads_denied, true);
  assert.equal(first.checks.clinical_phi_direct_writes_denied, true);
  assert.equal(first.checks.training_forge_guard_schema_semantics, true);
  assert.equal(first.checks.training_forge_guard_source_markers, true);
  assert.equal(first.checks.training_completion_direct_writes_locked, true);
  assert.equal(first.checks.training_evidence_non_admin_writes_denied, true);
  assert.equal(first.checks.authentication_source_semantics, true);
  assert.equal(first.checks.smart_note_persistence_source_markers, true);
  assert.equal(first.checks.fixture_request_assembler_source_markers, true);
  assert.equal(first.checks.tenant_architecture_source_markers, true);
  assert.equal(first.checks.runtime_import_artifact_parity, true);
  assert.equal(first.checks.readiness_topology_parity, true);
  assert.equal(first.checks.source_artifact_union_complete, true);
  assert.equal(first.checks.architecture_authority_entities_fail_closed, true);
  assert.equal(first.checks.content_scope_semantics_exact, true);
  assert.equal(first.checks.content_scope_runtime_enforcement_present, false);
  assert.equal(first.checks.training_answer_fields_denied, true);
  assert.equal(first.checks.sanitized_training_learner_projection_present, false);
  assert.equal(first.checks.mandatory_probe_source_artifacts_recorded, true);
  assert.equal(first.checks.content_schema_artifacts_recorded, true);
  assert.equal(first.checks.architecture_schema_artifacts_recorded, true);
  assert.ok(first.source_limitations.includes("authenticated_lr01_lr02_probe_artifacts_not_observed"));
  assert.ok(first.source_limitations.includes(
    "base44_atomic_referral_creation_uniqueness_not_available_or_proved",
  ));
  assert.equal(
    first.source_limitations.includes("inbound_referral_fax_matching_remains_paused"),
    false,
  );
  assert.ok(first.source_limitations.includes(
    "base44_atomic_patient_and_visit_creation_uniqueness_not_available_or_proved",
  ));
  assert.ok(first.source_limitations.includes(
    "staging_preflight_does_not_prove_login_credentials_or_later_writes",
  ));
  assert.ok(first.source_limitations.includes(
    "staging_preflight_does_not_inspect_legacy_email_or_profile_links",
  ));
  for (const limitation of [
    "staging_fixture_registry_does_not_record_referral_or_visit_teardown_ids",
    "content_scope_crud_and_legacy_classification_require_human_approval",
    "content_scope_binding_runtime_enforcement_not_implemented",
    "training_course_published_read_is_incompatible_with_agency_scoped_content",
    "training_module_generic_content_and_content_json_are_not_sanitized_learner_projections",
    "hosted_nested_field_rls_effectiveness_for_training_answers_not_observed",
    "auxiliary_tenant_aggregate_brokers_for_compliance_audit_note_conversion_and_training_assignment_not_available",
    "incident_and_user_browser_post_filtering_is_an_interim_boundary",
    "source_marker_and_regex_scanners_are_not_formal_interprocedural_containment_proofs",
  ]) assert.ok(first.source_limitations.includes(limitation), limitation);
  assert.equal(
    first.source_limitations.includes(
      "lr02_s3_referral_path_not_covered_by_a_reviewed_immutable_tenant_broker_contract",
    ),
    false,
  );
  assert.deepEqual(first.errors, []);
  assert.deepEqual(
    LIVE_READINESS_SOURCE_ARTIFACT_PATHS,
    [...new Set(LIVE_READINESS_SOURCE_ARTIFACT_PATHS)].sort(),
  );
  for (const path of [
    "base44/auth/config.jsonc",
    "base44/entities/Visit.jsonc",
    "base44/entities/OASISAssessment.jsonc",
    "base44/entities/Document.jsonc",
    "base44/entities/DocumentTenantBinding.jsonc",
    "base44/entities/TrainingCompletion.jsonc",
    "base44/entities/TrainingAttempt.jsonc",
    "base44/entities/TrainingCertificate.jsonc",
    "base44/entities/ContentScopeBinding.jsonc",
    "base44/entities/CustomValidationRule.jsonc",
    "base44/entities/EducationMaterial.jsonc",
    "base44/entities/LearningPlan.jsonc",
    "base44/entities/LearningPlanCourse.jsonc",
    "base44/entities/LibraryDocument.jsonc",
    "base44/entities/PDFTemplate.jsonc",
    "base44/entities/Physician.jsonc",
    "base44/entities/PhysicianAgencyProfile.jsonc",
    "base44/entities/StagingReadinessFixture.jsonc",
    "base44/entities/TrainingCourse.jsonc",
    "base44/entities/TrainingModule.jsonc",
    "base44/functions/readAuthorizedOASISAssessments/entry.ts",
    "base44/functions/getAuthorizedDocument/entry.ts",
    "base44/functions/listAuthorizedDocuments/entry.ts",
    "base44/functions/gradeTrainingAttempt/entry.ts",
    "base44/functions/issueCertificate/entry.ts",
    "src/components/smartNote/persistVisitNote.js",
    "src/components/auth/SignInScreen.jsx",
    "src/lib/liveReadinessFixtureManifest.test.js",
    "src/lib/tenantArchitecture.js",
    "src/lib/tenantArchitecture.contract.js",
    "base44/schemaContract.test.js",
    "tools-live-readiness-source-contract.test.mjs",
  ]) {
    assert.ok(LIVE_READINESS_SOURCE_ARTIFACT_PATHS.includes(path), path);
  }
});

test("source contract digest changes when any pinned artifact bytes change", () => {
  const baseline = createLiveReadinessSourceContract();
  const changedPath = "base44/functionTests/patientReadAuthorizationContract.test.js";
  const changed = createLiveReadinessSourceContract({
    readArtifact: (path) => `${readArtifact(path)}${path === changedPath ? "\n" : ""}`,
  });

  assert.equal(changed.status, "valid_source_authority_contract");
  assert.notEqual(
    changed.source_authority_contract_sha256,
    baseline.source_authority_contract_sha256,
  );
});

test("source contract rejects weakened server-owned authority RLS", () => {
  const changedPath = "base44/entities/AgencyMembership.jsonc";
  const weakened = createLiveReadinessSourceContract({
    readArtifact: (path) => {
      const source = readArtifact(path);
      if (path !== changedPath) return source;
      const schema = JSON.parse(source);
      schema.rls.read = true;
      return JSON.stringify(schema);
    },
  });

  assert.equal(weakened.status, "invalid_source_authority_contract");
  assert.equal(weakened.source_authority_contract_sha256, null);
  assert.ok(weakened.errors.some((error) => (
    error.path === "entities.AgencyMembership.rls.read"
  )));
});

test("source contract rejects direct Agency mutations even for administrators", () => {
  for (const operation of ['create', 'update', 'delete']) {
    const weakened = createLiveReadinessSourceContract({
      readArtifact: (path) => {
        const source = readArtifact(path);
        if (path !== 'base44/entities/Agency.jsonc') return source;
        const schema = JSON5.parse(source);
        schema.rls[operation] = { user_condition: { role: 'admin' } };
        return JSON.stringify(schema);
      },
    });
    assert.equal(weakened.status, 'invalid_source_authority_contract');
    assert.ok(weakened.errors.some(error => error.path === `entities.Agency.rls.${operation}`));
  }
});

test("source contract rejects reopened direct clinical reads", () => {
  for (const changedPath of [
    "base44/entities/Patient.jsonc",
    "base44/entities/PatientCareTeamAssignment.jsonc",
    "base44/entities/Referral.jsonc",
    "base44/entities/IncomingFax.jsonc",
    "base44/entities/Visit.jsonc",
    "base44/entities/OASISAssessment.jsonc",
    "base44/entities/Document.jsonc",
    "base44/entities/DocumentTenantBinding.jsonc",
  ]) {
    const weakened = createLiveReadinessSourceContract({
      readArtifact: (path) => {
        const source = readArtifact(path);
        if (path !== changedPath) return source;
        const schema = JSON5.parse(source);
        schema.rls.read = true;
        return JSON.stringify(schema);
      },
    });
    assert.equal(weakened.status, "invalid_source_authority_contract");
    assert.equal(weakened.checks.clinical_phi_direct_reads_denied, false);
    assert.ok(weakened.errors.some((error) => error.path.endsWith(".rls.read")));
  }
});

test("source contract rejects reopened training evidence writes", () => {
  const changedPath = "base44/entities/TrainingCompletion.jsonc";
  const weakened = createLiveReadinessSourceContract({
    readArtifact: (path) => {
      const source = readArtifact(path);
      if (path !== changedPath) return source;
      const schema = JSON5.parse(source);
      schema.rls.update = { "data.nurse_email": "{{user.email}}" };
      return JSON.stringify(schema);
    },
  });
  assert.equal(weakened.status, "invalid_source_authority_contract");
  assert.equal(weakened.checks.training_completion_direct_writes_locked, false);
  assert.ok(weakened.errors.some((error) => (
    error.path === "entities.TrainingCompletion.rls.update"
  )));
});

test("source contract rejects disabled password auth or missing Smart Note persistence wiring", () => {
  const authPath = "base44/auth/config.jsonc";
  const authDisabled = createLiveReadinessSourceContract({
    readArtifact: (path) => {
      const source = readArtifact(path);
      if (path !== authPath) return source;
      const config = JSON5.parse(source);
      config.enableUsernamePassword = false;
      return JSON.stringify(config);
    },
  });
  assert.equal(authDisabled.status, "invalid_source_authority_contract");
  assert.equal(authDisabled.checks.authentication_source_semantics, false);

  const smartNotePath = "src/components/smartNote/persistVisitNote.js";
  const smartNoteUnwired = createLiveReadinessSourceContract({
    readArtifact: (path) => {
      const source = readArtifact(path);
      return path === smartNotePath
        ? source.replaceAll(
          "functions.invoke('appendPatientNoteHistory'",
          "functions.invoke('retiredHistoryWriter'",
        )
        : source;
    },
  });
  assert.equal(smartNoteUnwired.status, "invalid_source_authority_contract");
  assert.equal(smartNoteUnwired.checks.smart_note_persistence_source_markers, false);
});

test("source contract pins the plan-only request assembler and its exact-shape tests", () => {
  const assemblerPath = "src/lib/liveReadinessFixtureManifest.js";
  const weakened = createLiveReadinessSourceContract({
    readArtifact: (path) => {
      const source = readArtifact(path);
      return path === assemblerPath
        ? source.replace("assembleLiveReadinessFixtureRequests", "retiredFixtureAssembler")
        : source;
    },
  });
  assert.equal(weakened.status, "invalid_source_authority_contract");
  assert.equal(weakened.checks.fixture_request_assembler_source_markers, false);
});

test("source contract rejects broker enum drift from canonical S3/S4 inputs", () => {
  for (const { changedPath, before, after } of [
    {
      changedPath: "base44/functions/manageAuthorizedReferral/entry.ts",
      before: "'low', 'normal', 'high', 'urgent'",
      after: "'low', 'high', 'urgent'",
    },
    {
      changedPath: "base44/functions/manageAuthorizedReferral/entry.ts",
      before: "'pdf', 'fax', 'image', 'manual', 'electronic'",
      after: "'pdf', 'fax', 'image', 'electronic'",
    },
    {
      changedPath: "base44/functions/createAuthorizedVisit/entry.ts",
      before: "  'skilled_nursing',\n",
      after: "",
    },
  ]) {
    const weakened = createLiveReadinessSourceContract({
      readArtifact: (path) => {
        const source = readArtifact(path);
        return path === changedPath ? source.replace(before, after) : source;
      },
    });
    assert.equal(weakened.status, "invalid_source_authority_contract");
    assert.ok(weakened.errors.some((error) => (
      error.path.startsWith(changedPath) && /broker enum/.test(error.message)
    )));
  }
});

test("source contract rejects removal of the dormant assignment mutation gate without echoing source", () => {
  const changedPath = "base44/functions/managePatientCareTeamAssignment/entry.ts";
  const weakened = createLiveReadinessSourceContract({
    readArtifact: (path) => {
      const source = readArtifact(path);
      return path === changedPath
        ? source.replace(
          "CARE_TEAM_ASSIGNMENT_MUTATIONS_ENABLED = false",
          "CARE_TEAM_ASSIGNMENT_MUTATIONS_ENABLED = true",
        )
        : source;
    },
  });

  assert.equal(weakened.status, "invalid_source_authority_contract");
  const formatted = formatLiveReadinessSourceContractErrors(weakened.errors);
  assert.match(formatted, /reviewed-broker source marker is absent/);
  assert.equal(formatted.includes("MUTATIONS_ENABLED = true"), false);
});

test("source contract rejects every installed SDK entity mutator in the staging preflight", () => {
  const changedPath = "base44/functions/preflightStagingReadinessFixture/entry.ts";
  for (const method of [
    "create",
    "update",
    "delete",
    "deleteMany",
    "bulkCreate",
    "updateMany",
    "bulkUpdate",
    "importEntities",
  ]) {
    const weakened = createLiveReadinessSourceContract({
      readArtifact: (path) => path === changedPath
        ? `${readArtifact(path)}\nentities.StagingReadinessFixture.${method}({});`
        : readArtifact(path),
    });

    assert.equal(weakened.status, "invalid_source_authority_contract", method);
    assert.equal(weakened.source_authority_contract_sha256, null, method);
    assert.equal(weakened.checks.staging_readiness_read_only_preflight_present, false, method);
    assert.ok(weakened.errors.some((error) => error.path === changedPath), method);
  }
});

test("source contract rejects non-entity Base44 side effects in the staging preflight", () => {
  const changedPath = "base44/functions/preflightStagingReadinessFixture/entry.ts";
  for (const injectedCall of [
    "base44.asServiceRole.agents.createConversation({});",
    "base44.appLogs.logUserInApp('preflight');",
    "base44.fetchWithAuth('/mutating-route', { method: 'POST' });",
    "base44.asServiceRole.connectors.disconnectAppUser('connector');",
  ]) {
    const weakened = createLiveReadinessSourceContract({
      readArtifact: (path) => path === changedPath
        ? `${readArtifact(path)}\n${injectedCall}`
        : readArtifact(path),
    });

    assert.equal(weakened.status, "invalid_source_authority_contract", injectedCall);
    assert.equal(weakened.source_authority_contract_sha256, null, injectedCall);
    assert.equal(
      weakened.checks.staging_readiness_read_only_preflight_present,
      false,
      injectedCall,
    );
    assert.ok(weakened.errors.some((error) => error.path === changedPath), injectedCall);
  }
});

test("source contract rejects indirect mutations through approved entity handles", () => {
  const changedPath = "base44/functions/preflightStagingReadinessFixture/entry.ts";
  for (const injectedCall of [
    "entities.Patient['create']({});",
    "const { deleteMany } = entities.Patient; deleteMany({});",
    "const mutate = entities.Patient.create; mutate({});",
    "const mutate = entities.Patient[\"deleteMany\"]; mutate({});",
    "handler['create']({});",
    "const { bulkUpdate } = handler; bulkUpdate([]);",
  ]) {
    const weakened = createLiveReadinessSourceContract({
      readArtifact: (path) => path === changedPath
        ? `${readArtifact(path)}\n${injectedCall}`
        : readArtifact(path),
    });

    assert.equal(weakened.status, "invalid_source_authority_contract", injectedCall);
    assert.equal(weakened.source_authority_contract_sha256, null, injectedCall);
    assert.equal(
      weakened.checks.staging_readiness_read_only_preflight_present,
      false,
      injectedCall,
    );
    assert.ok(weakened.errors.some((error) => error.path === changedPath), injectedCall);
  }
});

test("source contract rejects weakened staging fixture registry identity shapes", () => {
  const changedPath = "base44/entities/StagingReadinessFixture.jsonc";
  const weakened = createLiveReadinessSourceContract({
    readArtifact: (path) => {
      if (path !== changedPath) return readArtifact(path);
      const schema = JSON.parse(readArtifact(path));
      schema.properties.actor_user_ids = { type: "string" };
      schema.properties.assignment_ids.items.type = "number";
      schema.properties.version.type = "number";
      return JSON.stringify(schema);
    },
  });

  assert.equal(weakened.status, "invalid_source_authority_contract");
  assert.equal(weakened.source_authority_contract_sha256, null);
  assert.equal(weakened.checks.authority_schema_semantics, false);
  assert.ok(weakened.errors.some((error) => (
    error.path === "entities.StagingReadinessFixture.properties.actor_user_ids"
  )));
  assert.ok(weakened.errors.some((error) => (
    error.path === "entities.StagingReadinessFixture.properties.assignment_ids"
  )));
  assert.ok(weakened.errors.some((error) => (
    error.path === "entities.StagingReadinessFixture.properties.version"
  )));
});

test("source contract rejects reopened architecture authority entities", () => {
  for (const [changedPath, operation] of [
    ["base44/entities/ContentScopeBinding.jsonc", "read"],
    ["base44/entities/PhysicianAgencyProfile.jsonc", "update"],
  ]) {
    const weakened = createLiveReadinessSourceContract({
      readArtifact: (path) => {
        if (path !== changedPath) return readArtifact(path);
        const schema = JSON5.parse(readArtifact(path));
        schema.rls[operation] = true;
        return JSON.stringify(schema);
      },
    });
    assert.equal(weakened.status, "invalid_source_authority_contract", changedPath);
    assert.equal(weakened.checks.architecture_authority_entities_fail_closed, false);
    assert.ok(weakened.errors.some((error) => (
      error.path === `entities.${schemaName(changedPath)}.rls.${operation}`
    )));
  }
});

test("source contract rejects content-root and inheritance drift", () => {
  const bindingPath = "base44/entities/ContentScopeBinding.jsonc";
  const missingRoot = createLiveReadinessSourceContract({
    readArtifact: (path) => {
      if (path !== bindingPath) return readArtifact(path);
      const schema = JSON5.parse(readArtifact(path));
      schema.properties.entity_name.enum = schema.properties.entity_name.enum
        .filter((name) => name !== "TrainingCourse");
      return JSON.stringify(schema);
    },
  });
  assert.equal(missingRoot.status, "invalid_source_authority_contract");
  assert.equal(missingRoot.checks.content_scope_semantics_exact, false);
  assert.ok(missingRoot.errors.some((error) => (
    error.path === "entities.ContentScopeBinding.properties.entity_name.enum"
  )));

  const architecturePath = "src/lib/tenantArchitecture.js";
  const wrongParentField = createLiveReadinessSourceContract({
    readArtifact: (path) => path === architecturePath
      ? readArtifact(path).replace(
        "parentEntity: 'TrainingCourse', parentField: 'course_id'",
        "parentEntity: 'TrainingCourse', parentField: 'training_id'",
      )
      : readArtifact(path),
  });
  assert.equal(wrongParentField.status, "invalid_source_authority_contract");
  assert.equal(wrongParentField.checks.tenant_architecture_source_markers, false);
});

test("source contract rejects authority and provenance field-shape drift", () => {
  const cases = [
    {
      changedPath: "base44/entities/ContentScopeBinding.jsonc",
      mutate(schema) {
        schema.properties.resource_id.type = "number";
      },
      errorPath: "entities.ContentScopeBinding.properties.resource_id",
      check: "content_scope_semantics_exact",
    },
    {
      changedPath: "base44/entities/ContentScopeBinding.jsonc",
      mutate(schema) {
        delete schema.properties.created_by_user_email_normalized.format;
      },
      errorPath: "entities.ContentScopeBinding.properties.created_by_user_email_normalized",
      check: "content_scope_semantics_exact",
    },
    {
      changedPath: "base44/entities/PhysicianAgencyProfile.jsonc",
      mutate(schema) {
        schema.properties.last_transition_at.format = "date";
      },
      errorPath: "entities.PhysicianAgencyProfile.properties.last_transition_at",
      check: "authority_schema_semantics",
    },
    {
      changedPath: "base44/entities/PhysicianAgencyProfile.jsonc",
      mutate(schema) {
        schema.properties.referral_count.minimum = 1;
      },
      errorPath: "entities.PhysicianAgencyProfile.properties.referral_count",
      check: "authority_schema_semantics",
    },
    {
      changedPath: "base44/entities/ContentScopeBinding.jsonc",
      mutate(schema) {
        schema.properties.scope_override = { type: "string" };
      },
      errorPath: "entities.ContentScopeBinding.properties",
      check: "content_scope_semantics_exact",
    },
    {
      changedPath: "base44/entities/ContentScopeBinding.jsonc",
      mutate(schema) {
        schema.properties.resource_id.rls = { read: true, write: true };
      },
      errorPath: "entities.ContentScopeBinding.properties.resource_id",
      check: "content_scope_semantics_exact",
    },
    {
      changedPath: "base44/entities/ContentScopeBinding.jsonc",
      mutate(schema) {
        schema.additionalProperties = true;
      },
      errorPath: "entities.ContentScopeBinding.additionalProperties",
      check: "content_scope_semantics_exact",
    },
    {
      changedPath: "base44/entities/PhysicianAgencyProfile.jsonc",
      mutate(schema) {
        schema.properties.external_tenant_note = { type: "string" };
      },
      errorPath: "entities.PhysicianAgencyProfile.properties",
      check: "authority_schema_semantics",
    },
    {
      changedPath: "base44/entities/PhysicianAgencyProfile.jsonc",
      mutate(schema) {
        schema.properties.notes.rls = { read: true, write: true };
      },
      errorPath: "entities.PhysicianAgencyProfile.properties.notes",
      check: "authority_schema_semantics",
    },
  ];

  for (const { changedPath, mutate, errorPath, check } of cases) {
    const weakened = createLiveReadinessSourceContract({
      readArtifact: (path) => {
        if (path !== changedPath) return readArtifact(path);
        const schema = JSON5.parse(readArtifact(path));
        mutate(schema);
        return JSON.stringify(schema);
      },
    });
    assert.equal(weakened.status, "invalid_source_authority_contract", errorPath);
    assert.equal(weakened.checks[check], false, errorPath);
    assert.ok(weakened.errors.some((error) => error.path === errorPath), errorPath);
  }
});

test("source contract rejects reopened or partially specified training answer fields", () => {
  const cases = [
    {
      changedPath: "base44/entities/TrainingModule.jsonc",
      mutate(schema) {
        schema.properties.content.properties.quiz_questions.items
          .properties.correct_answer.rls.read = true;
      },
      errorPath: "entities.TrainingModule.properties.content.quiz_questions[].correct_answer.rls",
    },
    ...["pre_assessment_json", "brain_sparks_json"].map((field) => ({
      changedPath: "base44/entities/TrainingCourse.jsonc",
      mutate(schema) {
        delete schema.properties[field].rls.write;
      },
      errorPath: `entities.TrainingCourse.properties.${field}.rls`,
    })),
  ];
  for (const { changedPath, mutate, errorPath } of cases) {
    const weakened = createLiveReadinessSourceContract({
      readArtifact: (path) => {
        if (path !== changedPath) return readArtifact(path);
        const schema = JSON5.parse(readArtifact(path));
        mutate(schema);
        return JSON.stringify(schema);
      },
    });
    assert.equal(weakened.status, "invalid_source_authority_contract", errorPath);
    assert.equal(weakened.checks.training_answer_fields_denied, false);
    assert.ok(weakened.errors.some((error) => error.path === errorPath));
  }
});

test("source contract rejects canonical topology source-marker drift", () => {
  const changedPath = "src/lib/liveReadinessFixtureManifest.js";
  const weakened = createLiveReadinessSourceContract({
    readArtifact: (path) => path === changedPath
      ? readArtifact(path).replace(
        "assignment_edges: Object.freeze(LIVE_READINESS_FIXTURE_ASSIGNMENTS.map",
        "assignment_edges: Object.freeze([",
      )
      : readArtifact(path),
  });
  assert.equal(weakened.status, "invalid_source_authority_contract");
  assert.equal(weakened.checks.tenant_architecture_source_markers, false);

  const architecturePath = "src/lib/tenantArchitecture.js";
  const weakenedProjection = createLiveReadinessSourceContract({
    readArtifact: (path) => path === architecturePath
      ? readArtifact(path).replace(
        "tenantRole: actor.tenant_role,",
        "tenantRole: 'agency_admin',",
      )
      : readArtifact(path),
  });
  assert.equal(weakenedProjection.status, "invalid_source_authority_contract");
  assert.equal(weakenedProjection.checks.tenant_architecture_source_markers, false);
  assert.ok(weakenedProjection.errors.some((error) => error.path === architecturePath));

  const retainedMarkersButChangedSemantics = createLiveReadinessSourceContract({
    readArtifact: (path) => path === architecturePath
      ? readArtifact(path).replace(
        "tenantRole: actor.tenant_role,",
        "tenantRole: actor.tenant_role,\n      ...{ tenantRole: 'agency_admin' },",
      )
      : readArtifact(path),
  });
  assert.equal(retainedMarkersButChangedSemantics.checks.tenant_architecture_source_markers, true);
  assert.equal(retainedMarkersButChangedSemantics.status, "invalid_source_authority_contract");
  assert.equal(retainedMarkersButChangedSemantics.checks.runtime_import_artifact_parity, false);
  assert.equal(retainedMarkersButChangedSemantics.checks.readiness_topology_parity, false);
  assert.ok(retainedMarkersButChangedSemantics.errors.some((error) => (
    error.path === `runtime_import_artifact_parity.${architecturePath}`
  )));
});

test("source contract handles unreadable or malformed pinned artifacts without leaking contents", () => {
  const unreadable = createLiveReadinessSourceContract({
    readArtifact: (path) => {
      if (path.endsWith("Agency.jsonc")) throw new Error("private path detail");
      return readArtifact(path);
    },
  });
  assert.equal(unreadable.status, "invalid_source_authority_contract");
  assert.equal(
    formatLiveReadinessSourceContractErrors(unreadable.errors).includes("private path detail"),
    false,
  );

  const malformed = createLiveReadinessSourceContract({
    readArtifact: (path) => path.endsWith("live-readiness-fixture-manifest.template.json")
      ? "{\"password\":\"never-print\",}"
      : readArtifact(path),
  });
  assert.equal(malformed.status, "invalid_source_authority_contract");
  assert.equal(
    formatLiveReadinessSourceContractErrors(malformed.errors).includes("never-print"),
    false,
  );

  for (const changedPath of [
    "src/lib/liveReadinessFixtureManifest.js",
    "src/lib/tenantArchitecture.js",
  ]) {
    const missingSemanticSource = createLiveReadinessSourceContract({
      readArtifact: (path) => {
        if (path === changedPath) throw new Error("private semantic path detail");
        return readArtifact(path);
      },
    });
    assert.equal(missingSemanticSource.status, "invalid_source_authority_contract");
    assert.equal(missingSemanticSource.checks.runtime_import_artifact_parity, false);
    assert.equal(missingSemanticSource.checks.readiness_topology_parity, false);
    assert.ok(missingSemanticSource.errors.some((error) => (
      error.path === `runtime_import_artifact_parity.${changedPath}`
    )));
    assert.equal(
      formatLiveReadinessSourceContractErrors(missingSemanticSource.errors)
        .includes("private semantic path detail"),
      false,
    );
  }
});
