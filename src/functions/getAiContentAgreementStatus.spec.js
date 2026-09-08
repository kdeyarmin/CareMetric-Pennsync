import { beforeEach, describe, expect, it, vi } from 'vitest';

const invoke = vi.fn();
vi.mock('@/api/base44Client', () => ({
  base44: { functions: { invoke: (...args) => invoke(...args) } },
}));

import { getAiContentAgreementStatus } from './getAiContentAgreementStatus';

describe('getAiContentAgreementStatus', () => {
  beforeEach(() => invoke.mockReset());

  it('unwraps the Base44 invoke envelope', async () => {
    invoke.mockResolvedValue({
      data: { accepted: true, agreement_version: '1.0' },
    });
    await expect(getAiContentAgreementStatus()).resolves.toEqual({
      accepted: true,
      agreement_version: '1.0',
    });
    expect(invoke).toHaveBeenCalledWith('getAiContentAgreementStatus', {});
  });

  it('accepts an already-unwrapped SDK response', async () => {
    invoke.mockResolvedValue({ accepted: false, agreement_version: '1.0' });
    await expect(getAiContentAgreementStatus()).resolves.toEqual({
      accepted: false,
      agreement_version: '1.0',
    });
  });

  it.each([
    null,
    { data: null },
    { data: { accepted: 'yes', agreement_version: '1.0' } },
    { data: { accepted: true, agreement_version: '1.0', user_email: 'leak@example.test' } },
  ])('fails closed for malformed or over-broad responses', async (response) => {
    invoke.mockResolvedValue(response);
    await expect(getAiContentAgreementStatus()).rejects.toThrow(/invalid response/i);
  });
});
