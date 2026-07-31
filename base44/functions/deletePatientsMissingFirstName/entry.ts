import { createClientFromRequest } from 'npm:@base44/sdk@0.8.31';

// <<<BEGIN SHARED HELPER: requireActiveUser — generated, edit base44/_shared/backendHelpers.mjs>>>
const isDeactivatedUser = (u) => !!u && u.is_active === false;
const DEACTIVATED_USER_RESPONSE = () => Response.json(
  { error: 'Unauthorized - account is deactivated' },
  { status: 403 },
);
// <<<END SHARED HELPER: requireActiveUser>>>


Deno.serve(async (req) => {
  try {
    const base44 = createClientFromRequest(req);
    const user = await base44.auth.me();
    if (isDeactivatedUser(user)) return DEACTIVATED_USER_RESPONSE();

    if (user?.role !== 'admin') {
      return Response.json({ error: 'Forbidden: Admin access required' }, { status: 403 });
    }

    // Require an explicit confirm so a single accidental call can't irreversibly
    // wipe charts. Default is a DRY RUN that previews what would be archived.
    const body = await req.json().catch(() => ({}));
    const confirm = body?.confirm === true;

    // Fetch patients (bounded to the SDK's 5000/request max; omitting a limit
    // silently caps at the SDK default of 50). Re-run if more remain.
    const allPatients = await base44.asServiceRole.entities.Patient.list('-created_date', 5000);

    // Filter patients without first_name. Skip already-archived records —
    // re-archiving flipped e.g. a 'discharged' status to 'merged'.
    const candidates = allPatients.filter(p => (!p.first_name || p.first_name.trim() === '') && !p.is_archived);

    // Surface candidates that still carry identifying data — archiving one of
    // these is far more consequential than removing an empty stub, so the admin
    // should see them in the preview before confirming.
    const preview = candidates.map(p => ({
      id: p.id,
      last_name: p.last_name || null,
      mrn: p.medical_record_number || null,
      has_other_identifying_data: Boolean(
        (p.last_name && p.last_name.trim()) ||
        (p.medical_record_number && String(p.medical_record_number).trim()) ||
        p.date_of_birth
      ),
    }));

    if (candidates.length === 0) {
      return Response.json({
        success: true,
        message: 'No patients found without first name',
        archivedCount: 0,
      });
    }

    if (!confirm) {
      return Response.json({
        success: true,
        dryRun: true,
        message: `Dry run: ${candidates.length} patient(s) without a first name would be archived. Re-send with { confirm: true } to apply.`,
        wouldArchiveCount: candidates.length,
        candidates: preview,
      });
    }

    // Soft-archive (recoverable) rather than hard-delete + cascade. Mirrors
    // deduplicatePatients, which deliberately switched away from Patient.delete()
    // so a mistaken cleanup can be undone by clearing is_archived/status.
    let archivedCount = 0;
    const failed = [];
    const skippedFlagged = [];

    for (const patient of candidates) {
      // A candidate that still carries identifying data (last name, MRN, DOB)
      // may be a REAL patient hit by an import bug — never archive those in
      // the blanket confirm; they need individual review. Only bare stubs go.
      const flagged = Boolean(
        (patient.last_name && patient.last_name.trim()) ||
        (patient.medical_record_number && String(patient.medical_record_number).trim()) ||
        patient.date_of_birth
      );
      if (flagged && body?.include_flagged !== true) {
        skippedFlagged.push({ id: patient.id, last_name: patient.last_name || null });
        continue;
      }
      try {
        await base44.asServiceRole.entities.Patient.update(patient.id, {
          is_archived: true,
          // 'merged' is the soft-archive sentinel the Patient.status enum defines
          // (active|discharged|merged); the prior 'archived' value was not in the
          // enum and was silently dropped, leaving these stubs flagged 'active'.
          status: 'merged',
        });
        archivedCount++;
      } catch (error) {
        failed.push({
          id: patient.id,
          name: patient.last_name || 'Unknown',
          error: error.message,
        });
      }
    }

    return Response.json({
      success: true,
      message: `Archived ${archivedCount} patient(s) without first name`,
      archivedCount,
      failed,
      skippedFlagged,
      ...(skippedFlagged.length
        ? { note: `${skippedFlagged.length} candidate(s) with identifying data were skipped — review individually (re-send with { include_flagged: true } only after verifying each is a stub).` }
        : {}),
      totalProcessed: candidates.length,
    });
  } catch (error) {
    console.error('deletePatientsMissingFirstName failed:', error);
    return Response.json({ error: 'Internal server error' }, { status: 500 });
  }
});