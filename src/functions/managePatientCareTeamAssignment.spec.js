import { beforeEach, describe, expect, it, vi } from 'vitest';

const invoke = vi.fn();
vi.mock('@/api/base44Client', () => ({
  base44: { functions: { invoke: (...args) => invoke(...args) } },
}));

import {
  createCareTeamAssignmentRequestId,
  managePatientCareTeamAssignment,
} from './managePatientCareTeamAssignment';

const T1 = '2026-09-03T12:00:00.000Z';
const T2 = '2026-09-03T12:01:00.000Z';

function response({
  action = 'inspect',
  status = 'active',
  version = 1,
  idempotent = true,
  assignment = {},
  scope = {},
} = {}) {
  return {
    data: {
      success: true,
      action,
      idempotent,
      assignment: {
        id: 'assignment-1',
        agency_id: 'agency-1',
        patient_id: 'patient-1',
        user_id: 'user-1',
        status,
        version,
        activated_at: T1,
        suspended_at: status === 'suspended' ? T2 : null,
        revoked_at: status === 'revoked' ? T2 : null,
        last_transition_at: T2,
        ...assignment,
      },
      scope: {
        agency_id: 'agency-1',
        membership_id: null,
        membership_version: null,
        tenant_role: 'platform_owner',
        ...scope,
      },
    },
  };
}

const baseOptions = (overrides = {}) => ({
  action: 'inspect',
  agencyId: 'agency-1',
  patientId: 'patient-1',
  targetUserId: 'user-1',
  ...overrides,
});

describe('managePatientCareTeamAssignment wrapper', () => {
  beforeEach(() => invoke.mockReset());

  it('invokes an exact inspect request and returns only the narrow projection', async () => {
    invoke.mockResolvedValueOnce(response());

    const result = await managePatientCareTeamAssignment(baseOptions());

    expect(invoke).toHaveBeenCalledWith('managePatientCareTeamAssignment', {
      action: 'inspect',
      agency_id: 'agency-1',
      patient_id: 'patient-1',
      target_user_id: 'user-1',
    });
    expect(result.assignment).toEqual(response().data.assignment);
    expect(result.assignment.user_email_normalized).toBeUndefined();
  });

  it('builds finite grant and transition payloads without email or authority selectors', async () => {
    invoke
      .mockResolvedValueOnce(response({ action: 'grant', idempotent: false }))
      .mockResolvedValueOnce(response({
        action: 'suspend', status: 'suspended', version: 2, idempotent: false,
        scope: {
          membership_id: 'membership-manager',
          membership_version: 4,
          tenant_role: 'manager',
        },
      }));

    await managePatientCareTeamAssignment(baseOptions({
      action: 'grant', clientRequestId: 'request-1', reason: 'Assign for episode',
    }));
    await managePatientCareTeamAssignment(baseOptions({
      action: 'suspend', clientRequestId: 'request-2', reason: 'Coverage ended',
      expectedVersion: 1,
    }));

    expect(invoke.mock.calls.map((call) => call[1])).toEqual([
      {
        action: 'grant',
        agency_id: 'agency-1',
        patient_id: 'patient-1',
        target_user_id: 'user-1',
        client_request_id: 'request-1',
        reason: 'Assign for episode',
      },
      {
        action: 'suspend',
        agency_id: 'agency-1',
        patient_id: 'patient-1',
        target_user_id: 'user-1',
        client_request_id: 'request-2',
        expected_version: 1,
        reason: 'Coverage ended',
      },
    ]);
  });

  it('generates an opaque mutation retry id when one is omitted', async () => {
    invoke.mockResolvedValueOnce(response({ action: 'grant', idempotent: false }));
    await managePatientCareTeamAssignment(baseOptions({
      action: 'grant', reason: 'Assign for episode',
    }));
    const requestId = invoke.mock.calls[0][1].client_request_id;
    expect(typeof requestId).toBe('string');
    expect(requestId.length).toBeGreaterThan(0);
    expect(createCareTeamAssignmentRequestId()).toEqual(expect.any(String));
  });

  it('rejects unsupported selectors and malformed values before invocation', async () => {
    for (const options of [
      null,
      baseOptions({ action: 'delete' }),
      baseOptions({ agencyId: { $ne: null } }),
      baseOptions({ patientId: ' patient-1' }),
      baseOptions({ targetUserEmail: 'user@example.test' }),
      baseOptions({ source: 'manual' }),
      baseOptions({ status: 'active' }),
      baseOptions({ tenantRole: 'manager' }),
      baseOptions({ action: 'grant', reason: '' }),
      baseOptions({ action: 'grant', reason: 'Assign', expectedVersion: 1 }),
      baseOptions({ action: 'suspend', reason: 'Pause', expectedVersion: 0 }),
      baseOptions({ action: 'inspect', reason: 'Not accepted' }),
    ]) {
      await expect(managePatientCareTeamAssignment(options)).rejects.toThrow();
    }
    expect(invoke).not.toHaveBeenCalled();
  });

  it('supports an explicit function client without placing it in the wire payload', async () => {
    const localInvoke = vi.fn().mockResolvedValue(response());
    await managePatientCareTeamAssignment(baseOptions({
      functions: { invoke: localInvoke },
    }));
    expect(localInvoke).toHaveBeenCalledTimes(1);
    expect(localInvoke.mock.calls[0][1]).not.toHaveProperty('functions');
    expect(invoke).not.toHaveBeenCalled();
  });

  it('fails closed on false-success, mismatched, PHI-expanded, or invalid scope responses', async () => {
    const invalid = [
      { data: { success: false, error: 'denied' } },
      response({ assignment: { patient_id: 'other-patient' } }),
      response({ assignment: { user_email_normalized: 'user@example.test' } }),
      response({ assignment: { version: 1.5 } }),
      response({ assignment: { last_transition_at: 'not-an-instant' } }),
      response({ status: 'suspended', assignment: { suspended_at: null } }),
      response({ status: 'revoked', assignment: { revoked_at: null } }),
      response({ scope: { agency_id: 'other-agency' } }),
      response({ scope: { membership_id: 'unexpected' } }),
      response({ scope: {
        tenant_role: 'manager', membership_id: null, membership_version: null,
      } }),
    ];
    for (const value of invalid) {
      invoke.mockResolvedValueOnce(value);
      await expect(managePatientCareTeamAssignment(baseOptions())).rejects.toThrow();
    }
  });

  it('requires mutation responses to reflect the requested lifecycle state', async () => {
    invoke.mockResolvedValueOnce(response({ action: 'revoke', status: 'active' }));
    await expect(managePatientCareTeamAssignment(baseOptions({
      action: 'revoke', clientRequestId: 'request-3', reason: 'End access',
      expectedVersion: 1,
    }))).rejects.toThrow(/integrity/);

    invoke.mockResolvedValueOnce(response({
      action: 'suspend', status: 'suspended', version: 3,
    }));
    await expect(managePatientCareTeamAssignment(baseOptions({
      action: 'suspend', clientRequestId: 'request-4', reason: 'Pause access',
      expectedVersion: 1,
    }))).rejects.toThrow(/integrity/);

    invoke.mockResolvedValueOnce(response({ action: 'grant', version: 2 }));
    await expect(managePatientCareTeamAssignment(baseOptions({
      action: 'grant', clientRequestId: 'request-5', reason: 'Assign access',
    }))).rejects.toThrow(/integrity/);
  });
});
