import { createClientFromRequest } from 'npm:@base44/sdk@0.8.31';

/**
 * updateIncident — the only write path for an existing Incident.
 *
 * Incident.rls create/update/delete rules are service-role-only, so every
 * mutation lands here. That
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

// <<<BEGIN SHARED HELPER: protectedUserAuthz — generated, edit base44/_shared/backendHelpers.mjs>>>
const normalizeProtectedEmail = (value) => String(value || '').trim().toLowerCase();
const isProtectedAdmin = (user) => !!user && user.role === 'admin';
function isProtectedSuperAdmin(user) {
  const configuredEmail = normalizeProtectedEmail(Deno.env.get('SUPER_ADMIN_EMAIL'));
  return !!configuredEmail
    && isProtectedAdmin(user)
    && normalizeProtectedEmail(user.email) === configuredEmail;
}
// <<<END SHARED HELPER: protectedUserAuthz>>>

// <<<BEGIN SHARED HELPER: activeMembershipAuthz — generated, edit base44/_shared/backendHelpers.mjs>>>
const normalizeMembershipEmail = (value) => String(value || '').trim().toLowerCase();
async function hasExactActiveAgencyMembership(base44, user) {
  const userId = typeof user?.id === 'string' ? user.id.trim() : '';
  const userEmail = normalizeMembershipEmail(user?.email);
  if (!userId || !userEmail) return false;
  let rows;
  try {
    rows = await base44.asServiceRole.entities.AgencyMembership.filter(
      { user_id: userId, status: 'active' },
      undefined,
      2,
    );
  } catch {
    return false;
  }
  if (!Array.isArray(rows) || rows.length !== 1) return false;
  const row = rows[0];
  return !!row
    && String(row.user_id || '').trim() === userId
    && String(row.status || '') === 'active'
    && normalizeMembershipEmail(row.user_email_normalized) === userEmail
    && typeof row.agency_id === 'string'
    && !!row.agency_id.trim();
}
// <<<END SHARED HELPER: activeMembershipAuthz>>>


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
    if (currentUser.disabled === true || currentUser.is_service === true || currentUser.is_verified === false) {
      return Response.json({ error: 'Forbidden' }, { status: 403 });
    }
    if (!isProtectedSuperAdmin(currentUser)
      && !(await hasExactActiveAgencyMembership(base44, currentUser))) {
      return Response.json({ error: 'Forbidden: active agency membership required' }, { status: 403 });
    }

    const body = await req.json().catch(() => ({}));
    const { action } = body;
    const incidentId = typeof body.incident_id === 'string' ? body.incident_id.trim() : '';
    if (!incidentId || incidentId.length > 200) {
      return Response.json({ error: 'incident_id is invalid' }, { status: 400 });
    }

    const rows = await base44.asServiceRole.entities.Incident
      .filter({ id: incidentId }, undefined, 2).catch(() => []);
    const exactRows = Array.isArray(rows)
      ? rows.filter((candidate) => candidate?.id === incidentId)
      : [];
    if (rows.length !== 1 || exactRows.length !== 1) {
      return Response.json({
        error: exactRows.length ? 'Incident lookup is ambiguous' : 'Incident not found',
      }, { status: exactRows.length ? 409 : 404 });
    }
    const incident = exactRows[0];

    const isAdmin = isProtectedSuperAdmin(currentUser);

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

  // Mirror transitionIncident with an append-only compliance event. Record
  // only which fields changed: the values can contain incident narrative,
  // witness names, notes, or photo URLs and belong only on Incident itself.
  let auditRecorded = true;
  await base44.asServiceRole.entities.UserActivity.create({
    user_email: currentUser.email,
    user_name: currentUser.full_name,
    action: 'incident_patched',
    details: {
      updated_fields: Object.keys(patch),
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

async function transitionIncident(base44, currentUser, incident, body, isAdmin) {
  // Reviewing an incident is an admin action; the reporter files it, the office
  // reviews it. Enforced here rather than by hiding the queue in the UI.
  if (!isAdmin) {
    return Response.json({ error: 'Unauthorized - Admin access required' }, { status: 403 });
  }

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
      from_status: fromStatus,
      to_status: toStatus,
      from_lifecycle: INCIDENT_STATUS_TO_LIFECYCLE[fromStatus] || null,
      to_lifecycle: INCIDENT_STATUS_TO_LIFECYCLE[toStatus] || null,
      required_corrective_action: incidentNeedsCorrectiveAction(incident),
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
  const patientId = body.patient_id;
  if (!patientId) {
    return Response.json({ error: 'patient_id is required' }, { status: 400 });
  }

  await base44.asServiceRole.entities.Incident.update(incident.id, { patient_id: patientId });

  await base44.asServiceRole.entities.UserActivity.create({
    user_email: currentUser.email,
    user_name: currentUser.full_name,
    action: 'incident_patient_reassigned',
    page: 'PatientMerge',
    entity_type: 'Incident',
    entity_id: incident.id,
  }).catch((err) => console.error('incident reassign audit failed:', err?.message || err));

  return Response.json({ success: true, patient_id: patientId });
}
