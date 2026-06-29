import { createClientFromRequest } from 'npm:@base44/sdk@0.8.31';

// Best-effort HTTP status extraction from an SDK/axios-style error (the exact
// shape isn't guaranteed, so check the common locations and tolerate absence).
const httpStatusOf = (e) => {
  const x = e || null;
  for (const c of [x?.status, x?.statusCode, x?.response?.status, x?.response?.statusCode, x?.cause?.status]) {
    if (typeof c === 'number') return c;
  }
  return null;
};

Deno.serve(async (req) => {
  try {
    const base44 = createClientFromRequest(req);
    const payload = await req.json();

    // Entity-trigger (fires on Visit create): invoked by the platform with no
    // identity / no custom header, so a secret gate would 403 the legitimate
    // trigger when INTERNAL_FN_SECRET is set. Defense for a trigger: re-fetch the
    // canonical Visit by id and derive the nurse + patient FROM the real record.
    // The id is ALWAYS present on a real trigger payload, so we require it and
    // NEVER fall back to the posted body — otherwise an unauthenticated caller
    // could omit the id and have arbitrary patient_id/created_by trusted, granting
    // an attacker-chosen email PHI access to any patient.
    const visitId = payload.data?.id;
    if (!visitId) {
      return Response.json({ success: true, skipped: 'no visit id' });
    }
    const visit = await base44.asServiceRole.entities.Visit.get(visitId).catch(() => null);
    if (!visit) {
      return Response.json({ success: true, skipped: 'visit not found' });
    }
    const patient_id = visit.patient_id;
    const nurse_email = visit.created_by;

    if (!patient_id || !nurse_email) {
      console.error('Missing patient_id or created_by on Visit:', visitId);
      return Response.json({ error: 'patient_id and nurse_email are required' }, { status: 400 });
    }

    // Get patient using service role to bypass RLS
    const patient = await base44.asServiceRole.entities.Patient.get(patient_id);
    
    if (!patient) {
      return Response.json({ error: 'Patient not found' }, { status: 404 });
    }

    // Add nurse to assigned_nurses array if not already present
    const assignedNurses = patient.assigned_nurses || [];
    if (!assignedNurses.includes(nurse_email)) {
      assignedNurses.push(nurse_email);

      // Prefer a MINIMAL write that only touches the PHI-access-scoping field, so we
      // never fabricate PHI on a real patient record. If the platform validates the
      // whole record on update, this minimal write throws for a legacy/incomplete
      // record missing required fields — only THEN do we backfill those specific
      // fields (logged) so the nurse still gets access. A record that already has
      // its required fields, or a platform that validates only the patch, never gets
      // a placeholder.
      try {
        await base44.asServiceRole.entities.Patient.update(patient_id, { assigned_nurses: assignedNurses });
      } catch (minimalErr) {
        // Only a likely required-field VALIDATION failure should trigger the
        // placeholder backfill. A clearly transient/non-validation error — server
        // 5xx, 429 rate-limit, or 401/403 auth — must rethrow so the real cause
        // surfaces instead of being masked by a retry that fabricates PHI. A 4xx
        // (typical validation status) or an undetectable status keeps the safe
        // default (backfill), since this path exists to let a legacy record's
        // assignment still complete.
        const status = httpStatusOf(minimalErr);
        if (status !== null && (status >= 500 || status === 429 || status === 401 || status === 403)) {
          throw minimalErr;
        }

        const updateData = { assigned_nurses: assignedNurses };
        const backfilled = [];
        if (!patient.address || typeof patient.address !== 'string') { updateData.address = patient.address ? String(patient.address) : 'Unknown'; backfilled.push('address'); }
        if (!patient.phone || typeof patient.phone !== 'string') { updateData.phone = patient.phone ? String(patient.phone) : '000-000-0000'; backfilled.push('phone'); }
        if (!patient.emergency_contact_name || typeof patient.emergency_contact_name !== 'string') { updateData.emergency_contact_name = patient.emergency_contact_name ? String(patient.emergency_contact_name) : 'Unknown'; backfilled.push('emergency_contact_name'); }
        if (!patient.emergency_contact_phone || typeof patient.emergency_contact_phone !== 'string') { updateData.emergency_contact_phone = patient.emergency_contact_phone ? String(patient.emergency_contact_phone) : '000-000-0000'; backfilled.push('emergency_contact_phone'); }
        if (!patient.date_of_birth || typeof patient.date_of_birth !== 'string') { updateData.date_of_birth = '1900-01-01'; backfilled.push('date_of_birth'); }

        // If nothing was missing, the minimal write failed for some OTHER reason
        // (network, permissions, …) — don't mask it by writing placeholders.
        if (backfilled.length === 0) throw minimalErr;

        console.warn(
          `autoAssignNurseToPatient: minimal assigned_nurses update failed for patient ${patient_id} ` +
          `(${minimalErr?.message}); backfilling missing required fields to complete the ` +
          `assignment: ${backfilled.join(', ')}. These are PLACEHOLDERS on an incomplete legacy record ` +
          `and should be corrected with the patient's real data.`
        );
        await base44.asServiceRole.entities.Patient.update(patient_id, updateData);
      }
    }

    return Response.json({ 
      success: true, 
      message: 'Nurse assigned to patient',
      assigned_nurses: assignedNurses
    });
  } catch (error) {
    console.error('Error assigning nurse:', error);
    return Response.json({ error: error.message }, { status: 500 });
  }
});