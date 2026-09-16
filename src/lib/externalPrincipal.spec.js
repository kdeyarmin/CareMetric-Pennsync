import { beforeEach, expect, it } from 'vitest';
import { bindTrustedTenantContext, clearTrustedTenantContext, getActiveTrustedTenantContext } from './roles';

beforeEach(() => clearTrustedTenantContext());

it('exposes only the current frozen external expectation and clears it on invalid rebinding', () => {
  const user = { id: 'user-a', email: 'synthetic@example.test', role: 'user' };
  const context = () => ({ user_id: user.id, user_email: user.email, agency_id: 'agency-a',
    membership_id: 'member-a', membership_key: `agency-a:${user.id}`, membership_version: 1,
    membership_status: 'active', tenant_role: 'agency_admin', is_platform_owner: false,
    agency: { id: 'agency-a', status: 'active' } });
  expect(getActiveTrustedTenantContext()).toBeNull();
  const source = context();
  bindTrustedTenantContext(user, source);
  const expected = getActiveTrustedTenantContext();
  expect(expected).toEqual(source);
  expect(Object.isFrozen(expected)).toBe(true);
  expect(Object.isFrozen(expected.agency)).toBe(true);
  source.tenant_role = 'clinician';
  source.agency.status = 'suspended';
  expect(expected.tenant_role).toBe('agency_admin');
  expect(expected.agency.status).toBe('active');
  bindTrustedTenantContext(user, { ...source, user_id: 'other' });
  expect(getActiveTrustedTenantContext()).toBeNull();
  bindTrustedTenantContext(user, context());
  clearTrustedTenantContext();
  expect(getActiveTrustedTenantContext()).toBeNull();
});
