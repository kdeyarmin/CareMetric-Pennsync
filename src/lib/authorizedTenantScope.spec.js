import { describe, expect, it } from 'vitest';
import {
  authorizedTenantScopeKey,
  sameAuthorizedTenantScope,
} from './authorizedTenantScope';

const scope = Object.freeze({
  user_id: 'user-1',
  agency_id: 'agency-1',
  membership_id: 'membership-1',
  membership_version: 7,
  tenant_role: 'agency_admin',
});

describe('sameAuthorizedTenantScope', () => {
  it('accepts two separately materialized copies of the exact immutable authority', () => {
    expect(sameAuthorizedTenantScope({ ...scope }, { ...scope })).toBe(true);
  });

  it.each([
    ['user_id', 'user-2'],
    ['agency_id', 'agency-2'],
    ['membership_id', 'membership-2'],
    ['membership_version', 8],
    ['tenant_role', 'manager'],
  ])('rejects a %s mismatch', (field, value) => {
    expect(sameAuthorizedTenantScope(scope, { ...scope, [field]: value })).toBe(false);
  });

  it('rejects absent and incomplete scopes', () => {
    expect(sameAuthorizedTenantScope(null, scope)).toBe(false);
    expect(sameAuthorizedTenantScope(scope, { ...scope, agency_id: null })).toBe(false);
    expect(sameAuthorizedTenantScope(scope, { ...scope, membership_id: '  ' })).toBe(false);
    expect(sameAuthorizedTenantScope(scope, { ...scope, membership_version: 1.5 })).toBe(false);
  });

  it('explicitly rejects matching platform-owner contexts pending a reviewed agency selector', () => {
    const ownerScope = {
      user_id: 'owner-1',
      agency_id: 'agency-1',
      membership_id: null,
      membership_version: null,
      tenant_role: 'platform_owner',
    };
    expect(sameAuthorizedTenantScope(ownerScope, { ...ownerScope })).toBe(false);
    expect(authorizedTenantScopeKey(ownerScope)).toBeNull();
  });

  it('keys every immutable membership field so matching tenant transitions invalidate snapshots', () => {
    const original = authorizedTenantScopeKey(scope);
    expect(original).toBeTypeOf('string');
    expect(authorizedTenantScopeKey({ ...scope, agency_id: 'agency-2' })).not.toBe(original);
    expect(authorizedTenantScopeKey({ ...scope, membership_version: 8 })).not.toBe(original);
  });
});
