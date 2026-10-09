import { beforeEach, describe, expect, it, vi } from 'vitest';

const { invoke } = vi.hoisted(() => ({ invoke: vi.fn() }));
vi.mock('@/api/base44Client', () => ({
  base44: { functions: { invoke } },
}));

import { acceptAiContentAgreement } from './acceptAiContentAgreement';

describe('acceptAiContentAgreement', () => {
  beforeEach(() => invoke.mockReset());

  it('forwards the exact agreement payload and preserves the invoke envelope', async () => {
    const payload = { agreement_version: '1.0', agreement_text: 'Acknowledgment', accepted: true };
    const response = { data: { success: true, agreement_version: '1.0' } };
    invoke.mockResolvedValue(response);
    await expect(acceptAiContentAgreement(payload)).resolves.toBe(response);
    expect(invoke).toHaveBeenCalledExactlyOnceWith('acceptAiContentAgreement', payload);
    expect(invoke.mock.calls[0][1]).toBe(payload);
  });

  it('accepts an unwrapped successful response', async () => {
    const response = { success: true, agreement_version: '1.0' };
    invoke.mockResolvedValue(response);
    await expect(acceptAiContentAgreement({ agreement_version: '1.0' })).resolves.toBe(response);
  });

  it.each([
    null,
    { data: { success: false, agreement_version: '1.0' } },
    { data: { success: true, agreement_version: '0.9' } },
    { data: { success: 'true', agreement_version: '1.0' } },
  ])('refuses an unconfirmed or mismatched acknowledgment', async response => {
    invoke.mockResolvedValue(response);
    await expect(acceptAiContentAgreement({ agreement_version: '1.0' })).rejects.toThrow(/could not be confirmed/i);
  });
});
