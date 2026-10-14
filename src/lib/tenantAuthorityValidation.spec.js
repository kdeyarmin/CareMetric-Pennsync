import { describe, expect, it } from 'vitest';

import {
  contextMatchesMembership,
  contextMatchesOwner,
  contextMatchesOwnerMembership,
} from './tenantAuthorityValidation';

const AGENCY = { id: 'agency-a', name: 'Agency A', status: 'active' };

const membership = (overrides = {}) => ({
  membership_id: 'membership-a',
  membership_key: 'agency-a:user-a',
  membership_version: 2,
  agency_id: 'agency-a',
  tenant_role: 'agency_admin',
  membership_status: 'active',
  agency: { ...AGENCY },
  ...overrides,
});

const ownerSubject = (overrides = {}) => ({
  user_id: 'user-a',
  user_email: 'admin@agency.test',
  is_platform_owner: true,
  ...overrides,
});

const memberSubject = (overrides = {}) => ({
  user_id: 'user-a',
  user_email: 'admin@agency.test',
  is_platform_owner: false,
  ...overrides,
});

const boundContext = (overrides = {}) => ({
  user_id: 'user-a',
  user_email: 'admin@agency.test',
  membership_id: 'membership-a',
  membership_key: 'agency-a:user-a',
  membership_version: 2,
  agency_id: 'agency-a',
  tenant_role: 'agency_admin',
  membership_status: 'active',
  is_platform_owner: true,
  agency: { ...AGENCY },
  ...overrides,
});

describe('contextMatchesOwnerMembership', () => {
  it('matches an owner bound through their exact active membership', () => {
    expect(contextMatchesOwnerMembership(boundContext(), ownerSubject(), membership()))
      .toBe(true);
  });

  it('rejects a context or subject that drops the owner flag', () => {
    expect(contextMatchesOwnerMembership(
      boundContext({ is_platform_owner: false }), ownerSubject(), membership(),
    )).toBe(false);
    expect(contextMatchesOwnerMembership(
      boundContext(), memberSubject(), membership(),
    )).toBe(false);
  });

  it('rejects any drift in the membership identity, role, status, or agency', () => {
    const drifts = [
      { membership_id: 'membership-z' },
      { membership_key: 'agency-a:user-z' },
      { membership_version: 3 },
      { agency_id: 'agency-z' },
      { tenant_role: 'manager' },
      { membership_status: 'suspended' },
      { agency: { ...AGENCY, name: 'Agency Z' } },
      { agency: { ...AGENCY, status: 'trial' } },
      { agency: null },
      { user_id: 'user-z' },
      { user_email: 'other@agency.test' },
    ];
    for (const drift of drifts) {
      expect(contextMatchesOwnerMembership(
        boundContext(drift), ownerSubject(), membership(),
      )).toBe(false);
    }
    expect(contextMatchesOwnerMembership(null, ownerSubject(), membership())).toBe(false);
    expect(contextMatchesOwnerMembership(boundContext(), null, membership())).toBe(false);
    expect(contextMatchesOwnerMembership(boundContext(), ownerSubject(), null)).toBe(false);
  });

  it('keeps the member and owner matchers disjoint from the owner-membership shape', () => {
    // A member matcher must never accept the owner-flagged bound context,
    // and the membership-free owner matcher must never accept a bound one.
    expect(contextMatchesMembership(boundContext(), memberSubject(), membership()))
      .toBe(false);
    expect(contextMatchesOwner(boundContext(), ownerSubject())).toBe(false);
    expect(contextMatchesOwnerMembership(
      boundContext(), ownerSubject(), membership(),
    )).toBe(true);
  });
});
