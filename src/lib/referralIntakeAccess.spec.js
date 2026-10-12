import { beforeEach, describe, expect, it } from 'vitest';
import { ROUTES } from '@/routes';
import { NAV_MANIFEST, buildNavCategories, buildPaletteEntries, isPageAllowedForRole } from '@/lib/nav.manifest';
import { ACCESS, bindTrustedTenantContext, canAccessLevel, clearTrustedTenantContext, getRoleView } from '@/lib/roles';

const user = { id: 'intake-user', email: 'intake@agency.test', role: 'user', staff_role: 'office_staff' };
const bindRole = (tenant_role) => bindTrustedTenantContext(user, {
  user_id: user.id, user_email: user.email,
  membership_id: 'intake-membership', membership_key: `agency-a:${user.id}`,
  membership_version: 1, agency_id: 'agency-a', membership_status: 'active',
  tenant_role, is_platform_owner: false,
  agency: { id: 'agency-a', name: 'Agency A', status: 'active' },
});
beforeEach(() => clearTrustedTenantContext());

describe('referral intake role access', () => {
  it.each(['agency_admin', 'manager', 'office_staff'])('admits a verified %s to intake', (role) => {
    const bound = bindRole(role);
    expect(canAccessLevel(bound, ACCESS.INTAKE)).toBe(true);
    expect(isPageAllowedForRole('ReferralIntake', getRoleView(bound), bound)).toBe(true);
  });
  it.each(['clinician', 'social_worker', 'spiritual_care'])('does not admit %s based on a mutable office profile', (role) => {
    expect(canAccessLevel(bindRole(role), ACCESS.INTAKE)).toBe(false);
  });
  it('requires an exact trusted identity', () => {
    expect(canAccessLevel(user, ACCESS.INTAKE)).toBe(false);
    bindRole('office_staff');
    expect(canAccessLevel({ ...user, id: 'other-user' }, ACCESS.INTAKE)).toBe(false);
    clearTrustedTenantContext();
    expect(canAccessLevel(user, ACCESS.INTAKE)).toBe(false);
  });
  it('keeps the route, sidebar and palette available without making office staff administrators', () => {
    const bound = bindRole('office_staff');
    const route = ROUTES.find(({ name }) => name === 'ReferralIntake');
    expect(route).toMatchObject({ adminOnly: false, access: ACCESS.INTAKE });
    expect(getRoleView(bound)).toBe('nurse');
    expect(isPageAllowedForRole('SuperAdminConfig', getRoleView(bound), bound)).toBe(false);
    expect(buildNavCategories(NAV_MANIFEST, bound).flatMap(({ items }) => items).some(({ page }) => page === 'ReferralIntake')).toBe(true);
    expect(buildPaletteEntries(NAV_MANIFEST, false, false, bound).some(({ page }) => page === 'ReferralIntake')).toBe(true);
  });
});