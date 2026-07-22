import test from "node:test";
import assert from "node:assert/strict";
import {
  PATIENT_PORTAL_CAPABILITIES,
  canAccessPortalCapability,
  createPortalAuditEvent,
  normalizePortalAccessContext,
  projectPatientForPortal,
} from "./patientPortalAccess.js";

const now = new Date("2026-07-22T12:00:00.000Z");

const baseContext = {
  patient: { id: "pat-1", full_name: "Jane Patient", ssn: "111-22-3333", internal_notes: "staff only" },
  token: {
    value: "token",
    status: "active",
    expires_at: "2026-07-23T12:00:00.000Z",
    capabilities: [PATIENT_PORTAL_CAPABILITIES.VIEW_EDUCATION, PATIENT_PORTAL_CAPABILITIES.VIEW_VISIT_PREP],
  },
  consent: {
    status: "granted",
    capabilities: [PATIENT_PORTAL_CAPABILITIES.VIEW_EDUCATION, PATIENT_PORTAL_CAPABILITIES.VIEW_VISIT_PREP],
  },
  requestedCapabilities: [PATIENT_PORTAL_CAPABILITIES.VIEW_EDUCATION],
};

test("normalizes ready portal context only when auth, consent, and capability scope align", () => {
  const context = normalizePortalAccessContext(baseContext, now);
  assert.equal(context.ready, true);
  assert.deepEqual(context.blockers, []);
  assert.deepEqual(context.allowedCapabilities, [
    PATIENT_PORTAL_CAPABILITIES.VIEW_EDUCATION,
    PATIENT_PORTAL_CAPABILITIES.VIEW_VISIT_PREP,
  ]);
});

test("blocks expired, revoked, missing consent, and out-of-scope capability requests", () => {
  const context = normalizePortalAccessContext({
    ...baseContext,
    token: { ...baseContext.token, status: "revoked", expires_at: "2026-07-21T12:00:00.000Z" },
    consent: { status: "withdrawn", capabilities: [PATIENT_PORTAL_CAPABILITIES.VIEW_EDUCATION] },
    requestedCapabilities: [PATIENT_PORTAL_CAPABILITIES.SEND_MESSAGE],
  }, now);

  assert.equal(context.ready, false);
  assert.deepEqual(context.blockers, ["revoked_or_inactive", "expired_token", "missing_consent", "capability_not_allowed"]);
  assert.deepEqual(context.deniedCapabilities, [PATIENT_PORTAL_CAPABILITIES.SEND_MESSAGE]);
});

test("requires proxy authorization for caregiver relationship", () => {
  const result = canAccessPortalCapability({ ...baseContext, relationship: "caregiver" }, PATIENT_PORTAL_CAPABILITIES.VIEW_EDUCATION, now);
  assert.equal(result.allowed, false);
  assert.equal(result.reason, "missing_proxy_authorization");
});

test("projects only patient-safe fields for a portal response", () => {
  const projected = projectPatientForPortal(baseContext.patient);
  assert.deepEqual(Object.keys(projected), [
    "id",
    "full_name",
    "preferred_name",
    "primary_diagnosis",
    "care_team_phone",
    "next_visit_at",
    "education_preferences",
    "communication_preferences",
  ]);
  assert.equal(projected.ssn, undefined);
  assert.equal(projected.internal_notes, undefined);
});

test("creates deterministic portal audit events and validates required fields", () => {
  assert.deepEqual(createPortalAuditEvent({
    patientId: "pat-1",
    actorId: "portal-user-1",
    action: "viewed",
    capability: PATIENT_PORTAL_CAPABILITIES.VIEW_EDUCATION,
    outcome: "allowed",
    occurredAt: "2026-07-22T12:00:00.000Z",
  }), {
    patient_id: "pat-1",
    actor_id: "portal-user-1",
    relationship: "patient",
    action: "viewed",
    capability: PATIENT_PORTAL_CAPABILITIES.VIEW_EDUCATION,
    outcome: "allowed",
    reason: null,
    occurred_at: "2026-07-22T12:00:00.000Z",
  });
  assert.throws(() => createPortalAuditEvent({ action: "viewed" }), /patientId is required/);
});
