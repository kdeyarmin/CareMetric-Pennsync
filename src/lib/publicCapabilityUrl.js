/** Remove a consumed capability handle from browser chrome without navigation. */
export function scrubPublicCapabilityParameter(parameterName) {
  if (typeof window === 'undefined' || typeof parameterName !== 'string') return false;
  const url = new URL(window.location.href);
  if (!url.searchParams.has(parameterName)) return false;
  url.searchParams.delete(parameterName);
  const replacement = `${url.pathname}${url.search}${url.hash}`;
  window.history.replaceState(window.history.state, document.title, replacement);
  return true;
}
