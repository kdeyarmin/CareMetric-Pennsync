import { createClientFromRequest } from 'npm:@base44/sdk@0.8.31';

/**
 * updateIncident — the only write path for an existing Incident.
 *
 * Incident.rls.write is service-role-only, so every mutation lands here. That
 * matters because the CAP lifecycle is a compliance control: before this
 * function existed the transition graph and the "high-severity / state-
 * reportable incidents need a corrective action plan" rule ran only in
 * IncidentReviewQueue, while write RLS admitted the record's creator and any
 * admin. The nurse who filed an incident could PATCH status:'resolved'
 * straight through the entity API and skip the CAP requirement entirely.
 *
 * Two actions:
 *   { action: 'transition', incident_id, to_status, ... }  status changes
 *   { action: 'patch',      incident_id, patch: {...} }    everything else
 *
 * `patch` deliberately cannot write status or the review/closure stamps — those
 * only move through 'transition', so the graph cannot be sidestepped by
 * relabelling a status write as a field update.
 *
 * The lifecycle tables below are inlined from src/lib/recordLifecycle.js and
 * src/components/incident/incidentLifecycle.js (backend entries are
 * self-contained). base44/functions/incidentLifecycleInlineParity.test.js keeps
 * the two copies in agreement.
 */

// <<<BEGIN SHARED HELPER: requireActiveUser — generated, edit base44/_shared/backendHelpers.mjs>>>
const isDeactivatedUser = (u) => !!u && u.is_active === false;
const DEACTIVATED_USER_RESPONSE = () => Response.json(
  { error: 'Unauthorized - account is deactivated' },
  { status: 403 },
);
// <<<END SHARED HELPER: requireActiveUser>>>

// <<<BEGIN SHARED HELPER: requireAgencyAdminAgency — generated, edit base44/_shared/backendHelpers.mjs>>>
function agencyAdminMissingAgencyResponse(user) {
  if (user && user.account_type === 'agency_admin' && !String(user.agency_name || '').trim()) {
    return Response.json({ error: 'Forbidden: agency_name is required.' }, { status: 403 });
  }
  return null;
}
// <<<END SHARED HELPER: requireAgencyAdminAgency>>>


const INCIDENT_STATUS_TO_LIFECYCLE = {
  reported: 'submitted',
  under_review: 'in_review',
  corrective_action: 'correction_requested',
  resolved: 'final',
  archived: 'archived',
};

const LIFECYCLE_TRANSITIONS = {
  draft: ['submitted', 'voided'],
  submitted: ['in_review', 'correction_requested', 'final', 'voided'],
  in_review: ['correction_requested', 'final', 'voided'],
  correction_requested: ['corrected', 'final', 'voided'],
  corrected: ['in_review', 'final', 'voided'],
  final: ['correction_requested', 'archived'],
  voided: [],
  archived: [],
};

/**
 * Fields 'patch' may write. Status and its audit stamps are absent on purpose.
 *
 * Split by caller because severity and state_reportable are the inputs to
 * incidentNeedsCorrectiveAction: if the reporter could write them, they could
 * downgrade their own high-severity incident and clear the state-reportable
 * flag, after which the resolve gate reads the softened values and lets it
 * close with no corrective action -- defeating the control this function
 * exists to enforce. Narrative fields stay owner-writable so a reporter can
 * still correct their own account of what happened.
 */
const ADMIN_ONLY_PATCHABLE_FIELDS = [
  'severity',
  'state_reportable',
  'ai_tags',
];

const OWNER_PATCHABLE_FIELDS = [
  'report',
  'incident_type',
  'witnesses',
  'follow_up_required',
  'follow_up_notes',
  'photo_urls',
];

const PATCHABLE_FIELDS = [...ADMIN_ONLY_PATCHABLE_FIELDS, ...OWNER_PATCHABLE_FIELDS];

function canTransitionIncidentStatus(fromStatus, toStatus) {
  if (fromStatus === 'corrective_action' && toStatus === 'resolved') return true;
  const from = INCIDENT_STATUS_TO_LIFECYCLE[fromStatus || 'reported'];
  const to = INCIDENT_STATUS_TO_LIFECYCLE[toStatus];
  if (!from || !to) return false;
  if (from === to) return true;
  return (LIFECYCLE_TRANSITIONS[from] || []).includes(to);
}

function incidentNeedsCorrectiveAction(incident = {}) {
  return incident.state_reportable === true
    || ['high', 'critical'].includes(String(incident.severity || '').toLowerCase());
}

Deno.serve(async (req) => {
  try {
    const base44 = createClientFromRequest(req);
    const currentUser = await base44.auth.me();
    if (!currentUser) {
      return Response.json({ error: 'Unauthorized' }, { status: 401 });
    }
    if (isDeactivatedUser(currentUser)) return DEACTIVATED_USER_RESPONSE();
    {
      const _agencyAdminGate = agencyAdminMissingAgencyResponse(currentUser);
      if (_agencyAdminGate) return _agencyAdminGate;
    }
    if (currentUser.is_active === false) {
      return Response.json({ error: 'Unauthorized - account is deactivated' }, { status: 403 });
    }

    const body = await req.json().catch(() => ({}));
    const { incident_id, action } = body;
    if (!incident_id) {
      return Response.json({ error: 'incident_id is required' }, { status: 400 });
    }

    const rows = await base44.asServiceRole.entities.Incident.filter({ id: incident_id }, undefined, 1);
    const incident = rows?.[0];
    if (!incident) {
      return Response.json({ error: 'Incident not found' }, { status: 404 });
    }

    const isAdmin = currentUser.role === 'admin'
      || currentUser.account_type === 'agency_admin'
      || currentUser.account_type === 'super_admin';

    if (action === 'patch') {
      return await patchIncident(base44, currentUser, incident, body, isAdmin);
    }
    if (action === 'transition') {
      return await transitionIncident(base44, currentUser, incident, body, isAdmin);
    }
    if (action === 'reassign_patient') {
      return await reassignIncidentPatient(base44, currentUser, incident, body, isAdmin);
    }
    return Response.json({
      error: "action must be 'transition', 'patch', or 'reassign_patient'",
    }, { status: 400 });
  } catch (error) {
    console.error('updateIncident error:', error);
    return Response.json({ error: 'Internal server error' }, { status: 500 });
  }
});

async function patchIncident(base44, currentUser, incident, body, isAdmin) {
  // Mirrors the old RLS rule (creator or admin) now that RLS itself can no
  // longer express it -- entity writes are service-role-only.
  const isOwner = incident.created_by === currentUser.email;
  if (!isAdmin && !isOwner) {
    return Response.json({ error: 'Unauthorized - not your incident' }, { status: 403 });
  }
  if (isAdmin) {
    const agencyDenied = await assertAgencyIncidentAccess(base44, currentUser, incident);
    if (agencyDenied) return agencyDenied;
  }

  const patch = body.patch && typeof body.patch === 'object' ? body.patch : {};
  const rejected = Object.keys(patch).filter((k) => !PATCHABLE_FIELDS.includes(k));
  if (rejected.length > 0) {
    return Response.json({
      error: `These fields cannot be set via patch: ${rejected.join(', ')}. `
        + "Status changes must use action:'transition'.",
    }, { status: 400 });
  }

  // severity / state_reportable decide whether a corrective action plan is
  // required, so a non-admin owner must not be able to soften them.
  if (!isAdmin) {
    const privileged = Object.keys(patch).filter((k) => ADMIN_ONLY_PATCHABLE_FIELDS.includes(k));
    if (privileged.length > 0) {
      return Response.json({
        error: `Only an admin can change: ${privileged.join(', ')}.`,
      }, { status: 403 });
    }
  }
  if (Object.keys(patch).length === 0) {
    return Response.json({ error: 'patch is empty' }, { status: 400 });
  }

  await base44.asServiceRole.entities.Incident.update(incident.id, patch);

  // Mirror transitionIncident: persist an append-only trail for compliance review.
  // Before/after only for keys that actually change so the audit stays readable.
  const changed = {};
  for (const key of Object.keys(patch)) {
    changed[key] = { before: incident[key] ?? null, after: patch[key] };
  }
  let auditRecorded = true;
  await base44.asServiceRole.entities.UserActivity.create({
    user_email: currentUser.email,
    user_name: currentUser.full_name,
    action: 'incident_patched',
    details: {
      incident_id: incident.id,
      updated_fields: Object.keys(patch),
      changes: changed,
    },
    page: 'IncidentReview',
    entity_type: 'Incident',
    entity_id: incident.id,
  }).catch((err) => {
    auditRecorded = false;
    console.error('incident patch audit failed:', err?.message || err);
  });

  return Response.json({
    success: true,
    updated_fields: Object.keys(patch),
    audit_recorded: auditRecorded,
    ...(auditRecorded ? {} : {
      warning: 'Incident updated, but the audit record could not be written. '
        + 'Record this patch manually.',
    }),
  });
}

async function assertAgencyIncidentAccess(base44, currentUser, incident) {
  // Agency-scope facility admins too (parity with getDashboardData): only
  // super_admin / admin-without-agency stay platform-wide.
  const isAgencyScoped = currentUser.account_type !== 'super_admin'
    && currentUser.agency_name
    && (currentUser.account_type === 'agency_admin' || currentUser.role === 'admin');
  if (!isAgencyScoped) return null;
  if (!currentUser.agency_name) {
    return Response.json({ error: 'Forbidden: incident is outside your agency.' }, { status: 403 });
  }
  if (!incident.patient_id) {
    // No patient link — fall back to reporter agency membership.
    const reporters = await base44.asServiceRole.entities.User
      .filter({ email: incident.created_by }, undefined, 5)
      .catch(() => []);
    if (!reporters?.[0] || reporters[0].agency_name !== currentUser.agency_name) {
      return Response.json({ error: 'Forbidden: incident is outside your agency.' }, { status: 403 });
    }
    return null;
  }
  const agencyUsers = await base44.asServiceRole.entities.User.list('-created_date', 5000).catch(() => []);
  const agencyEmails = new Set(
    (agencyUsers || [])
      .filter((u) => u.agency_name === currentUser.agency_name && u.email)
      .map((u) => u.email),
  );
  const patients = await base44.asServiceRole.entities.Patient
    .filter({ id: incident.patient_id }, undefined, 5)
    .catch(() => []);
  const patient = patients?.[0];
  const inAgency = patient && (
    (patient.created_by && agencyEmails.has(patient.created_by))
    || (Array.isArray(patient.assigned_nurses) && patient.assigned_nurses.some((e) => agencyEmails.has(e)))
  );
  if (!inAgency) {
    return Response.json({ error: 'Forbidden: incident is outside your agency.' }, { status: 403 });
  }
  return null;
}

async function transitionIncident(base44, currentUser, incident, body, isAdmin) {
  // Reviewing an incident is an admin action; the reporter files it, the office
  // reviews it. Enforced here rather than by hiding the queue in the UI.
  if (!isAdmin) {
    return Response.json({ error: 'Unauthorized - Admin access required' }, { status: 403 });
  }

  const agencyDenied = await assertAgencyIncidentAccess(base44, currentUser, incident);
  if (agencyDenied) return agencyDenied;

  const fromStatus = incident.status || 'reported';
  const toStatus = body.to_status;
  if (!toStatus) {
    return Response.json({ error: 'to_status is required' }, { status: 400 });
  }
  // The lifecycle graph treats from === to as legal (an idempotent no-op), but
  // this handler is not idempotent: it re-stamps closed_by/closed_at and
  // reviewed_by/reviewed_at from the *current* caller and writes another
  // UserActivity row. Replaying 'resolved' -> 'resolved' would therefore
  // reattribute the closure to whoever replayed it and bury the real one in
  // duplicate audit entries. A no-op is not a transition; refuse it.
  if (fromStatus === toStatus) {
    return Response.json({
      error: `Incident is already ${String(toStatus).replace(/_/g, ' ')}.`,
    }, { status: 400 });
  }
  if (!canTransitionIncidentStatus(fromStatus, toStatus)) {
    return Response.json({
      error: `Invalid incident status transition: ${fromStatus} -> ${toStatus}`,
    }, { status: 400 });
  }

  const capPlan = String(body.corrective_action_plan || '').trim();
  const notes = String(body.resolution_notes || '').trim();

  // The reason this function exists: a high-severity or state-reportable
  // incident cannot reach 'resolved' with no corrective action recorded.
  if (toStatus === 'resolved' && incidentNeedsCorrectiveAction(incident)) {
    const existingPlan = String(incident.corrective_action_plan || '').trim();
    if (!capPlan && !existingPlan && !notes) {
      return Response.json({
        error: 'High-severity or state-reportable incidents need a corrective '
          + 'action plan or resolution note before they can be resolved.',
      }, { status: 400 });
    }
  }

  const at = new Date().toISOString();
  const payload = { status: toStatus };
  if (capPlan) payload.corrective_action_plan = capPlan;
  if (notes) payload.resolution_notes = notes;

  if (toStatus === 'under_review' || toStatus === 'corrective_action') {
    payload.reviewed_by = currentUser.email;
    payload.reviewed_at = at;
    payload.investigator_email = currentUser.email || incident.investigator_email;
    payload.office_notified = true;
  }
  if (toStatus === 'resolved') {
    payload.closed_by = currentUser.email;
    payload.closed_at = at;
    payload.reviewed_by = incident.reviewed_by || currentUser.email;
    payload.reviewed_at = incident.reviewed_at || at;
  }

  await base44.asServiceRole.entities.Incident.update(incident.id, payload);

  // Persist the transition instead of shaping an audit event and dropping it
  // (the client helper's return value was discarded), so the review history is
  // an append-only trail rather than whatever the mutable fields last held.
  let auditRecorded = true;
  await base44.asServiceRole.entities.UserActivity.create({
    user_email: currentUser.email,
    user_name: currentUser.full_name,
    action: 'incident_status_changed',
    details: {
      incident_id: incident.id,
      from_status: fromStatus,
      to_status: toStatus,
      from_lifecycle: INCIDENT_STATUS_TO_LIFECYCLE[fromStatus] || null,
      to_lifecycle: INCIDENT_STATUS_TO_LIFECYCLE[toStatus] || null,
      required_corrective_action: incidentNeedsCorrectiveAction(incident),
      reason: (capPlan || notes || `Status -> ${toStatus}`).slice(0, 500),
    },
    page: 'IncidentReview',
    entity_type: 'Incident',
    entity_id: incident.id,
  }).catch((err) => {
    // The status write already committed, so this cannot be rolled back here.
    // Report it instead of claiming an audit trail that does not exist: a
    // transition whose record is missing is exactly what a compliance review
    // needs to know about.
    auditRecorded = false;
    console.error('incident transition audit failed:', err?.message || err);
  });

  return Response.json({
    success: true,
    status: toStatus,
    audit_recorded: auditRecorded,
    ...(auditRecorded ? {} : {
      warning: 'Status changed, but the audit record could not be written. '
        + 'Record this transition manually.',
    }),
  });
}

/**
 * Reassign an incident to another patient. Used by the duplicate-patient merge,
 * which can no longer write Incident directly now that RLS is service-role-only
 * -- without this the merge silently leaves incidents on the archived chart.
 */
async function reassignIncidentPatient(base44, currentUser, incident, body, isAdmin) {
  if (!isAdmin) {
    return Response.json({ error: 'Unauthorized - Admin access required' }, { status: 403 });
  }
  const agencyDenied = await assertAgencyIncidentAccess(base44, currentUser, incident);
  if (agencyDenied) return agencyDenied;

  const patientId = body.patient_id;
  if (!patientId) {
    return Response.json({ error: 'patient_id is required' }, { status: 400 });
  }

  // Destination patient must also be in-agency for agency-scoped admins.
  const probe = { patient_id: patientId, created_by: incident.created_by };
  const destDenied = await assertAgencyIncidentAccess(base44, currentUser, probe);
  if (destDenied) return destDenied;

  await base44.asServiceRole.entities.Incident.update(incident.id, { patient_id: patientId });

  await base44.asServiceRole.entities.UserActivity.create({
    user_email: currentUser.email,
    user_name: currentUser.full_name,
    action: 'incident_patient_reassigned',
    details: { incident_id: incident.id, from_patient_id: incident.patient_id, to_patient_id: patientId },
    page: 'PatientMerge',
    entity_type: 'Incident',
    entity_id: incident.id,
  }).catch((err) => console.error('incident reassign audit failed:', err?.message || err));

  return Response.json({ success: true, patient_id: patientId });
}
