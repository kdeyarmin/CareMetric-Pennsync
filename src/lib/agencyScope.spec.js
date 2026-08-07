import { describe, it, expect } from 'vitest';
import {
  isCallerAgencyScoped,
  filterUsersByCallerAgency,
  filterPatientsByCallerAgency,
  agencyStaffEmails,
} from './agencyScope.js';

describe('agencyScope', () => {
  const users = [
    { email: 'a@x.com', agency_name: 'Acme' },
    { email: 'b@x.com', agency_name: 'Other' },
    { email: 'c@x.com', agency_name: 'Acme' },
  ];

  it('treats role:admin + agency as scoped', () => {
    expect(isCallerAgencyScoped({ role: 'admin', agency_name: 'Acme' })).toBe(true);
    expect(isCallerAgencyScoped({ role: 'admin' })).toBe(false);
    expect(isCallerAgencyScoped({ account_type: 'super_admin', agency_name: 'Acme' })).toBe(false);
  });

  it('filters users to caller agency', () => {
    const out = filterUsersByCallerAgency(users, { role: 'admin', agency_name: 'Acme' });
    expect(out.map((u) => u.email)).toEqual(['a@x.com', 'c@x.com']);
  });

  it('filters nurses with an agency the same way', () => {
    const out = filterUsersByCallerAgency(users, { role: 'user', agency_name: 'Acme' });
    expect(out.map((u) => u.email)).toEqual(['a@x.com', 'c@x.com']);
  });

  it('fails closed for agency_admin without agency', () => {
    expect(filterUsersByCallerAgency(users, { account_type: 'agency_admin' })).toEqual([]);
  });

  it('fails closed when caller is missing (auth loading)', () => {
    expect(filterUsersByCallerAgency(users, null)).toEqual([]);
    expect(filterUsersByCallerAgency(users, undefined)).toEqual([]);
  });

  it('leaves platform admin unfiltered', () => {
    expect(filterUsersByCallerAgency(users, { role: 'admin' })).toHaveLength(3);
  });

  it('leaves super_admin unfiltered even with agency_name', () => {
    expect(filterUsersByCallerAgency(users, {
      account_type: 'super_admin',
      agency_name: 'Acme',
    })).toHaveLength(3);
  });

  it('filters patients by agency staff emails', () => {
    const patients = [
      { id: '1', created_by: 'a@x.com' },
      { id: '2', created_by: 'b@x.com' },
      { id: '3', assigned_nurses: ['c@x.com'] },
    ];
    const out = filterPatientsByCallerAgency(
      patients,
      users,
      { role: 'admin', agency_name: 'Acme' },
    );
    expect(out.map((p) => p.id)).toEqual(['1', '3']);
    expect(agencyStaffEmails(users, { role: 'admin', agency_name: 'Acme' }).has('a@x.com')).toBe(true);
  });

  it('fails closed for patients when caller is missing', () => {
    expect(filterPatientsByCallerAgency([{ id: '1' }], users, null)).toEqual([]);
  });
});
