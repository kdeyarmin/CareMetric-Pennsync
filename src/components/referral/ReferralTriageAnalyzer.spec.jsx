import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor, fireEvent } from '@testing-library/react';

const { start, processJob, getJob, listJobs, exportToPDFMock, uploadFile, invokeFunction } = vi.hoisted(() => ({
  start: vi.fn(),
  processJob: vi.fn(),
  getJob: vi.fn(),
  listJobs: vi.fn(),
  exportToPDFMock: vi.fn(),
  uploadFile: vi.fn(),
  invokeFunction: vi.fn(),
}));

vi.mock('sonner', () => ({ toast: { error: vi.fn(), success: vi.fn() } }));

vi.mock('./referralTriageJobs', async (importOriginal) => ({
  ...(await importOriginal()),
  startPacketTriage: (...args) => start(...args),
  processPacketTriage: (...args) => processJob(...args),
  getPacketTriage: (...args) => getJob(...args),
  listPacketTriage: (...args) => listJobs(...args),
}));

vi.mock('@/components/utils/pdfExporter', () => ({
  exportToPDF: (...args) => exportToPDFMock(...args),
}));

vi.mock('@/api/base44Client', () => ({
  base44: {
    integrations: { Core: { UploadFile: (...args) => uploadFile(...args) } },
    functions: { invoke: (...args) => invokeFunction(...args) },
  },
}));

vi.mock('@/components/fax/legacyFaxSubmitFeedback', () => ({
  announceLegacyFaxSubmit: vi.fn(),
}));

import ReferralTriageAnalyzer from '@/components/referral/ReferralTriageAnalyzer';

// The fixture deliberately carries the pre-D234 urgency fields: legacy
// stored analyses still have them, and the surface must simply never
// render them (part A).
const ANALYSIS = {
  patient_name: 'Jane Doe',
  date_of_birth: '1950-05-01',
  primary_diagnosis: 'CHF exacerbation',
  urgency_level: 'HIGH',
  urgency_reason: 'Recent hospitalization',
  clinical_summary: 'Referred for skilled nursing.',
  admission_notes: 'Call daughter before visit.',
  preliminary_care_plan: { skilled_nursing_frequency: '3x weekly', medications_to_reconcile: 'Lasix' },
  data_gaps: [],
  diagnosis_coding_review: {
    documented_primary: 'I50.9 heart failure',
    ordering_assessment: 'The documented primary is affirmed as chiefly responsible for the plan of care.',
    codes: [{
      code: 'I50.9', description: 'Heart failure, unspecified', position: 1,
      pdgm_role: 'primary_clinical_grouping',
      justification: 'The failure under treatment that the nursing visits address.',
      documentation_support: 'Discharge summary (p. 2).',
      specificity_flag: 'Type and acuity are not specified in the packet.',
      suggested_more_specific: null, conflict: null,
    }],
    candidates: [{
      condition: 'Hyponatremia', candidate_code: 'E87.1',
      evidence: 'Labs (p. 9) show sodium of 128.',
      pdgm_relevance: 'Electrolyte disorders support comorbidity adjustment.',
      documentation_required: 'A provider-documented diagnosis of hyponatremia.',
    }],
    documentation_needs: [{
      item: 'Echocardiogram report', for_code: 'I50.9',
      detail: 'Obtain the echo to document the type of heart failure.',
    }],
  },
  medicare_compliance: {
    homebound_status: { status: 'satisfied', evidence: 'Daughter confirms the patient is homebound (p. 3).' },
    skilled_need: { status: 'satisfied', evidence: 'Daily wound care ordered.' },
    face_to_face_documented: { status: 'satisfied', evidence: 'Encounter note (p. 5).' },
    face_to_face_timing: { status: 'satisfied', evidence: 'Encounter 10 days before the start of care.' },
    certifying_provider: { status: 'satisfied', evidence: 'Dr. Smith (MD) is the attending.' },
    referral_order: { status: 'missing', evidence: 'No signed order appears in the packet.' },
    plan_of_care_elements: { status: 'satisfied', evidence: 'Frequencies stated (p. 4).' },
    diagnoses_valid: { status: 'satisfied', evidence: 'Codes valid as documented.' },
  },
};

const job = (overrides = {}) => ({
  id: 'job-1', status: 'queued', file_name: 'packet.pdf', page_count: 40, part_count: 3, parts_done: 0,
  pages_read: 0, unread_pages: [], summarizing: false, patient_name: null, error_code: null, error_message: null,
  created_date: '2026-10-15T20:00:00Z', completed_at: null, ...overrides,
});
const ready = (overrides = {}) => job({
  status: 'ready', parts_done: 3, pages_read: 40, patient_name: 'Jane Doe', analysis: ANALYSIS, ...overrides,
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
  exportToPDFMock.mockReset().mockResolvedValue(undefined);
  uploadFile.mockReset().mockResolvedValue({ file_url: 'https://files.example/packet.pdf' });
  invokeFunction.mockReset().mockResolvedValue({ data: { success: true } });
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

    expect(await screen.findByText('Clinical Summary')).toBeInTheDocument();
    expect(start).toHaveBeenCalledWith({ agencyId: 'agency-a', file });
    expect(processJob).toHaveBeenCalledWith({ agencyId: 'agency-a', jobId: 'job-1' });
    expect(onTriageReset).toHaveBeenCalledTimes(1);
    await waitFor(() => expect(onTriageComplete).toHaveBeenCalledWith(ANALYSIS));
    // The badge is status only — no urgency level, even though the stored
    // analysis still carries the legacy fields.
    expect(screen.getByText('Ready')).toBeInTheDocument();
    expect(screen.queryByText(/Urgency Level/)).toBeNull();
    expect(screen.queryByText(/Recent hospitalization/)).toBeNull();
    expect(screen.queryByText('Ready · HIGH')).toBeNull();
  });

  it('renders the PDGM coding review: justification, specificity, candidates, documentation needs', async () => {
    getJob.mockResolvedValue(ready());
    renderPanel({ initialJobId: 'job-1' });

    expect(await screen.findByText('Diagnosis Coding Review (PDGM)')).toBeInTheDocument();
    expect(screen.getByText(/The failure under treatment that the nursing visits address/)).toBeInTheDocument();
    expect(screen.getByText(/Type and acuity are not specified in the packet/)).toBeInTheDocument();
    expect(screen.getAllByText(/Hyponatremia/).length).toBe(2);
    // The candidate's documentation requirement and the coding documentation
    // need each appear twice by design: once in the review card and once in
    // the missing-items packet they feed.
    expect(screen.getAllByText(/A provider-documented diagnosis of hyponatremia/).length).toBe(2);
    expect(screen.getAllByText(/Echocardiogram report/).length).toBe(2);
    expect(screen.getByText(/The documented primary is affirmed/)).toBeInTheDocument();
  });

  it('renders the Medicare compliance checklist and the missing-items packet with its generated forms', async () => {
    getJob.mockResolvedValue(ready());
    renderPanel({ initialJobId: 'job-1' });

    expect(await screen.findByText('Medicare Compliance Checklist')).toBeInTheDocument();
    expect(screen.getByText('Referral order present')).toBeInTheDocument();
    // The evidence line appears in the checklist row and again as the
    // missing item's detail in the packet below.
    expect(screen.getAllByText(/No signed order appears in the packet/).length).toBe(2);
    expect(screen.getByText('Missing Items Packet')).toBeInTheDocument();
    expect(screen.getByText('Home health order from the certifying provider')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /download packet pdf/i })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /home health order pdf/i })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /request cover pdf/i })).toBeInTheDocument();
  });

  it('downloads the analysis as a PDF — and offers no JSON export anywhere (part C)', async () => {
    getJob.mockResolvedValue(ready());
    renderPanel({ initialJobId: 'job-1' });

    expect(await screen.findByText('Clinical Summary')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /json/i })).toBeNull();
    expect(screen.queryByRole('button', { name: /copy analysis/i })).toBeNull();

    fireEvent.click(screen.getByRole('button', { name: /download pdf/i }));
    await waitFor(() => expect(exportToPDFMock).toHaveBeenCalled());
    const call = exportToPDFMock.mock.calls[0][0];
    expect(call.output).toBe('save');
    expect(call.filename).toMatch(/^pennsync-referral-analysis-\d+\.pdf$/);
    const printed = JSON.stringify(call.content);
    expect(printed).toMatch(/Diagnosis Coding Review \(PDGM\)/);
    expect(printed).toMatch(/Medicare Compliance Checklist/);
    expect(printed).toMatch(/Missing Items/);
    expect(/urgency/i.test(printed)).toBe(false);
  });

  it('faxes the missing-items packet through the legacy sendFax path', async () => {
    getJob.mockResolvedValue(ready());
    exportToPDFMock.mockResolvedValue(new Blob(['%PDF'], { type: 'application/pdf' }));
    renderPanel({ initialJobId: 'job-1' });

    expect(await screen.findByText('Missing Items Packet')).toBeInTheDocument();
    fireEvent.change(screen.getByLabelText('Packet fax number'), { target: { value: '7245550144' } });
    fireEvent.click(screen.getByRole('button', { name: /fax packet/i }));

    await waitFor(() => expect(invokeFunction).toHaveBeenCalled());
    expect(uploadFile).toHaveBeenCalled();
    const [name, payload] = invokeFunction.mock.calls[0];
    expect(name).toBe('sendFax');
    expect(payload.to_number).toBe('7245550144');
    expect(payload.patient_id).toBeNull();
    expect(payload.file_url).toBe('https://files.example/packet.pdf');
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
    expect(screen.getAllByText('Analyzing packet…').length).toBeGreaterThan(0);
    finish({ job: ready(), busy: false });
    expect(await screen.findByText('Clinical Summary')).toBeInTheDocument();
  });

  it('opens a finished packet from a notification link without re-running it', async () => {
    getJob.mockResolvedValue(ready());
    const onTriageComplete = vi.fn();
    renderPanel({ initialJobId: 'job-1', onTriageComplete });

    expect(await screen.findByText('Clinical Summary')).toBeInTheDocument();
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

    expect(await screen.findByText('This packet could not be analyzed')).toBeInTheDocument();
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

  it('labels recent packets by patient name and opens one, clearing the previous result on the page', async () => {
    listJobs.mockResolvedValue([
      ready({ id: 'job-1', file_name: 'first.pdf' }),
      job({ id: 'job-2', file_name: 'second.pdf', status: 'failed', error_message: 'Gone.' }),
    ]);
    getJob.mockImplementation(async ({ jobId }) => (jobId === 'job-1'
      ? ready({ id: 'job-1', file_name: 'first.pdf' })
      : job({ id: 'job-2', file_name: 'second.pdf', status: 'failed', error_message: 'Gone.' })));
    const onTriageReset = vi.fn();
    renderPanel({ initialJobId: 'job-1', onTriageReset });

    expect(await screen.findByText('Clinical Summary')).toBeInTheDocument();
    // The ready packet's primary label is the patient's name; the failed
    // packet's is its status. File names survive only as secondary text.
    const rows = screen.getAllByRole('button').map((b) => b.textContent);
    expect(rows.some((t) => t.startsWith('Jane Doe'))).toBe(true);
    expect(rows.some((t) => t.startsWith('Analysis failed'))).toBe(true);

    fireEvent.click(await screen.findByRole('button', { name: /second\.pdf/ }));
    expect(await screen.findByText('This packet could not be analyzed')).toBeInTheDocument();
    expect(onTriageReset).toHaveBeenCalledTimes(1);
    await waitFor(() => expect(screen.queryByText('Clinical Summary')).toBeNull());
  });

  it('keeps following a packet another run is working on', async () => {
    processJob
      .mockResolvedValueOnce({ job: job({ status: 'processing', parts_done: 1 }), busy: true })
      .mockResolvedValueOnce({ job: ready(), busy: false });
    renderPanel();
    choose(pdf());
    expect(await screen.findByText('Clinical Summary')).toBeInTheDocument();
    expect(processJob).toHaveBeenCalledTimes(2);
  });
});
