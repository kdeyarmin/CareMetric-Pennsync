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

/** Fields 'patch' may write. Status and its audit stamps are absent on purpose. */
const PATCHABLE_FIELDS = [
  'ai_tags',
  'severity',
  'state_reportable',
  'report',
  'incident_type',
  'witnesses',
  'follow_up_required',
  'follow_up_notes',
  'photo_urls',
];

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
    return Response.json({ error: "action must be 'transition' or 'patch'" }, { status: 400 });
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
  if (Object.keys(patch).length === 0) {
    return Response.json({ error: 'patch is empty' }, { status: 400 });
  }

  await base44.asServiceRole.entities.Incident.update(incident.id, patch);
  return Response.json({ success: true, updated_fields: Object.keys(patch) });
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
  }).catch((err) => console.error('incident transition audit failed:', err?.message || err));

  return Response.json({ success: true, status: toStatus });
}
