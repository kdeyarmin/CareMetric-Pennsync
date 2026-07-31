import { base44 } from '@/api/base44Client';

/**
 * Incident writes are service-role-only, so every mutation goes through the
 * updateIncident function. Status moves through `transitionIncident` (which
 * enforces the lifecycle graph and the corrective-action requirement); other
 * fields go through `patchIncident`, which cannot write status.
 */
// One invoke site: src/functions wrappers must target exactly one backend
// function (enforced by tools-check-backend-transpile.mjs).
const invokeUpdateIncident = (payload) => base44.functions.invoke('updateIncident', payload);

export const transitionIncident = ({ incidentId, toStatus, resolutionNotes, correctiveActionPlan } = {}) =>
  invokeUpdateIncident({
    action: 'transition',
    incident_id: incidentId,
    to_status: toStatus,
    resolution_notes: resolutionNotes,
    corrective_action_plan: correctiveActionPlan,
  });

export const patchIncident = ({ incidentId, patch } = {}) =>
  invokeUpdateIncident({
    action: 'patch',
    incident_id: incidentId,
    patch,
  });

/**
 * Move an incident to another patient. Used by the duplicate-patient merge,
 * which can no longer write Incident directly.
 */
export const reassignIncidentPatient = ({ incidentId, patientId } = {}) =>
  invokeUpdateIncident({
    action: 'reassign_patient',
    incident_id: incidentId,
    patient_id: patientId,
  });
