import test from "node:test";
import assert from "node:assert/strict";
import {
  ENTERPRISE_AUDIT_EXPORT_FIELDS,
  toEnterpriseAuditExportRow,
  validateEnterpriseAuditEvent,
  validateSsoReadiness,
} from "./enterpriseReadiness.js";

test("SSO readiness requires provider metadata, role, and domain scope", () => {
  assert.deepEqual(validateSsoReadiness({ provider: "oidc" }).missing, ["issuer", "client_id", "metadata_url", "default_role", "allowed_domains"]);
  assert.equal(validateSsoReadiness({
    provider: "oidc",
    issuer: "https://idp.example.com",
    client_id: "client-1",
    metadata_url: "https://idp.example.com/.well-known/openid-configuration",
    default_role: "nurse",
    allowed_domains: ["example.com"],
  }).ready, true);
});

test("SSO readiness rejects unsupported providers, insecure metadata URLs, and malformed domains", () => {
  const result = validateSsoReadiness({ provider: "ldap", metadata_url: "http://idp", allowed_domains: ["bad"] });
  assert.deepEqual(result.errors, ["unsupported_provider", "metadata_url_must_be_https", "invalid_allowed_domain"]);
});

test("enterprise audit export rows include only approved fields and require traceability", () => {
  const row = toEnterpriseAuditExportRow({
    id: "evt-1",
    organization_id: "tenant-1",
    user_id: "user-1",
    role: "admin",
    action: "patient.read",
    entity: "Patient",
    record_id: "pat-1",
    outcome: "allowed",
    created_at: "2026-07-22T12:00:00.000Z",
    ip_hash: "hash",
    requestId: "req-1",
    raw_ip: "203.0.113.1",
    patient_name: "Jane Patient",
  });
  assert.deepEqual(Object.keys(row), ENTERPRISE_AUDIT_EXPORT_FIELDS);
  assert.equal(row.raw_ip, undefined);
  assert.equal(row.patient_name, undefined);
  assert.equal(validateEnterpriseAuditEvent(row).valid, true);
});
