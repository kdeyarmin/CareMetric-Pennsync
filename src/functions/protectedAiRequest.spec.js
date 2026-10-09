import { beforeEach, expect, it, vi } from 'vitest';
const { invoke } = vi.hoisted(() => ({ invoke: vi.fn() }));
vi.mock('@/api/base44Client', () => ({ base44: { functions: { invoke } } }));
import protectedAiRequest from '@/functions/protectedAiRequest';
import { extractFaxContact } from '@/functions/extractFaxContact';
import { extractReferralResponseScan } from '@/functions/extractReferralResponseScan';
import { structureDictatedVisit } from '@/functions/structureDictatedVisit';
import { analyzeAdrLetter } from '@/functions/analyzeAdrLetter';
import { verifyAdrResponsePacket } from '@/functions/verifyAdrResponsePacket';
beforeEach(() => { invoke.mockReset(); });
it('uses the named operations and preserves response contracts', async () => {
  invoke.mockResolvedValue({ data: { note: 'Synthetic note', items: [] } });
  const payload = { fileUrl: 'synthetic' };
  await extractFaxContact(payload);
  await extractReferralResponseScan({ ...payload, referralId: 'ref', agencyId: 'agency', isImage: false });
  expect(await structureDictatedVisit({ transcript: 'Synthetic dictation', visitType: 'prn' })).toBe('Synthetic note');
  await analyzeAdrLetter(payload);
  await verifyAdrResponsePacket({ caseId: 'case' });
  expect(invoke.mock.calls.map(call => call[0])).toEqual(['extractFaxContact', 'extractReferralResponseScan', 'structureDictatedVisit', 'analyzeAdrLetter', 'verifyAdrResponsePacket']);
  for (const [, input] of invoke.mock.calls) {
    expect(input).not.toHaveProperty('prompt');
    expect(input).not.toHaveProperty('model');
    expect(input).not.toHaveProperty('response_json_schema');
  }
});
it('does not replay an unsuccessful billed operation', async () => {
  const error = Object.assign(new Error('Unavailable'), { status: 502 });
  invoke.mockRejectedValue(error);
  await expect(protectedAiRequest('extractFaxContact', {})).rejects.toMatchObject({ retryable: false });
  expect(invoke).toHaveBeenCalledOnce();
});