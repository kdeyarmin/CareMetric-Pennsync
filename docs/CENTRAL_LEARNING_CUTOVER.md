# Move learning to the Support Hub

Course creation and delivery belong in `kdeyarmin/caremetric-support-hub` for all
CareMetric apps. The new Hub runtime requires no HeyGen key. PennSync's currently
deployed local video jobs still use its legacy key until cutover is complete.
Do not provision or rotate HeyGen simply to satisfy the old integration checklist.

This branch prepares SDK 0.4.0 links, UI launchers, backend retirement
guards, and health-check behavior. Both release controls remain unset. It does
not migrate records, deploy functions, or revoke any key.

Before enabling `VITE_CENTRAL_LEARNING_ENABLED=true` in the verified production
build and `CENTRAL_LEARNING_RELEASE=hub-runtime-v1` in Base44:

1. Deploy and exercise the Hub runtime from Support Hub PR #4. Confirm real
   authoring, product access, playback/captions, server grading, progress, and
   completion records with authorized accounts.
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
