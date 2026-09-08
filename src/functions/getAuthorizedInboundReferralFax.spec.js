import { beforeEach, describe, expect, it, vi } from 'vitest';

const { invoke } = vi.hoisted(() => ({ invoke: vi.fn() }));

vi.mock('@/api/base44Client', () => ({
  base44: { functions: { invoke } },
}));

import { getAuthorizedInboundReferralFax } from './getAuthorizedInboundReferralFax';

const validResult = (overrides = {}) => ({
  success: true,
  referral_id: 'referral-a',
  incoming_fax_id: 'incoming-a',
  delivery: { download_url: 'https://media.telnyx.test/incoming-a.pdf' },
  scope: {
    agency_id: 'agency-a',
    membership_id: 'membership-a',
    membership_version: 1,
    tenant_role: 'office_staff',
  },
  ...overrides,
});

describe('getAuthorizedInboundReferralFax browser wrapper', () => {
  beforeEach(() => invoke.mockReset());

  it('sends only exact tenant, referral, and fax identifiers', async () => {
    invoke.mockResolvedValue({ data: validResult() });
    const result = await getAuthorizedInboundReferralFax({
      agencyId: 'agency-a',
      referralId: 'referral-a',
      incomingFaxId: 'incoming-a',
    });
    expect(invoke).toHaveBeenCalledWith('getAuthorizedInboundReferralFax', {
      agency_id: 'agency-a',
      referral_id: 'referral-a',
      incoming_fax_id: 'incoming-a',
    });
    expect(result.delivery.download_url).toBe('https://media.telnyx.test/incoming-a.pdf');
  });

  it.each([
    validResult({ referral_id: 'referral-b' }),
    validResult({ incoming_fax_id: 'incoming-b' }),
    validResult({ delivery: { download_url: 'http://media.telnyx.test/incoming-a.pdf' } }),
    validResult({ delivery: { download_url: 'https://media.telnyx.test/incoming-a.pdf#secret' } }),
    validResult({ scope: { ...validResult().scope, agency_id: 'agency-b' } }),
    { ...validResult(), unexpected: true },
  ])('rejects a drifted or over-broad broker response', async (response) => {
    invoke.mockResolvedValue(response);
    await expect(getAuthorizedInboundReferralFax({
      agencyId: 'agency-a',
      referralId: 'referral-a',
      incomingFaxId: 'incoming-a',
    })).rejects.toThrow('Referral fax lookup failed');
  });

  it('rejects unsupported or operator-like identifiers before invocation', async () => {
    await expect(getAuthorizedInboundReferralFax({
      agencyId: '$ne',
      referralId: 'referral-a',
      incomingFaxId: 'incoming-a',
    })).rejects.toThrow('identifiers are invalid');
    await expect(getAuthorizedInboundReferralFax({
      agencyId: 'agency-a',
      referralId: 'referral-a',
      incomingFaxId: 'incoming-a',
      extra: true,
    })).rejects.toThrow('options are invalid');
    expect(invoke).not.toHaveBeenCalled();
  });
});
