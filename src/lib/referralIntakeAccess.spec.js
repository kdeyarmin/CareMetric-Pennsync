import { beforeEach, describe, expect, it } from 'vitest';
import { ROUTES } from '@/routes';
import { NAV_MANIFEST, buildAdminItems, buildNavCategories, buildPaletteEntries, isPageAllowedForRole } from '@/lib/nav.manifest';
import { bindTrustedTenantContext, clearTrustedTenantContext, getRoleView, isReferralIntakeRole } from '@/lib/roles';

const user = { id: 'intake-user', email: 'intake@agency.test', role: 'user', staff_role: 'office_staff' };
const bindRole = (tenant_role) => bindTrustedTenantContext(user, {
  user_id: user.id, user_email: user.email,
  membership_id: 'intake-membership', membership_key: `agency-a:${user.id}`,
  membership_version: 1, agency_id: 'agency-a', membership_status: 'active',
  tenant_role, is_platform_owner: false,
  agency: { id: 'agency-a', name: 'Agency A', status: 'active' },
});
const pages = (categories) => categories.flatMap(({ items }) => items).map(({ page }) => page);
beforeEach(() => clearTrustedTenantContext());

describe('referral intake role access', () => {
  it.each(['agency_admin', 'manager', 'office_staff'])('admits a verified %s to intake, follow-up, and triage', (role) => {
    const bound = bindRole(role);
    const view = getRoleView(bound);
    expect(isReferralIntakeRole(bound)).toBe(true);
    expect(isPageAllowedForRole('ReferralIntake', view, bound)).toBe(true);
    expect(isPageAllowedForRole('ReferralFollowUp', view, bound)).toBe(true);
    expect(isPageAllowedForRole('ReferralTriage', view, bound)).toBe(true);
    expect(isPageAllowedForRole('IncidentReview', view, bound)).toBe(role === 'agency_admin');
    expect(isPageAllowedForRole('DocumentHub', view, bound)).toBe(role === 'agency_admin');
  });
  it.each(['clinician', 'social_worker', 'spiritual_care'])('does not admit %s', (role) => {
    const bound = bindRole(role);
    expect(isReferralIntakeRole(bound)).toBe(false);
    expect(isPageAllowedForRole('ReferralIntake', getRoleView(bound), bound)).toBe(false);
    expect(isPageAllowedForRole('ReferralTriage', getRoleView(bound), bound)).toBe(false);
  });
  it('requires an exact trusted identity', () => {
    expect(isReferralIntakeRole(user)).toBe(false);
    bindRole('office_staff');
    expect(isReferralIntakeRole({ ...user, id: 'other-user' })).toBe(false);
    clearTrustedTenantContext();
    expect(isReferralIntakeRole(user)).toBe(false);
  });
  it('keeps the route and staff navigation available without making office staff administrators', () => {
    const bound = bindRole('office_staff');
    const route = ROUTES.find(({ name }) => name === 'ReferralIntake');
    expect(route).toMatchObject({ adminOnly: true, intakeRole: true });
    expect(getRoleView(bound)).toBe('nurse');
    expect(isPageAllowedForRole('SuperAdminConfig', getRoleView(bound), bound)).toBe(false);
    const staffPages = pages(buildNavCategories(NAV_MANIFEST, bound));
    expect(staffPages).toEqual(expect.arrayContaining(['ReferralIntake', 'ReferralFollowUp', 'ReferralTriage']));
    expect(staffPages).not.toEqual(expect.arrayContaining(['IncidentReview', 'DocumentHub']));
    const palette = buildPaletteEntries(NAV_MANIFEST, false, false, bound).map(({ page }) => page);
    expect(palette).toEqual(expect.arrayContaining(['ReferralIntake', 'ReferralFollowUp', 'ReferralTriage']));
    expect(palette).not.toContain('DocumentHub');
  });
  it('still lists referral pages once in the admin Office section', () => {
    const bound = bindRole('agency_admin');
    const adminPages = pages(buildAdminItems(NAV_MANIFEST, false));
    const staffPages = pages(buildNavCategories(NAV_MANIFEST, bound));
    for (const page of ['ReferralIntake', 'ReferralFollowUp', 'ReferralTriage']) {
      expect(adminPages).toContain(page);
      expect(staffPages).not.toContain(page);
    }
  });
});
