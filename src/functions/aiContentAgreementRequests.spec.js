import { afterEach, describe, expect, it, vi } from 'vitest';
import { acceptAiContentAgreement } from '@/functions/acceptAiContentAgreement';
import { getAiContentAgreementStatus } from '@/functions/getAiContentAgreementStatus';

const { invoke } = vi.hoisted(() => ({ invoke: vi.fn() }));
vi.mock('@/api/base44Client', () => ({ base44: { functions: { invoke } } }));

afterEach(() => {
  vi.useRealTimers();
  invoke.mockReset();
});

describe('AI agreement request recovery', () => {
  it('preserves the recording response', async () => {
    const response = { data: { success: true, agreement_version: '1.0' } };
    invoke.mockResolvedValue(response);
    const payload = { accepted: true, agreement_version: '1.0' };
    expect(await acceptAiContentAgreement(payload)).toEqual(response);
    expect(invoke).toHaveBeenCalledWith('acceptAiContentAgreement', payload);
  });

  it('returns acceptance only from the protected status response', async () => {
    invoke.mockResolvedValue({ data: { accepted: true, agreement_version: '1.0' } });
    expect(await getAiContentAgreementStatus()).toEqual({ accepted: true, agreement_version: '1.0' });
  });

  it.each([
    ['recording', () => acceptAiContentAgreement({ accepted: true, agreement_version: '1.0' })],
    ['verification', () => getAiContentAgreementStatus()],
  ])('rejects stalled %s instead of waiting forever', async (_phase, request) => {
    vi.useFakeTimers();
    invoke.mockImplementation(() => new Promise(() => {}));
    const rejection = expect(request()).rejects.toThrow(/timed out/i);
    await vi.advanceTimersByTimeAsync(30000);
    await rejection;
    expect(vi.getTimerCount()).toBe(0);
  });

  it('does not treat an unsuccessful recording response as saved consent', async () => {
    invoke.mockResolvedValue({ data: { success: false, agreement_version: '1.0' } });
    await expect(acceptAiContentAgreement({ accepted: true, agreement_version: '1.0' }))
      .rejects.toThrow(/could not be confirmed/i);
  });

  it('still rejects an invalid protected status', async () => {
    invoke.mockResolvedValue({ data: { success: true } });
    await expect(getAiContentAgreementStatus()).rejects.toThrow(/invalid response/i);
  });
});