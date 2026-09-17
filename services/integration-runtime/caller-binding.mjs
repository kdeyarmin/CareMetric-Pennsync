import { exactObject, fail, ID, stable } from './contracts.mjs';

export const BROWSER_CONTRACT = 'cm.integrations.v2';
const KEYS = Object.freeze(['user_id', 'agency_id', 'membership_id', 'membership_version', 'tenant_role', 'is_platform_owner']);
const validId = value => typeof value === 'string' && ID.test(value);
const ROLES = new Set(['agency_admin', 'manager', 'clinician', 'office_staff', 'social_worker', 'spiritual_care']);

/** An expectation, never a grant: the server independently reads live authority. */
export function validateCallerBinding(value) {
  exactObject(value, KEYS, 'INVALID_CALLER_BINDING');
  if (Object.keys(value).length !== KEYS.length || !validId(value.user_id)
    || typeof value.is_platform_owner !== 'boolean') fail(400, 'INVALID_CALLER_BINDING');
  if (value.is_platform_owner) {
    if (value.tenant_role !== 'platform_owner' || value.agency_id !== null
      || value.membership_id !== null || value.membership_version !== null) fail(400, 'INVALID_CALLER_BINDING');
  } else if (!validId(value.agency_id) || !validId(value.membership_id)
    || !Number.isSafeInteger(value.membership_version) || value.membership_version < 1
    || !ROLES.has(value.tenant_role)) fail(400, 'INVALID_CALLER_BINDING');
  return Object.freeze(Object.fromEntries(KEYS.map(key => [key, value[key]])));
}

export function bindingFromContext(context) {
  if (!context || typeof context !== 'object') fail(400, 'INVALID_CALLER_BINDING');
  return validateCallerBinding(Object.fromEntries(KEYS.map(key => [key, context[key]])));
}

export function requireExpectedCaller(actual, expected) {
  const checked = validateCallerBinding(expected);
  let live;
  try { live = validateCallerBinding(actual); }
  catch { fail(403, 'CALLER_BINDING_UNAVAILABLE'); }
  if (stable(live) !== stable(checked)) fail(403, 'CALLER_BINDING_CHANGED');
  return live;
}
