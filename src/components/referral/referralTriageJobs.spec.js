import { describe, it, expect, vi, beforeEach } from 'vitest';

const { invoke, upload } = vi.hoisted(() => ({ invoke: vi.fn(), upload: vi.fn() }));

vi.mock('@/api/base44Client', () => ({ base44: { functions: { invoke: (...args) => invoke(...args) } } }));
vi.mock('@/components/utils/uploadClinicalFile', () => ({ default: (...args) => upload(...args) }));

import {
  describeJobProgress,
  getPacketTriage,
  isPdfFile,
  jobErrorMessage,
  listPacketTriage,
  processPacketTriage,
  startPacketTriage,
} from './referralTriageJobs';

beforeEach(() => {
  invoke.mockReset();
  upload.mockReset().mockResolvedValue({ file_uri: 'private/app/packet.pdf', file_url: 'https://signed.test/x' });
});

describe('referralTriageJobs client', () => {
  it('uploads privately, then starts the job with the private URI and a request id', async () => {
    invoke.mockResolvedValue({ data: { success: true, job: { id: 'job-1', status: 'queued' } } });
    const file = new File(['%PDF'], 'packet.pdf', { type: 'application/pdf' });

    const job = await startPacketTriage({ agencyId: 'agency-a', file });

    expect(job).toEqual({ id: 'job-1', status: 'queued' });
    expect(upload).toHaveBeenCalledWith({ file });
    const [name, params] = invoke.mock.calls[0];
    expect(name).toBe('referralTriageJobs');
    expect(params).toMatchObject({
      action: 'start', agency_id: 'agency-a', file_uri: 'private/app/packet.pdf', file_name: 'packet.pdf',
    });
    expect(params.client_request_id).toEqual(expect.any(String));
  });

  it('passes process, get and list through with the agency', async () => {
    invoke.mockResolvedValueOnce({ data: { success: true, job: { id: 'job-1' }, busy: true } });
    expect(await processPacketTriage({ agencyId: 'agency-a', jobId: 'job-1' })).toEqual({ job: { id: 'job-1' }, busy: true });
    invoke.mockResolvedValueOnce({ data: { success: true, job: { id: 'job-1', analysis: {} } } });
    expect(await getPacketTriage({ agencyId: 'agency-a', jobId: 'job-1' })).toEqual({ id: 'job-1', analysis: {} });
    invoke.mockResolvedValueOnce({ data: { success: true, jobs: [{ id: 'job-1' }] } });
    expect(await listPacketTriage({ agencyId: 'agency-a' })).toEqual([{ id: 'job-1' }]);
    expect(invoke.mock.calls.map(([, params]) => params.action)).toEqual(['process', 'get', 'list']);
  });

  it("surfaces the server's own sentence when a call is refused", async () => {
    invoke.mockRejectedValue(Object.assign(new Error('Request failed with status code 400'), {
      status: 400, data: { error: 'This PDF is password-protected or encrypted.', code: 'PDF_ENCRYPTED' },
    }));
    const failure = await startPacketTriage({ agencyId: 'agency-a', file: new File(['x'], 'a.pdf') }).catch((e) => e);
    expect(jobErrorMessage(failure, 'fallback')).toBe('This PDF is password-protected or encrypted.');
    expect(jobErrorMessage(new Error('Network Error'), 'fallback')).toBe('fallback');
  });

  it('describes progress in words', () => {
    expect(describeJobProgress({ status: 'queued', part_count: 7 })).toBe('Waiting to start…');
    expect(describeJobProgress({ status: 'processing', part_count: 7, parts_done: 3 })).toBe('Reading pages — part 4 of 7');
    expect(describeJobProgress({ status: 'processing', part_count: 7, parts_done: 7, summarizing: true }))
      .toBe('Writing the triage summary…');
    expect(describeJobProgress({ status: 'failed', error_message: 'None of the pages could be read.' }))
      .toBe('None of the pages could be read.');
    expect(describeJobProgress({ status: 'ready' })).toBe('Triage ready');
  });

  it('recognizes a PDF by type or extension', () => {
    expect(isPdfFile({ name: 'x.bin', type: 'application/pdf' })).toBe(true);
    expect(isPdfFile({ name: 'Packet.PDF', type: '' })).toBe(true);
    expect(isPdfFile({ name: 'notes.txt', type: 'text/plain' })).toBe(false);
  });
});
