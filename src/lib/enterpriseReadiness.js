export const SSO_REQUIRED_FIELDS = Object.freeze([
  "provider",
  "issuer",
  "client_id",
  "metadata_url",
  "default_role",
  "allowed_domains",
]);

export const ENTERPRISE_AUDIT_EXPORT_FIELDS = Object.freeze([
  "event_id",
  "tenant_id",
  "actor_id",
  "actor_role",
  "action",
  "resource_type",
  "resource_id",
  "outcome",
  "occurred_at",
  "ip_hash",
  "request_id",
]);

const ALLOWED_PROVIDERS = new Set(["oidc", "saml"]);

export function validateSsoReadiness(config = {}) {
  const missing = SSO_REQUIRED_FIELDS.filter((field) => {
    const value = config[field];
    return Array.isArray(value) ? value.length === 0 : !value;
  });
  const errors = [];
  if (config.provider && !ALLOWED_PROVIDERS.has(config.provider)) errors.push("unsupported_provider");
  if (config.metadata_url && !String(config.metadata_url).startsWith("https://")) errors.push("metadata_url_must_be_https");
  if (Array.isArray(config.allowed_domains) && config.allowed_domains.some((domain) => !/^[a-z0-9.-]+\.[a-z]{2,}$/i.test(domain))) {
    errors.push("invalid_allowed_domain");
  }

  return {
    ready: missing.length === 0 && errors.length === 0,
    missing,
    errors,
    provider: config.provider || null,
  };
}

function safe(value) {
  if (value === undefined || value === null) return null;
  return String(value);
}

export function normalizeEnterpriseAuditEvent(event = {}) {
  return {
    event_id: safe(event.event_id || event.id),
    tenant_id: safe(event.tenant_id || event.organization_id),
    actor_id: safe(event.actor_id || event.user_id),
    actor_role: safe(event.actor_role || event.role),
    action: safe(event.action),
    resource_type: safe(event.resource_type || event.entity),
    resource_id: safe(event.resource_id || event.record_id),
    outcome: safe(event.outcome || "unknown"),
    occurred_at: safe(event.occurred_at || event.created_at),
    ip_hash: safe(event.ip_hash || event.ipHash),
    request_id: safe(event.request_id || event.requestId),
  };
}

export function validateEnterpriseAuditEvent(event = {}) {
  const normalized = normalizeEnterpriseAuditEvent(event);
  const missing = ENTERPRISE_AUDIT_EXPORT_FIELDS.filter((field) => !normalized[field]);
  return { valid: missing.length === 0, missing, event: normalized };
}

export function toEnterpriseAuditExportRow(event = {}) {
  const normalized = normalizeEnterpriseAuditEvent(event);
  return ENTERPRISE_AUDIT_EXPORT_FIELDS.reduce((row, field) => {
    row[field] = normalized[field];
    return row;
  }, {});
}
