# Move learning to the Support Hub

Course creation and delivery belong in `kdeyarmin/caremetric-support-hub` for all
CareMetric apps. The new Hub runtime requires no HeyGen key. PennSync's currently
deployed local video jobs still use its legacy key until cutover is complete.
Do not provision or rotate HeyGen simply to satisfy the old integration checklist.

This release prepares SDK 0.4.0 links, UI launchers, backend retirement
guards, and health-check behavior. Both learning cutover controls remain unset.
Record migration and final cutover must preserve the existing tenant and learner
evidence described below; merging this preparation does not activate them.

Before enabling `VITE_CENTRAL_LEARNING_ENABLED=true` in the verified production
build and `CENTRAL_LEARNING_RELEASE=hub-runtime-v1` in Base44:

1. Verify the current deployed Hub runtime, which uses app-owned Telnyx SMS
   and opaque server sessions. No authenticator enrollment or Supabase
   verification is required. The real owner session, six-app scopes, course
   creation forms and existing CareBase material have been checked. Hub32
   (`9e6be060de61a56a328778adc2c2bd5b25620e15`) also deploys central DocStudio
   with a healthy real renderer. Its private lifecycle and recovery checks pass
   in disposable CI. Confirm the intended migrated learner cohort's playback,
   captions, server grading, progress and completion records before cutover. Imported CareBase drafts remain blocked from publication
   until quiz, credit/renewal, and completion-reporting behavior is preserved.
2. Inventory PennSync TrainingCourse/Module/Question data separately from the
   CareBase catalog. Preserve agency visibility and immutable source revisions.
   Its tenant-specific content must not be imported as public shared content.
3. Map existing learners, agencies, assignments, progress, attestations, credits,
   and certificates to verified Hub identities. Preserve original evidence and
   provide historical access before changing the learning entry point.
4. Reconcile in-flight HeyGen jobs and retain completed videos independently of
   temporary vendor URLs. Move approved MP4s, captions, and transcripts into the Hub.
5. Retire direct client writes to TrainingCourse, TrainingModule, and
   TrainingQuestion in the deployed Base44 entity policies; UI flags alone cannot
   stop older clients from calling entity endpoints. Retain historical read
   access. The backend release guard now covers generateTrainingCourse,
   generateCourseQuiz, manageTrainingVideos, duplicateInService,
   rebuildExistingInServices, seedYearlyRequiredInServices,
   seedAnnualMandatoryEducationSamples, triggerCorrectiveActionPlan, and
   syncTrainingVideoStatuses. The last two return an authenticated skipped result
   before touching course data. Deploy these guards and reconcile the associated
   schedules and entity triggers before activating the backend switch. The
   frontend switch also replaces in-service, annual-mandatory, and SME publishing
   screens. Assignment/annual-plan automation and legacy player writes still need
   coordinated retirement after learner history and remediation are supported
   centrally; this switch is not a complete prohibition on all education writes.
6. Activate the coordinated cutover. Existing TrainingCoursePlayer bookmarks and
   report data are retained; do not delete their entities as a UI rollback.
7. Verify that no deployed job or consumer reads HEYGEN_API_KEY, remove it from
   PennSync, and rerun integration checks. After release, health checks omit the
   HeyGen probe and report the central learning configuration without claiming
   that Hub delivery was exercised by a PennSync provider probe.

Other provider credentials are independent of this migration. This code change
does not verify or replace them and is not a completed secret audit.

## What the owner answered, 2026-10-02 — and what it does not settle

Asked whether anyone on staff had finished a training course in the live app,
the owner answered **"Nobody"**. Read it narrowly: it is about **finished
courses**, in his words, and nothing else.

**What it settles.** Step 3's evidence to preserve is empty. There are no
completions, attestations, certificates or credits to map to Hub identities,
so there is nothing for "preserve the original evidence and provide historical
access before changing the learning entry point" to protect. The same holds for
step 6's "existing TrainingCoursePlayer bookmarks and report data", to the
extent those are completion records.

**What it does not settle, and do not read it as settling.**

- **Started-but-unfinished records are outside his answer.** Assignments,
  in-progress attempts and `ComplianceTrainingProgress` rows can exist with no
  finished course behind them. If step 3 is to be closed rather than shrunk,
  that is a second count, not an inference from this one.
- **Authored content is a different question from completed training.** An
  agency can write a course nobody takes. Step 2 is unchanged by this answer,
  and it is the step that now decides the size of the move.
- **Step 4 does not collapse either.** A HeyGen video belongs to a course being
  built, not to a course being finished, so "nobody finished one" says nothing
  about how many videos exist or how many jobs are in flight.

**The instrument for step 2, named rather than built.** The two seeders key on
`(title, annual_cycle_year)` and carry their content as literal source, so the
standard catalog is reproducible from this repository. An agency-authored course
is therefore any `TrainingCourse` row whose `(title, annual_cycle_year)` is
outside the seeded set — `TrainingCourse` carries no provenance field, so this
is the discriminator available. Counting it needs a read of the production
Base44 app. **No credential in this repository or its CI reaches that app**, and
`tools-pennsync-acquire.mjs` is pinned to the staging app at its `APP` constant,
so the count is an export the owner makes, not a tool anyone here can run.

**Who could have authored one, measured rather than assumed.** The owner's
second answer, 2026-10-02, was "Only the super admin can create their own
course" — which says who *could* have made one, not whether any exist, so it is
not a count either. Against the code it holds, and the gate is the built-in
platform role rather than the owner specifically: `TrainingCourse`'s entity
policy makes `create`, `update` and `delete` all `user_condition.role: admin`,
and `isSuperAdmin` is that same role **plus** the configured owner email, so the
enforced gate is at least as wide as his sentence and no wider than `role ===
"admin"`. The screens agree with one exception worth knowing about, because it
is D69's shape: `AIComplianceInServices.jsx` gates on `role === 'admin'` and
says in its own comment that it does so to match the entity policy, while
`AdminTraining.jsx` also admits `account_type === "agency_admin"` and
`account_type === "super_admin"` — self-editable labels that the entity policy
does not honour, so such a caller reaches the authoring screen and the create
fails underneath it. **So the authored-course population is bounded by whoever
holds the built-in `admin` role** — a bound on who, which is not a count of
what.

**The owner then answered that there are some, 2026-10-02.** Asked directly
whether he had built any courses himself, he said "There are ones there". So
agency-authored courses exist. An earlier draft of this section ended by sizing
step 2 at zero as a default taken on the bound above; that default is
falsified and is withdrawn. Step 2 is real work, and carrying authored content
across is built work rather than a contingency held against the possibility.

What his answer does **not** supply is a count, a list, or any property of the
rows. The instrument is unchanged: the `(title, annual_cycle_year)`
discriminator against the seeded set, run over an export of the production
Base44 app that the owner makes, because no credential here reaches it. Size
step 2 from that export when it exists, and until then treat the population as
non-empty and unmeasured — not as a number.

## The destination already defines the import shape, read 2026-10-02

This section is a reading of **another repository**, `kdeyarmin/caremetric-support-hub`,
at head `9f4fdf25` (committed 2026-09-25), attached read-only to answer one
question: what shape does the carry in step 2 have to produce? The answer is
that it is not ours to invent, and most of it is already built over there.

**The contract exists and is named.** The Hub carries
`docs/PENNSYNC_LEARNING_MIGRATION.md` and `docs/PENNSYNC_LEARNING_CONTRACT.md`,
a source envelope `pennsync.learning-source.v1`, a decoder
(`src/imports/pennsyncLearningSource.ts`), a course importer
(`src/imports/pennsyncCourseImport.ts`), a reviewed field inventory
(`src/imports/pennsyncSourceFields.json`) and a server-side reader
(`server/pennsync-learning-migration.mjs`). The field inventory names ten
learning entities plus three identity ones: TrainingCourse, TrainingModule,
TrainingQuestion, TrainingCompletion, TrainingAssignment, TrainingAttempt,
TrainingAttestation, TrainingCertificate, LearningPlan, LearningPlanCourse,
User, Agency, AgencyMembership. Those are the PennSync entities this repository
dispositions `hub`, which is D8 holding from the far side.

**The export is not a screen the owner clicks.** The migration doc pins the
source to Base44 app `694ec16e72e01b60d22f7cbf` — the id this repository holds
as `ARCHIVE_SOURCE_APPS.production` — and reads it through the Hub's own native
reader under its own authority, not through anything here. So the sentence
above about an export the owner makes describes a route this repository can
see; the route the destination actually implements is the Hub's migration
panel. Confirm which one is live before asking him for anything.

**A cohort has already been preserved and counted, over there.** The contract
doc's "Current source findings" reports 19 courses, 23 modules (six
standalone), 55 questions, six plans, 48 plan-course links and 20 legacy
history records, with sixteen published courses carrying lessons, two published
shells and one draft carrying none. **Do not quote that as the count of what is
in the live app today.** It is a dated finding in another repository about a
cohort preserved at some earlier moment, it is not re-derivable from this tree,
and nothing here can check it. It is recorded because it is the first evidence
that the authored population is non-empty that does not depend on asking the
owner — consistent with his answer, and not a substitute for measuring.

**Two things in it bear on steps 3 and 4 and are flagged, not settled here.**
Those findings mention 20 legacy history records and one legacy learner with no
registered-user match, which sits beside the owner's "Nobody" on finished
training; the two may well be about different populations, and this document
does not adjudicate that. And the contract's grading-provider section routes
freeform grading back through a PennSync function, so step 7's removal of
`HEYGEN_API_KEY` is not the only credential question left in this domain.

**What this changes about step 2.** It stops being "seed the catalog and invent
a carry". The carry's shape is `pennsync.learning-source.v1`, the conversion
target is `caremetric.learning-document.v2`, and the Hub's own contract says in
its first line that a preserved source is not a published course. So the work
on this side is to satisfy that contract's inputs, not to design a format.
