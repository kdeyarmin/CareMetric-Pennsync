import { afterEach, describe, expect, it } from 'vitest';
import { bindTrustedTenantContext, clearTrustedTenantContext } from '@/lib/roles';
import { staffMiddleNav } from './mobileStaffNav';

const contextFor = (user, tenantRole) => ({
  user_id: user.id,
  user_email: user.email.toLowerCase(),
  membership_id: 'membership-a',
  membership_key: `agency-a:${user.id}`,
  membership_version: 2,
  agency_id: 'agency-a',
  membership_status: 'active',
  tenant_role: tenantRole,
  is_platform_owner: false,
  agency: { id: 'agency-a', name: 'Agency A', status: 'active' },
});

afterEach(() => {
  clearTrustedTenantContext();
});

describe('staff middle mobile tabs', () => {
  it('keeps charting for a nurse', () => {
    expect(staffMiddleNav({ role: 'user', staff_role: 'nurse' })).toEqual([
      'Patients',
      'SmartNoteAssistant',
    ]);
  });

  it('keeps Notes when a charting manager also opens referrals', () => {
    const manager = { id: 'mgr-1', email: 'manager@agency.test', role: 'user', staff_role: 'nurse' };
    bindTrustedTenantContext(manager, contextFor(manager, 'manager'));
    expect(staffMiddleNav(manager)).toEqual(['ReferralIntake', 'SmartNoteAssistant']);
  });

  it('puts referrals ahead of learning for office staff', () => {
    const clerk = { id: 'clerk-1', email: 'clerk@agency.test', role: 'user', staff_role: 'office_staff' };
    bindTrustedTenantContext(clerk, contextFor(clerk, 'office_staff'));
    expect(staffMiddleNav(clerk)).toEqual(['ReferralIntake', 'LearningCenter']);
  });
});
