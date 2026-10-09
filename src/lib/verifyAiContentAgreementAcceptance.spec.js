import { beforeEach, describe, expect, it, vi } from 'vitest';
import { verifyAiContentAgreementAcceptance } from '@/lib/verifyAiContentAgreementAcceptance';
const { readStatus } = vi.hoisted(() => ({ readStatus: vi.fn() }));
vi.mock('@/functions/getAiContentAgreementStatus', () => ({ getAiContentAgreementStatus: readStatus }));
const key = ['aiContentAgreementStatus', 'nurse-1', 'agency-1'];
let client;
beforeEach(() => {
  readStatus.mockReset();
  client = { cancelQueries: vi.fn().mockResolvedValue(), setQueryData: vi.fn() };
});
describe('Protected post-consent verification', () => {
  it('cancels stale reads before verifying and publishes only confirmed acceptance', async () => {
    const order = [];
    client.cancelQueries.mockImplementation(async () => { order.push('cancel'); });
    const status = { accepted: true, agreement_version: '1.0' };
    readStatus.mockImplementation(async () => { order.push('verify'); return status; });
    expect(await verifyAiContentAgreementAcceptance(client, key)).toEqual(status);
    expect(order).toEqual(['cancel', 'verify']);
    expect(client.cancelQueries).toHaveBeenCalledWith({ queryKey: key, exact: true });
    expect(client.setQueryData).toHaveBeenCalledWith(key, status);
  });
  it.each([
    { accepted: false, agreement_version: '1.0' },
    { accepted: true, agreement_version: '0.9' },
  ])('never opens access from unverified or outdated consent', async (status) => {
    readStatus.mockResolvedValue(status);
    await expect(verifyAiContentAgreementAcceptance(client, key)).rejects.toThrow(/not yet verified/i);
    expect(client.setQueryData).not.toHaveBeenCalled();
  });
  it('allows a fresh verification retry without changing the cached gate on failure', async () => {
    readStatus.mockRejectedValueOnce(new Error('connection failed'));
    await expect(verifyAiContentAgreementAcceptance(client, key)).rejects.toThrow('connection failed');
    expect(client.setQueryData).not.toHaveBeenCalled();
    const status = { accepted: true, agreement_version: '1.0' };
    readStatus.mockResolvedValueOnce(status);
    await verifyAiContentAgreementAcceptance(client, key);
    expect(client.setQueryData).toHaveBeenCalledTimes(1);
  });
});