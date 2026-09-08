import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  bindTrustedTenantContext,
  clearTrustedTenantContext,
} from './roles.js';
import {
  isCallerAgencyScoped,
  filterUsersByCallerAgency,
  filterPatientsByCallerAgency,
  describePatientAgencyScope,
  filterRowsByStaffAgency,
  filterRecordsByAuthorAgency,
  agencyStaffEmails,
} from './agencyScope.js';

const acmeCaller = {
  id: 'caller-acme',
  email: 'admin@acme.test',
  role: 'admin',
  agency_id: 'mutable-other',
  agency_name: 'Mutable Other',
};

const ownerCaller = {
  id: 'platform-owner',
  email: 'owner@example.test',
  role: 'admin',
};

function regularContext(user, {
  agencyId = 'ag_acme',
  agencyName = 'Acme',
  membershipId = 'membership-acme',
  membershipVersion = 2,
  tenantRole = 'agency_admin',
} = {}) {
  return {
    user_id: user.id,
    user_email: user.email.toLowerCase(),
    membership_id: membershipId,
    membership_key: `${agencyId}:${user.id}`,
    membership_version: membershipVersion,
    agency_id: agencyId,
    membership_status: 'active',
    tenant_role: tenantRole,
    is_platform_owner: false,
    agency: { id: agencyId, name: agencyName, status: 'active' },
  };
}

function bindRegular(user = acmeCaller, options) {
  bindTrustedTenantContext(user, regularContext(user, options));
  return user;
}

function bindOwner(user = ownerCaller) {
  bindTrustedTenantContext(user, {
    user_id: user.id,
    user_email: user.email.toLowerCase(),
    membership_id: null,
    membership_key: null,
    membership_version: null,
    agency_id: null,
    membership_status: null,
    tenant_role: 'platform_owner',
    is_platform_owner: true,
    agency: null,
  });
  return user;
}

describe('agencyScope', () => {
  const users = [
    { email: 'a@x.com', agency_id: 'ag_acme', agency_name: 'Acme' },
    { email: 'b@x.com', agency_id: 'ag_other', agency_name: 'Other' },
    { email: 'c@x.com', agency_name: 'Acme' },
  ];

  beforeEach(() => bindRegular());
  afterEach(() => clearTrustedTenantContext());

  it('recognizes only an exact trusted regular-tenant binding as agency scoped', () => {
    expect(isCallerAgencyScoped(acmeCaller)).toBe(true);
    expect(isCallerAgencyScoped({ ...acmeCaller, id: 'stale-principal' })).toBe(false);
    expect(isCallerAgencyScoped({ role: 'admin', agency_name: 'Acme' })).toBe(false);
    expect(isCallerAgencyScoped(bindOwner())).toBe(false);
  });

  it('filters users to the trusted agency by id, then canonical name for legacy rows', () => {
    const out = filterUsersByCallerAgency(users, acmeCaller);
    expect(out.map((user) => user.email)).toEqual(['a@x.com', 'c@x.com']);
  });

  it('ignores mutable User fields that try to widen or switch the trusted scope', () => {
    const spoofed = {
      ...acmeCaller,
      role: 'admin',
      account_type: 'super_admin',
      agency_id: 'ag_other',
      agency_name: 'Other',
    };
    expect(filterUsersByCallerAgency(users, spoofed).map((user) => user.email))
      .toEqual(['a@x.com', 'c@x.com']);
  });

  it('applies the trusted scope independent of mutable role labels', () => {
    const refetchedCaller = { ...acmeCaller, role: 'user', account_type: 'agency_admin' };
    expect(filterUsersByCallerAgency(users, refetchedCaller).map((user) => user.email))
      .toEqual(['a@x.com', 'c@x.com']);
  });

  it('fails closed without an exact live principal binding', () => {
    expect(filterUsersByCallerAgency(users, null)).toEqual([]);
    expect(filterUsersByCallerAgency(users, undefined)).toEqual([]);
    expect(filterUsersByCallerAgency(users, { role: 'admin' })).toEqual([]);
    expect(filterUsersByCallerAgency(users, { account_type: 'super_admin' })).toEqual([]);
    expect(filterUsersByCallerAgency(users, { ...acmeCaller, email: 'other@acme.test' })).toEqual([]);

    clearTrustedTenantContext();
    expect(filterUsersByCallerAgency(users, acmeCaller)).toEqual([]);
  });

  it('fails closed for a membership-free owner without an agency selection', () => {
    const owner = bindOwner();
    expect(filterUsersByCallerAgency(users, owner)).toEqual([]);
  });

  it('filters patients by agency staff emails', () => {
    const patients = [
      { id: '1', created_by: 'a@x.com' },
      { id: '2', created_by: 'b@x.com' },
      { id: '3', assigned_nurses: ['c@x.com'] },
    ];
    const out = filterPatientsByCallerAgency(patients, users, acmeCaller);
    expect(out.map((patient) => patient.id)).toEqual(['1', '3']);
    expect(agencyStaffEmails(users, acmeCaller).has('a@x.com')).toBe(true);
  });

  it('fails closed for patients when the trusted context is absent or stale', () => {
    expect(filterPatientsByCallerAgency(
      [{ id: '1' }],
      users,
      { ...acmeCaller, id: 'old-account' },
    )).toEqual([]);
    clearTrustedTenantContext();
    expect(filterPatientsByCallerAgency([{ id: '1' }], users, acmeCaller)).toEqual([]);
  });

  describe('unattributable charts', () => {
    const imported = [
      { id: 'svc-1', created_by: 'service+abc@no-reply.base44.com' },
      { id: 'svc-2', created_by: 'service+abc@no-reply.base44.com', assigned_nurses: [] },
      { id: 'gone', created_by: 'departed@x.com' },
      { id: 'bare' },
    ];

    it('keeps charts with no resolvable author visible within the trusted tenant', () => {
      const out = filterPatientsByCallerAgency(imported, users, acmeCaller);
      expect(out.map((patient) => patient.id)).toEqual(['svc-1', 'svc-2', 'gone', 'bare']);
    });

    it('still hides charts authored by a known user in another agency', () => {
      const mixed = [...imported, { id: 'theirs', created_by: 'b@x.com' }];
      const out = filterPatientsByCallerAgency(mixed, users, acmeCaller);
      expect(out.map((patient) => patient.id)).not.toContain('theirs');
    });

    it('does not empty the trusted tenant view when the roster fails to load', () => {
      expect(filterPatientsByCallerAgency(imported, [], acmeCaller)).toHaveLength(imported.length);
    });
  });

  describe('explicit chart tenancy', () => {
    it('uses the trusted canonical agency name for legacy name-only tags', () => {
      const patients = [
        { id: 'ours', agency_name: 'Acme', created_by: 'b@x.com' },
        { id: 'theirs', agency_name: 'Other', created_by: 'a@x.com' },
      ];
      expect(filterPatientsByCallerAgency(patients, users, acmeCaller).map((patient) => patient.id))
        .toEqual(['ours']);
    });

    it('prefers the trusted agency id when the row carries one', () => {
      const patients = [
        { id: 'ours', agency_id: 'ag_acme', agency_name: 'Renamed Acme' },
        { id: 'theirs', agency_id: 'ag_other', agency_name: 'Acme' },
      ];
      expect(filterPatientsByCallerAgency(patients, users, acmeCaller).map((patient) => patient.id))
        .toEqual(['ours']);
    });
  });

  describe('describePatientAgencyScope', () => {
    const patients = [
      { id: '1', created_by: 'a@x.com' },
      { id: '2', created_by: 'b@x.com' },
      { id: '3', created_by: 'service+abc@no-reply.base44.com' },
      { id: '4' },
    ];

    it('counts visible, hidden and unattributable charts for a trusted tenant', () => {
      expect(describePatientAgencyScope(patients, users, acmeCaller)).toEqual({
        scoped: true, total: 4, visible: 3, hidden: 1, unattributable: 2,
      });
    });

    it('reports a membership-free platform owner as fully hidden', () => {
      expect(describePatientAgencyScope(patients, users, bindOwner())).toEqual({
        scoped: false, total: 4, visible: 0, hidden: 4, unattributable: 0,
      });
    });

    it('reports missing trusted authority as everything hidden', () => {
      clearTrustedTenantContext();
      expect(describePatientAgencyScope([{ id: '1' }], users, acmeCaller)).toEqual({
        scoped: false, total: 1, visible: 0, hidden: 1, unattributable: 0,
      });
    });

    it('agrees with the filter it describes', () => {
      const summary = describePatientAgencyScope(patients, users, acmeCaller);
      expect(filterPatientsByCallerAgency(patients, users, acmeCaller))
        .toHaveLength(summary.visible);
    });
  });

  describe('filterRowsByStaffAgency', () => {
    const timesheets = [
      { id: 'ours', employee_email: 'a@x.com' },
      { id: 'theirs', employee_email: 'b@x.com' },
      { id: 'ours2', employee_email: 'c@x.com' },
      { id: 'orphan', employee_email: 'gone@x.com' },
    ];
    const emailOf = (row) => row.employee_email;

    it('keeps only rows owned by same-agency staff', () => {
      expect(filterRowsByStaffAgency(timesheets, users, acmeCaller, emailOf).map((row) => row.id))
        .toEqual(['ours', 'ours2']);
    });

    it('fails closed for raw admin/owner labels and absent context', () => {
      expect(filterRowsByStaffAgency(timesheets, users, { role: 'admin' }, emailOf)).toEqual([]);
      expect(filterRowsByStaffAgency(
        timesheets,
        users,
        { account_type: 'super_admin', agency_name: 'Acme' },
        emailOf,
      )).toEqual([]);
      clearTrustedTenantContext();
      expect(filterRowsByStaffAgency(timesheets, users, acmeCaller, emailOf)).toEqual([]);
    });

    it('fails closed for a membership-free platform owner', () => {
      expect(filterRowsByStaffAgency(timesheets, users, bindOwner(), emailOf)).toEqual([]);
    });

    it('drops rows whose owner is not a known current user', () => {
      expect(filterRowsByStaffAgency(timesheets, users, acmeCaller, emailOf).map((row) => row.id))
        .not.toContain('orphan');
    });

    it('handles non-array rows', () => {
      expect(filterRowsByStaffAgency(null, users, acmeCaller, emailOf)).toEqual([]);
    });
  });

  describe('filterRecordsByAuthorAgency', () => {
    const visits = [
      { id: 'ours', created_by: 'a@x.com' },
      { id: 'theirs', created_by: 'b@x.com' },
      { id: 'departed', created_by: 'departed@x.com' },
      { id: 'bare' },
    ];

    it('hides only records authored by another agency', () => {
      expect(filterRecordsByAuthorAgency(visits, users, acmeCaller).map((row) => row.id))
        .toEqual(['ours', 'departed', 'bare']);
    });

    it('keeps departed-author records while the strict payroll rule drops them', () => {
      expect(filterRecordsByAuthorAgency(visits, users, acmeCaller).map((row) => row.id))
        .toContain('departed');
      expect(filterRowsByStaffAgency(visits, users, acmeCaller, (row) => row.created_by)
        .map((row) => row.id)).not.toContain('departed');
    });

    it('honours explicit tenant tags and a custom author field', () => {
      const tagged = [
        { id: 'ours', agency_id: 'ag_acme', created_by: 'b@x.com' },
        { id: 'theirs', agency_id: 'ag_other', created_by: 'a@x.com' },
      ];
      expect(filterRecordsByAuthorAgency(tagged, users, acmeCaller).map((row) => row.id))
        .toEqual(['ours']);

      const documents = [
        { id: 'ours', uploaded_by: 'a@x.com' },
        { id: 'theirs', uploaded_by: 'b@x.com' },
      ];
      expect(filterRecordsByAuthorAgency(
        documents,
        users,
        acmeCaller,
        (document) => document.uploaded_by,
      ).map((row) => row.id)).toEqual(['ours']);
    });

    it('fails closed without exact trusted authority', () => {
      expect(filterRecordsByAuthorAgency(visits, users, null)).toEqual([]);
      expect(filterRecordsByAuthorAgency(visits, users, { account_type: 'agency_admin' }))
        .toEqual([]);
      clearTrustedTenantContext();
      expect(filterRecordsByAuthorAgency(visits, users, acmeCaller)).toEqual([]);
    });

    it('fails closed for a membership-free platform owner', () => {
      expect(filterRecordsByAuthorAgency(visits, users, bindOwner())).toEqual([]);
    });

    it('does not empty the trusted tenant view when the roster fails to load', () => {
      expect(filterRecordsByAuthorAgency(visits, [], acmeCaller)).toHaveLength(4);
    });

    it('handles non-array rows', () => {
      expect(filterRecordsByAuthorAgency(null, users, acmeCaller)).toEqual([]);
    });
  });

  it('handles non-array inputs without throwing', () => {
    expect(filterPatientsByCallerAgency(null, users, acmeCaller)).toEqual([]);
    expect(filterUsersByCallerAgency(null, acmeCaller)).toEqual([]);
    expect(describePatientAgencyScope(null, users, acmeCaller).total).toBe(0);
  });
});
