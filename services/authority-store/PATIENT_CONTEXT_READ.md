# Explicit synthetic patient context

This additive, read-only slice supplies the unchanged `getAuthorizedPatient` wrapper for exactly `display` and `smart_note_context`. It uses independent native authority and explicitly stored fictional fields. It does not split a roster display name, infer clinical facts, migrate customer records, enable clinical navigation/save/provider actions, or publish a hosted frontend. Existing names-only roster/detail and S4/Visit contracts are unchanged. A separately reviewed migration and real hosted acceptance are required before hosted use.

## Private storage and provenance

`pennsync_private.patient_context` stores `app_id`, `agency_id`, `patient_id`, positive `version`, fixed `provenance_kind='synthetic_fixture'`, explicit `provenance_sha256`, `data`, `data_sha256`, and `created_at`. It has a validated, nondeferrable **NO ACTION** composite FK to the exact existing patient/app/agency. Its version is explicit fixture provenance, not a public update counter. UPDATE/DELETE are refused; later chart editing requires a separately reviewed version/mutation design. There is no frontend or operator provisioning endpoint in this slice.

The content digest covers PostgreSQL's canonical JSONB text, **not original source bytes**. Exact supported string values and present/absent fields are retained; JSON whitespace, object key ordering and numerical spelling are not source-byte provenance. The separate provenance hash is explicit synthetic evidence and does not certify an external source or invent verified clinical data. No customer source is acquired by these fixtures.

`patient_disclosure_audit` is append-only. It records only opaque actor/patient/agency/membership identifiers, current membership and context versions, context digest, finite purpose, access basis, stable assignment UUID/version where applicable, and time. It contains no patient content, user email, password, token or native session credential. Neither new table has browser/service CRUD, an allowing RLS policy, or public schema exposure; both force RLS. Validation/immutability helpers have no execution grants to application roles. Only the private authorized entry and public invoker wrapper are executable by `authenticated`.

## Exact RPC and projections

`public.pennsync_staging_patient_context(p_app_id text,p_agency_id text,p_patient_id text,p_purpose text)` returns the existing authority envelope (`contract`, `app_id`, `auth_user_id`, `staging`, `synthetic`) plus exact current `context`, `purpose`, `patient`, and `scope`. Scope has exactly `agency_id`, `membership_id`, `membership_version`, and `tenant_role`. The adapter removes the internal envelope only after strict client validation and produces `{success:true,purpose,patient,scope}` for the unchanged wrapper.

| Purpose | Required fields | Permitted optional fields |
| --- | --- | --- |
| `display` | `id`, `first_name`, `last_name` | `middle_name` |
| `smart_note_context` | `id`, `first_name`, `last_name`, `status`, `updated_date` | `middle_name`, `date_of_birth`, `medical_record_number`, `care_type`, `primary_diagnosis`, `secondary_diagnoses`, `chronic_conditions`, `past_medical_history`, `current_medications`, `allergies`, `functional_status`, `wounds`, `enhanced_notes_history`, `clinical_notes` |

All absent optional fields stay absent. In particular, an absent history is never returned as an invented empty array. Display-only stored data is valid, but a smart-context read without its explicit required status/time is denied. Parent `patient.status='active'` is current authority eligibility; **context.status** is an independently stored clinical field and may be `active`, `hospitalized`, or `discharged`. No default or mapping joins those meanings.

Required names preserve the existing wrapper's nonempty, at-most-200 JavaScript UTF-16 code-unit and exact ECMAScript-trim rules, including astral text and all 25 trim whitespace characters. Optional strings have no additional per-field length restriction. Dates are valid exact `YYYY-MM-DD` values with nonzero year. This finite synthetic subset requires `updated_date` to already be canonical UTC ISO milliseconds (`YYYY-MM-DDTHH:mm:ss.sssZ`); it rejects other formats instead of silently converting them. Future customer import must validate actual source forms before expanding this subset.

String-array fields preserve strings; `chronic_conditions`, `current_medications`, and `wounds` allow at most 500 objects; `enhanced_notes_history` allows at most 5,000 objects; `functional_status` is an object. Nested object content is preserved within the complete bound. Null optional values and unknown top-level fields are refused. Stored canonical context is limited to 900,000 UTF-8 bytes. The complete RPC response and client transport remain limited to 1 MiB; this method does not inherit the Visit method's larger allowance.

## Current authority and disclosure transaction

The fixed staging app is `6a9881683dc68a0bd54f1ef7`. Only current `agency_admin` and currently assigned `clinician` roles are supported. Native confirmed user, live exact session, enabled immutable identity mapping, active agency/membership, active synthetic patient and (for clinicians) active exact assignment are locked before context lookup. The existing shared application lock and READ COMMITTED rules apply. Unknown/foreign patients, other roles/purposes and missing/malformed contexts deny without a projection or audit.

A successful projection must append its disclosure audit in the same transaction before returning. Audit insertion failure returns only fixed `PT503/PENNSYNC_PATIENT_AUDIT_UNAVAILABLE`; there is no unaudited fallback or retry. Native tests observe both lock orderings against membership revocation, native logout, patient deactivation and assignment revocation. Read-only transactions cannot disclose because they cannot commit an audit. Client session invalidation also withholds delayed responses; this local fence is not a substitute for native-session revocation.

The archive importer still supports only its names-only synthetic projection. Its exact dependency census now includes `patient_context`, takes the corresponding table lock, and requires its exact validated nondeferrable NO ACTION/RESTRICT FK. A present clinical context blocks rollback without deleting context or changing the import receipt. Missing/cascading FK drift refuses the operation; bare unchanged imported patients remain reversibly removable. No importer scope is broadened to clinical fields.

## Executable evidence

`patient-context-postgres.test.mjs` runs 16 native local cases: exact purpose projections, absent fields, Unicode/shape/time/size limits, immutable provenance, privilege/RLS defenses, corruption, mandatory audit, and eight observed revocation orderings. `tools-pennsync-archive-import.postgres.test.mjs` additionally verifies context-dependent rollback refusal and unchanged bare-patient rollback. Strict client tests cover exact scope/field binding, oversized response cancellation, unsupported input without HTTP and late-session denial. `independentStagingPatient.spec.js` exercises the unchanged wrapper through the actual adapter/client with modeled transport.

The existing owned local Auth/PostgREST suite adds actual signed-session reads and denials using only its four established fictional actors. It must run in Docker-backed CI; local native Auth doubles and modeled client responses do not establish real gateway authentication. The existing encrypted restore rehearsal preserves two explicitly versioned contexts and six committed disclosures, then verifies exact metadata/digests, restored projections, read-audit behavior and scope/revocation/immutability/audit-failure denials. Those synthetic artifacts do not demonstrate a customer-data backup or a full clinical workflow.
