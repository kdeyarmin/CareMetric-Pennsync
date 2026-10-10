import { beforeEach, expect, it, vi } from 'vitest';
const { invoke } = vi.hoisted(() => ({ invoke: vi.fn() }));
vi.mock('@/api/base44Client', () => ({ base44: { functions: { invoke } } }));
import protectedAiRequest from '@/lib/protectedAiRequest';
import { extractFaxContact } from '@/functions/extractFaxContact';
import { extractReferralResponseScan } from '@/functions/extractReferralResponseScan';
import { structureDictatedVisit } from '@/functions/structureDictatedVisit';
import { analyzeAdrLetter } from '@/functions/analyzeAdrLetter';
import { verifyAdrResponsePacket } from '@/functions/verifyAdrResponsePacket';
import {
  requestSmartNoteCoverage,
  requestSmartNoteDraft,
  requestSmartNoteGrounding,
} from '@/components/smartNote/compliance/smartNoteOperations';
beforeEach(() => { invoke.mockReset(); });
it('uses the named operations and preserves response contracts', async () => {
  invoke.mockResolvedValue({ data: { note: 'Synthetic note', items: [] } });
  const payload = { fileUrl: 'synthetic' };
  await extractFaxContact(payload);
  await extractReferralResponseScan({ ...payload, referralId: 'ref', agencyId: 'agency', isImage: false });
  expect(await structureDictatedVisit({ transcript: 'Synthetic dictation', visitType: 'prn' })).toBe('Synthetic note');
  await analyzeAdrLetter(payload);
  await verifyAdrResponsePacket({ caseId: 'case' });
  expect(await requestSmartNoteDraft({ draftSentences: [] })).toEqual({ note: 'Synthetic note', items: [] });
  await requestSmartNoteGrounding({ sentences: [], sourceText: '' });
  await requestSmartNoteCoverage({ draftText: 'Synthetic', elements: [] });
  expect(invoke.mock.calls.map(call => call[0])).toEqual([
    'extractFaxContact', 'extractReferralResponseScan', 'structureDictatedVisit', 'analyzeAdrLetter',
    'verifyAdrResponsePacket', 'draftSmartNote', 'checkSmartNoteGrounding', 'checkSmartNoteCoverage',
  ]);
  for (const [, input] of invoke.mock.calls) {
    expect(input).not.toHaveProperty('prompt');
    expect(input).not.toHaveProperty('model');
    expect(input).not.toHaveProperty('response_json_schema');
  }
});
it('does not replay an unsuccessful billed operation', async () => {
  const error = Object.assign(new Error('Unavailable'), { status: 502 });
  invoke.mockRejectedValue(error);
  await expect(protectedAiRequest(() => invoke('extractFaxContact', {}))).rejects.toMatchObject({ retryable: false });
  await expect(extractFaxContact({ fileUrl: 'synthetic' })).rejects.toMatchObject({ retryable: false });
  await expect(requestSmartNoteDraft({ draftSentences: [] })).rejects.toMatchObject({ retryable: false });
  expect(invoke).toHaveBeenCalledTimes(3);
});
it('marks a synchronous invocation failure as not replayable too', async () => {
  const error = new Error('Client unavailable');
  await expect(protectedAiRequest(() => { throw error; })).rejects.toBe(error);
  expect(error.retryable).toBe(false);
});
