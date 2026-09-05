const FALLBACK_BASE44_BACKEND_HOSTS = new Set([
  'api.base44.com',
  'app.base44.com',
  'base44.com',
  'base44.app',
  'base44.dev',
  'base44.io',
]);

/**
 * Accept the build-pinned backend exactly. When a build has no configured
 * origin, accept only known shared platform hosts—not arbitrary customer-owned
 * subdomains under a Base44 suffix.
 */
export function isTrustedBase44BackendHost(host, configuredHost = null) {
  const candidate = typeof host === 'string' ? host.trim().toLowerCase() : '';
  const configured = typeof configuredHost === 'string'
    ? configuredHost.trim().toLowerCase()
    : '';
  if (!candidate) return false;
  if (configured && candidate === configured) return true;
  return FALLBACK_BASE44_BACKEND_HOSTS.has(candidate);
}
