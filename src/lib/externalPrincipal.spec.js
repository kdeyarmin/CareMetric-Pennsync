import { beforeEach, expect, it } from 'vitest';
import { bindTrustedTenantContext, clearTrustedTenantContext, getActiveTrustedTenantContext } from './roles';

beforeEach(() => clearTrustedTenantContext());

it('exposes only the current frozen external expectation and clears it on invalid rebinding', () => {
  const user = { id: 'user-a', email: 'synthetic@example.test', role: 'user' };
  const context = () => ({ user_id: user.id, user_email: user.email, agency_id: 'agency-a',
    membership_id: 'member-a', membership_key: `agency-a:${user.id}`, membership_version: 1,
    membership_status: 'active', tenant_role: 'agency_admin', is_platform_owner: false,
    agency: { id: 'agency-a', status: 'active' }, nested_extension: { notNeeded: true } });
  expect(getActiveTrustedTenantContext()).toBeNull();
  const source = context();
  bindTrustedTenantContext(user, source);
  const expected = getActiveTrustedTenantContext();
  expect(expected).toEqual({ user_id: user.id, agency_id: 'agency-a', membership_id: 'member-a',
    membership_version: 1, tenant_role: 'agency_admin', is_platform_owner: false });
  expect(Object.isFrozen(expected)).toBe(true);
  expect(Object.hasOwn(expected, 'agency')).toBe(false);
  expect(Object.hasOwn(expected, 'nested_extension')).toBe(false);
  expect(Object.hasOwn(expected, 'user_email')).toBe(false);
  source.tenant_role = 'clinician';
  source.agency.status = 'suspended';
  expect(expected.tenant_role).toBe('agency_admin');
  source.nested_extension.notNeeded = false;
  expect(getActiveTrustedTenantContext()).toEqual(expected);
  bindTrustedTenantContext(user, { ...source, user_id: 'other' });
  expect(getActiveTrustedTenantContext()).toBeNull();
  bindTrustedTenantContext(user, context());
  clearTrustedTenantContext();
  expect(getActiveTrustedTenantContext()).toBeNull();
});
