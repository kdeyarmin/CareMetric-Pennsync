# Live-Readiness Evidence Packet — How to Fill (LR-01 / LR-02)

_Companion to `docs/audits/live-readiness-fixture-manifest.template.json`,
`docs/audits/live-readiness-evidence.draft.json`, and
`docs/audits/LIVE_READINESS_CHECKLIST_LR01_LR02.md`._

## Goal

Turn the gated live-readiness matrix into real hosted evidence so
`pnpm run readiness:report` can exit 0.

## Steps

1. **Validate the committed, non-PHI fixture plan locally:**

   ```bash
   pnpm run readiness:fixture:validate -- docs/audits/live-readiness-fixture-manifest.template.json
   ```

   Exit code `0` means the manifest has the reviewed LR-01 two-agency topology
   and shared LR-02 actors/patients, points at the exact isolated staging app,
   contains no credential or PHI-shaped fields, and requests no network access
   or hosted writes. It also means the pinned static source contract found the
   expected authority-schema semantics, reviewed-broker markers, local contract
   test sources, and hard-disabled care-team assignment mutation gate. Record
   the emitted `source_contract.source_authority_contract_sha256` from the exact
   candidate checkout.

   The command still reports hosted readiness as blocked. It does **not** run
   those local contract tests, encode the S3 Referral or S4 Visit action/result,
   create identities or rows, prove deployed parity, authenticate a user, prove
   hosted platform behavior, or clear LR-01/LR-02. Run `pnpm run test:contracts`
   and `pnpm run test:security` separately for executable source-only coverage;
   their mocks are not hosted evidence.

2. **Provision the plan through reviewed paths when the hosted prerequisites
   are available:**
   - Create/invite as needed, then resolve the five actor identities from the
     environment-variable names in the manifest. Keep actual emails and every
     password/token outside committed files and command output.
   - Create the two active agencies, then use `manageAgencyMembership` for the
     four tenant memberships. Tenant users retain built-in `User.role=user`.
   - Have Admin-A create A1/A2 and Admin-B create B1 through
     `createAuthorizedPatient`. This prevents creator access from making the
     Clinician-A assignment test pass accidentally.
   - Add only the A1 → Clinician-A active assignment through the reviewed
     assignment broker. At the 2026-09-04 staging checkpoint,
     `managePatientCareTeamAssignment` is deliberately withheld pending its
     atomicity prerequisites, so canonical fixture provisioning remains
     incomplete. Do not bypass that blocker with direct entity CRUD.
   - The local source contract also reports that S3 has no reviewed
     immutable-tenant Referral broker and that S4 Visit creation still relies
     on legacy Patient assignment fields. Do not run or mark S3/S4 passing until
     reviewed paths use canonical tenant/care-team authority.
   - Create Referral and Visit records through the eventual reviewed S3/S4
     paths rather than pre-seeding them; the workflow result is the evidence
     LR-02 needs.

   `src/test/entityFixtures.js` is a UI loaded-state helper, not a hosted seed
   source. It does not encode the immutable two-agency authority topology and
   must not be sent to Base44.

3. **Copy the evidence draft** (do not edit the committed draft with
   secrets/PHI):

   ```bash
   mkdir -p tmp
   cp docs/audits/live-readiness-evidence.draft.json tmp/live-readiness-evidence.json
   ```

4. **Replace every `FILL_ME`** in `tmp/live-readiness-evidence.json` with real values:
   - Keep the committed `fixture_set_id`, staging Base44 app id, and staging
     frontend origin exact. Set `staging_backend_origin` to the canonical HTTPS
     origin from the same `VITE_BASE44_BACKEND_URL` used for the raw probes; the
     CLI requires that configured value and rejects another Base44 tenant host
   - Set `candidate_source_commit_sha` and `candidate_source_tree_sha` to the
     clean checked-out Git revision; the CLI verifies both. Set
     `source_authority_contract_sha256` to the value emitted by the fixture
     validator for that checkout; the report recomputes and verifies it. Record the distinct
     `hosted_runtime_commit_sha`, `hosted_runtime_tree_sha`, and the identifier
     from a complete immutable deployment receipt. A functions version can be
     retained as partial corroboration, but it does not identify the site,
     schemas, and automations and cannot satisfy that receipt requirement alone.
   - Obtain externally reviewed candidate and hosted resource-inventory
     attestations. They must declare the same scope, including frontend/site
     bytes, every entity schema and RLS rule, functions, automations/schedules,
     auth and connector configuration, secret configuration identifiers (never
     secret values), and every intentional exclusion. Record their SHA-256
     values; the two digests must match. This
     repository has no canonical manifest generator or hosted-state retrieval
     command. Hosted and candidate Git identities may differ only when the
     reviewed inventory scope explicitly accounts for the non-runtime delta
   - Canonical fixture emails (not passwords): protected Platform-Owner; Admin-A/Admin-B; Clinician-A/Clinician-A-empty
   - Fictional patient ids A1/A2/B1 and the reviewed active assignment of A1 to Clinician-A
   - A retained run-index reference plus a complete attestation in every
     required `test_evidence.probes` entry: V1–V6/T1–T4 for LR-01 and S1–S4 for
     LR-02. Every probe needs `execution_context: authenticated_hosted`, a
     `pass|fail|blocked` result, a canonical UTC millisecond `captured_at`, the
     lowercase SHA-256 of its retained probe bundle, and at least one actual
     artifact reference. Include S5–S9 only when those optional/in-scope flows
     were exercised; a supplied non-passing or incomplete optional probe blocks
     the packet
   - Named owners and reviewer approvals

   Every populated `references` array must contain references to actual
   supporting artifacts. References must be trimmed, bounded, and unique within
   each entry. The top-level `test_evidence.references` array is the run index;
   it does not replace the required per-probe artifact maps or artifact digests.
   The digest binds retained bytes but does not authenticate their truth; human
   reviewers must inspect them. Test labels or expected-result prose are not
   evidence. The CLI rejects known template placeholders rather than treating
   them as completed fields.

5. **Run and pass LR-01 first** (isolation before deep workflow smoke):
   - Apply RLS matrix from `docs/SECURITY-RLS-CHECKLIST.md`
   - Run V1–V6 and T1–T4 against **raw reviewed-broker responses**
   - Record evidence refs (screenshots outside the repo if they contain PHI)

   Do not start LR-02 until all V1–V6 and T1–T4 probes pass and no isolation
   failure remains unresolved.

6. **Run LR-02** smoke flows S1–S4 minimum. S5–S9 remain optional or
   conditional as labeled; cite only flows actually exercised and identify
   unexercised optional flows in the summary.

7. **Set reviewers** to `"approved"` only after human review.

8. **Generate the report**:

   ```bash
   export READINESS_STAGING_BACKEND_ORIGIN="https://<exact-staging-backend-host>" # origin only; no path/query/trailing slash
   export READINESS_HOSTED_RUNTIME_COMMIT_SHA="<trusted-deployment-output>"
   export READINESS_HOSTED_RUNTIME_TREE_SHA="<trusted-deployment-output>"
   export READINESS_HOSTED_DEPLOYMENT_ID="<complete-immutable-deployment-receipt-id>"
   export READINESS_CANDIDATE_DEPLOYABLE_MANIFEST_SHA256="<externally-reviewed-candidate-inventory-sha256>"
   export READINESS_HOSTED_RESOURCE_MANIFEST_SHA256="<externally-reviewed-hosted-inventory-sha256>"
   pnpm run readiness:report -- tmp/live-readiness-evidence.json
   ```

   Run this from the exact candidate checkout with its staging
   backend and independently captured deployment outputs configured as above.
   Exit code `0` = the LR-01/LR-02 packet is structurally complete, all required
   hosted probes are explicitly authenticated and passing, its candidate
   commit/tree and source-authority-contract digest match the clean checkout,
   its hosted identities and
   resource-inventory attestation match the protected execution context, its
   candidate/hosted resource-inventory attestations agree, the probe backend
   matches, and every reviewer decision is
   approved; `1` = blocked; `2` = invalid input. The CLI also refuses a dirty
   checkout. These protected variables are externally reviewed attestations;
   the CLI does not verify receipt completeness, generate either resource
   inventory, or retrieve hosted state. The
   report includes the exact input-byte SHA-256, evaluated capability ids,
   source/deployment/target identity, and evidence-reference counts. Retain the
   private packet by that digest. Its `assurance` object explicitly keeps
   `cited_artifact_bytes_fetched_or_verified` and
   `reviewer_identities_cryptographically_verified` false: the report does not
   contain, retrieve, authenticate, or generate the cited hosted evidence.

## Rules

- Never commit real evidence JSON with credentials, tokens, or PHI.
- Keep real fixture emails and credentials in the execution environment, not
  the fixture manifest or evidence template.
- Never put production PHI in staging seeds.
- Exclude the protected platform owner from tenant-isolation assertions.
- Every tenant actor must have built-in `User.role=user` plus one valid, active, server-owned `AgencyMembership`; mutable User claims are never authority.
- Only raw responses from reviewed authenticated brokers count as positive tenant evidence; a tenant actor receiving PHI or authority rows from direct entity reads is a failure.
- Platform-level `is_active` rejection of deactivated sessions is part of LR-01
  verification (repo Layout already blocks the browser shell).
- Use Base44 platform logs for release monitoring until the hosted
  `SecurityLog` append/read boundary and its tenant exposure are independently
  proved; do not treat an unproved `SecurityLog` query as monitoring evidence.
