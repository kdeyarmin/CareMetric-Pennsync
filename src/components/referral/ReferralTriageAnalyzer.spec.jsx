import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor, fireEvent } from '@testing-library/react';

const { start, processJob, getJob, listJobs } = vi.hoisted(() => ({
  start: vi.fn(),
  processJob: vi.fn(),
  getJob: vi.fn(),
  listJobs: vi.fn(),
}));

vi.mock('sonner', () => ({ toast: { error: vi.fn(), success: vi.fn() } }));

vi.mock('./referralTriageJobs', async (importOriginal) => ({
  ...(await importOriginal()),
  startPacketTriage: (...args) => start(...args),
  processPacketTriage: (...args) => processJob(...args),
  getPacketTriage: (...args) => getJob(...args),
  listPacketTriage: (...args) => listJobs(...args),
}));

import ReferralTriageAnalyzer from '@/components/referral/ReferralTriageAnalyzer';

const ANALYSIS = {
  patient_name: 'Jane Doe',
  date_of_birth: '1950-05-01',
  primary_diagnosis: 'CHF',
  urgency_level: 'HIGH',
  urgency_reason: 'Recent hospitalization',
  clinical_summary: 'Referred for skilled nursing.',
  admission_notes: 'Call daughter before visit.',
};

const job = (overrides = {}) => ({
  id: 'job-1', status: 'queued', file_name: 'packet.pdf', page_count: 40, part_count: 3, parts_done: 0,
  pages_read: 0, unread_pages: [], summarizing: false, urgency_level: null, error_code: null, error_message: null,
  created_date: '2026-10-15T20:00:00Z', completed_at: null, ...overrides,
});
const ready = (overrides = {}) => job({
  status: 'ready', parts_done: 3, pages_read: 40, urgency_level: 'HIGH', analysis: ANALYSIS, ...overrides,
});

const pdf = (name = 'packet.pdf') => new File(['%PDF-1.7'], name, { type: 'application/pdf' });
const choose = (file) =>
  fireEvent.change(screen.getByLabelText('Referral packet PDF'), { target: { files: [file] } });
const renderPanel = (props = {}) => render(
  <ReferralTriageAnalyzer agencyId="agency-a" retryDelayMs={1} busyDelayMs={1} {...props} />,
);

beforeEach(() => {
  start.mockReset().mockResolvedValue(job());
  processJob.mockReset().mockResolvedValue({ job: ready(), busy: false });
  getJob.mockReset().mockResolvedValue(job());
  listJobs.mockReset().mockResolvedValue([]);
});

describe('ReferralTriageAnalyzer', () => {
  it('has no text box — the packet PDF is the only input', async () => {
    renderPanel();
    expect(screen.queryByRole('textbox')).toBeNull();
    expect(screen.getByRole('button', { name: /choose pdf/i })).toBeInTheDocument();
    expect(screen.getByLabelText('Referral packet PDF')).toHaveAttribute('accept', '.pdf,application/pdf');
    await waitFor(() => expect(listJobs).toHaveBeenCalledWith({ agencyId: 'agency-a' }));
  });

  it('uploads the packet, drives the job to ready, and hands the triage to the page', async () => {
    const onTriageComplete = vi.fn();
    const onTriageReset = vi.fn();
    renderPanel({ onTriageComplete, onTriageReset });

    const file = pdf();
    choose(file);

    expect(await screen.findByText('Urgency Level: HIGH')).toBeInTheDocument();
    expect(start).toHaveBeenCalledWith({ agencyId: 'agency-a', file });
    expect(processJob).toHaveBeenCalledWith({ agencyId: 'agency-a', jobId: 'job-1' });
    expect(onTriageReset).toHaveBeenCalledTimes(1);
    await waitFor(() => expect(onTriageComplete).toHaveBeenCalledWith(ANALYSIS));
    expect(screen.getByText('Ready · HIGH')).toBeInTheDocument();
  });

  it('shows progress while the server reads the packet, and says the user can leave', async () => {
    let finish;
    processJob
      .mockResolvedValueOnce({ job: job({ status: 'processing', parts_done: 1 }), busy: false })
      .mockImplementationOnce(() => new Promise((resolve) => { finish = resolve; }));
    renderPanel();

    choose(pdf());

    // In the progress card and in the packet's row of the recent list.
    expect((await screen.findAllByText(/Reading pages — part 2 of 3/)).length).toBe(2);
    expect(screen.getByText(/You can leave this page/)).toBeInTheDocument();
    finish({ job: ready(), busy: false });
    expect(await screen.findByText('Urgency Level: HIGH')).toBeInTheDocument();
  });

  it('opens a finished packet from a notification link without re-running it', async () => {
    getJob.mockResolvedValue(ready());
    const onTriageComplete = vi.fn();
    renderPanel({ initialJobId: 'job-1', onTriageComplete });

    expect(await screen.findByText('Urgency Level: HIGH')).toBeInTheDocument();
    expect(getJob).toHaveBeenCalledWith({ agencyId: 'agency-a', jobId: 'job-1' });
    expect(processJob).not.toHaveBeenCalled();
    expect(onTriageComplete).toHaveBeenCalledWith(ANALYSIS);
  });

  it('says which pages triage did not see', async () => {
    getJob.mockResolvedValue(ready({ unread_pages: [{ start_page: 16, end_page: 30 }] }));
    renderPanel({ initialJobId: 'job-1' });

    expect(await screen.findByText('Part of the packet was not analyzed')).toBeInTheDocument();
    expect(screen.getByText(/Pages 16–30 could not be read/)).toBeInTheDocument();
  });

  it('shows why a packet failed', async () => {
    getJob.mockResolvedValue(job({ status: 'failed', error_message: 'None of the pages could be read.' }));
    renderPanel({ initialJobId: 'job-1' });

    expect(await screen.findByText('packet.pdf could not be analyzed')).toBeInTheDocument();
    expect(screen.getByText('None of the pages could be read.')).toBeInTheDocument();
    expect(screen.queryByText(/Urgency Level/)).toBeNull();
  });

  it('refuses a file that is not a PDF, or is too large, before uploading', async () => {
    renderPanel();
    choose(new File(['hello'], 'notes.txt', { type: 'text/plain' }));
    expect(await screen.findByText('Upload the referral packet as a PDF.')).toBeInTheDocument();

    const big = pdf('big.pdf');
    Object.defineProperty(big, 'size', { value: 26 * 1024 * 1024 });
    choose(big);
    expect(await screen.findByText(/larger than 25 MB/)).toBeInTheDocument();
    expect(start).not.toHaveBeenCalled();
  });

  it("shows the server's reason when the upload is refused", async () => {
    start.mockRejectedValue(Object.assign(new Error('Request failed with status code 400'), {
      data: { error: 'This PDF is password-protected or encrypted. Save an unprotected copy and upload that.' },
    }));
    renderPanel();
    choose(pdf());
    expect(await screen.findByText(/password-protected or encrypted/)).toBeInTheDocument();
    expect(processJob).not.toHaveBeenCalled();
  });

  it('lists recent packets and opens one, clearing the previous result on the page', async () => {
    listJobs.mockResolvedValue([ready({ id: 'job-1', file_name: 'first.pdf' }), job({ id: 'job-2', file_name: 'second.pdf', status: 'failed', error_message: 'Gone.' })]);
    getJob.mockImplementation(async ({ jobId }) => (jobId === 'job-1'
      ? ready({ id: 'job-1', file_name: 'first.pdf' })
      : job({ id: 'job-2', file_name: 'second.pdf', status: 'failed', error_message: 'Gone.' })));
    const onTriageReset = vi.fn();
    renderPanel({ initialJobId: 'job-1', onTriageReset });

    expect(await screen.findByText('Urgency Level: HIGH')).toBeInTheDocument();
    fireEvent.click(await screen.findByRole('button', { name: /second\.pdf/ }));

    expect(await screen.findByText('second.pdf could not be analyzed')).toBeInTheDocument();
    expect(onTriageReset).toHaveBeenCalledTimes(1);
    await waitFor(() => expect(screen.queryByText('Urgency Level: HIGH')).toBeNull());
  });

  it('keeps following a packet another run is working on', async () => {
    processJob
      .mockResolvedValueOnce({ job: job({ status: 'processing', parts_done: 1 }), busy: true })
      .mockResolvedValueOnce({ job: ready(), busy: false });
    renderPanel();
    choose(pdf());
    expect(await screen.findByText('Urgency Level: HIGH')).toBeInTheDocument();
    expect(processJob).toHaveBeenCalledTimes(2);
  });
});
