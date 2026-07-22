export const PATIENT_PORTAL_CAPABILITIES = Object.freeze({
  VIEW_EDUCATION: "view_education",
  VIEW_DOCUMENTS: "view_documents",
  VIEW_VISIT_PREP: "view_visit_prep",
  UPDATE_PREFERENCES: "update_preferences",
  SEND_MESSAGE: "send_message",
});

const ALL_CAPABILITIES = Object.values(PATIENT_PORTAL_CAPABILITIES);
const REVOKED_STATUSES = new Set(["revoked", "expired", "disabled", "inactive"]);

function asArray(value) {
  return Array.isArray(value) ? value : [];
}

function isExpired(expiresAt, now = new Date()) {
  if (!expiresAt) return false;
  const expiry = new Date(expiresAt);
  return Number.isNaN(expiry.getTime()) || expiry.getTime() <= now.getTime();
}

export function normalizePortalAccessContext(context = {}, now = new Date()) {
  const token = context.token || {};
  const consent = context.consent || {};
  const account = context.account || {};
  const relationship = context.relationship || "patient";
  const requestedCapabilities = asArray(context.requestedCapabilities);
  const tokenCapabilities = asArray(token.capabilities).filter((capability) => ALL_CAPABILITIES.includes(capability));
  const consentCapabilities = asArray(consent.capabilities).filter((capability) => ALL_CAPABILITIES.includes(capability));
  const allowedCapabilities = tokenCapabilities.filter((capability) => consentCapabilities.includes(capability));

  const blockers = [];
  if (!context.patient?.id) blockers.push("missing_patient");
  if (!token.value && !account.id) blockers.push("missing_auth_context");
  if (REVOKED_STATUSES.has(token.status) || REVOKED_STATUSES.has(account.status)) blockers.push("revoked_or_inactive");
  if (isExpired(token.expires_at, now)) blockers.push("expired_token");
  if (consent.status !== "granted") blockers.push("missing_consent");
  if (requestedCapabilities.some((capability) => !allowedCapabilities.includes(capability))) blockers.push("capability_not_allowed");
  if (relationship === "caregiver" && !context.proxyAuthorization?.id) blockers.push("missing_proxy_authorization");

  return {
    patientId: context.patient?.id || null,
    relationship,
    tokenStatus: token.status || null,
    consentStatus: consent.status || null,
    requestedCapabilities,
    allowedCapabilities,
    deniedCapabilities: requestedCapabilities.filter((capability) => !allowedCapabilities.includes(capability)),
    ready: blockers.length === 0,
    blockers: [...new Set(blockers)],
  };
}

export function canAccessPortalCapability(context = {}, capability, now = new Date()) {
  const normalized = normalizePortalAccessContext(
    { ...context, requestedCapabilities: [capability] },
    now,
  );
  return {
    allowed: normalized.ready,
    reason: normalized.ready ? "allowed" : normalized.blockers[0],
    blockers: normalized.blockers,
  };
}

export function projectPatientForPortal(patient = {}) {
  return {
    id: patient.id || null,
    full_name: patient.full_name || patient.name || null,
    preferred_name: patient.preferred_name || null,
    primary_diagnosis: patient.primary_diagnosis || null,
    care_team_phone: patient.care_team_phone || patient.agency_phone || null,
    next_visit_at: patient.next_visit_at || null,
    education_preferences: patient.education_preferences || {},
    communication_preferences: patient.communication_preferences || {},
  };
}

export function createPortalAuditEvent({ patientId, actorId, relationship = "patient", action, capability, outcome, reason, occurredAt = new Date().toISOString() } = {}) {
  if (!patientId) throw new Error("patientId is required");
  if (!action) throw new Error("action is required");
  return {
    patient_id: patientId,
    actor_id: actorId || null,
    relationship,
    action,
    capability: capability || null,
    outcome: outcome || "attempted",
    reason: reason || null,
    occurred_at: occurredAt,
  };
}
