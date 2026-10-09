import { base44 } from '@/api/base44Client';

// On-demand outcome recompute for one agency and one window. The server checks
// the caller's agency_admin/manager membership for that agency before it signs
// a one-agency request to the outcome worker; the worker itself is never
// reachable from the browser.
export const computeOutcomeMeasures = (payload = {}) =>
  base44.functions.invoke('computeOutcomeMeasures', payload);
