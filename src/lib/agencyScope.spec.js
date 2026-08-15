import { describe, it, expect } from 'vitest';
import {
  isCallerAgencyScoped,
  filterUsersByCallerAgency,
  filterPatientsByCallerAgency,
  describePatientAgencyScope,
  agencyStaffEmails,
} from './agencyScope.js';

describe('agencyScope', () => {
  const users = [
    { email: 'a@x.com', agency_name: 'Acme' },
    { email: 'b@x.com', agency_name: 'Other' },
    { email: 'c@x.com', agency_name: 'Acme' },
  ];
  const acmeAdmin = { role: 'admin', agency_name: 'Acme' };

  it('treats role:admin + agency as scoped', () => {
    expect(isCallerAgencyScoped({ role: 'admin', agency_name: 'Acme' })).toBe(true);
    expect(isCallerAgencyScoped({ role: 'admin' })).toBe(false);
    expect(isCallerAgencyScoped({ account_type: 'super_admin', agency_name: 'Acme' })).toBe(false);
  });

  it('filters users to caller agency', () => {
    const out = filterUsersByCallerAgency(users, acmeAdmin);
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
    const out = filterPatientsByCallerAgency(patients, users, acmeAdmin);
    expect(out.map((p) => p.id)).toEqual(['1', '3']);
    expect(agencyStaffEmails(users, acmeAdmin).has('a@x.com')).toBe(true);
  });

  it('fails closed for patients when caller is missing', () => {
    expect(filterPatientsByCallerAgency([{ id: '1' }], users, null)).toEqual([]);
  });

  describe('unattributable charts', () => {
    // The production shape this rule exists for: charts created by a Base44
    // service account, which is not a User and therefore can never appear in any
    // agency's staff list. A strict staff-only rule hides every one of them the
    // moment the first agency_name is assigned.
    const imported = [
      { id: 'svc-1', created_by: 'service+abc@no-reply.base44.com' },
      { id: 'svc-2', created_by: 'service+abc@no-reply.base44.com', assigned_nurses: [] },
      { id: 'gone', created_by: 'departed@x.com' }, // author no longer in the roster
      { id: 'bare' }, // no created_by at all
    ];

    it('keeps charts with no resolvable author visible', () => {
      const out = filterPatientsByCallerAgency(imported, users, acmeAdmin);
      expect(out.map((p) => p.id)).toEqual(['svc-1', 'svc-2', 'gone', 'bare']);
    });

    it('still hides charts authored by a known user in another agency', () => {
      const mixed = [...imported, { id: 'theirs', created_by: 'b@x.com' }];
      const out = filterPatientsByCallerAgency(mixed, users, acmeAdmin);
      expect(out.map((p) => p.id)).not.toContain('theirs');
    });

    it('does not empty the roster when the user list fails to load', () => {
      // Call sites pass [] on a User.list failure. Under a staff-only rule that
      // silently hides every chart; here it degrades to "nothing attributable".
      const out = filterPatientsByCallerAgency(imported, [], acmeAdmin);
      expect(out).toHaveLength(imported.length);
    });
  });

  describe('explicit chart tenancy', () => {
    it('matches on agency_name when the chart carries one', () => {
      const patients = [
        { id: 'ours', agency_name: 'Acme', created_by: 'b@x.com' },
        { id: 'theirs', agency_name: 'Other', created_by: 'a@x.com' },
      ];
      const out = filterPatientsByCallerAgency(patients, users, acmeAdmin);
      // The chart's own tag wins over who happened to author it, in both directions.
      expect(out.map((p) => p.id)).toEqual(['ours']);
    });

    it('prefers agency_id when both sides carry one', () => {
      const caller = { role: 'admin', agency_name: 'Acme', agency_id: 'ag_1' };
      const patients = [
        { id: 'ours', agency_id: 'ag_1', agency_name: 'Renamed Acme' },
        { id: 'theirs', agency_id: 'ag_2', agency_name: 'Acme' },
      ];
      const out = filterPatientsByCallerAgency(patients, users, caller);
      expect(out.map((p) => p.id)).toEqual(['ours']);
    });

    it('falls back to staff attribution when the tag is not comparable', () => {
      // Chart tagged by id, caller known only by name: not comparable, so the
      // author decides rather than the filter guessing.
      const patients = [
        { id: 'ours', agency_id: 'ag_1', created_by: 'a@x.com' },
        { id: 'theirs', agency_id: 'ag_1', created_by: 'b@x.com' },
      ];
      const out = filterPatientsByCallerAgency(patients, users, acmeAdmin);
      expect(out.map((p) => p.id)).toEqual(['ours']);
    });
  });

  describe('describePatientAgencyScope', () => {
    it('counts visible, hidden and unattributable charts', () => {
      const patients = [
        { id: '1', created_by: 'a@x.com' },
        { id: '2', created_by: 'b@x.com' },
        { id: '3', created_by: 'service+abc@no-reply.base44.com' },
        { id: '4' },
      ];
      expect(describePatientAgencyScope(patients, users, acmeAdmin)).toEqual({
        scoped: true, total: 4, visible: 3, hidden: 1, unattributable: 2,
      });
    });

    it('reports platform admins as unscoped', () => {
      const patients = [{ id: '1' }, { id: '2' }];
      expect(describePatientAgencyScope(patients, users, { role: 'admin' })).toEqual({
        scoped: false, total: 2, visible: 2, hidden: 0, unattributable: 0,
      });
    });

    it('reports a missing caller as everything hidden', () => {
      expect(describePatientAgencyScope([{ id: '1' }], users, null)).toEqual({
        scoped: false, total: 1, visible: 0, hidden: 1, unattributable: 0,
      });
    });

    it('agrees with the filter it describes', () => {
      const patients = [
        { id: '1', created_by: 'a@x.com' },
        { id: '2', created_by: 'b@x.com' },
        { id: '3', agency_name: 'Other' },
        { id: '4', created_by: 'nobody@x.com' },
      ];
      const summary = describePatientAgencyScope(patients, users, acmeAdmin);
      const filtered = filterPatientsByCallerAgency(patients, users, acmeAdmin);
      expect(filtered).toHaveLength(summary.visible);
    });
  });

  it('handles non-array input without throwing', () => {
    expect(filterPatientsByCallerAgency(null, users, acmeAdmin)).toEqual([]);
    expect(filterUsersByCallerAgency(null, acmeAdmin)).toEqual([]);
    expect(describePatientAgencyScope(null, users, acmeAdmin).total).toBe(0);
  });
});
