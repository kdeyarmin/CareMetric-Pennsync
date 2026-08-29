import { StrictMode } from 'react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { act, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

// Controllable LLM stub — each test decides when/what each call resolves, so we
// can exercise loading, error, and out-of-order (raced) completions.
const { invokeLLM } = vi.hoisted(() => ({ invokeLLM: vi.fn() }));
vi.mock('@/api/base44Client', () => ({
  base44: { integrations: { Core: { InvokeLLM: invokeLLM } } },
}));

// The diagnosis-code generator has its own logic tests (diagnosisCodeGenerator.test.js)
// and pulls react-query/agency settings; stub it so this spec stays about ReferralAnalyzer.
vi.mock('@/components/referral/DiagnosisCodeGenerator.jsx', () => ({
  default: () => <div data-testid="dx-codes" />,
}));

vi.mock('sonner', () => ({
  toast: { error: vi.fn(), success: vi.fn() },
}));

import ReferralAnalyzer from '@/components/referral/ReferralAnalyzer';

function deferred() {
  let resolve, reject;
  const promise = new Promise((res, rej) => { resolve = res; reject = rej; });
  return { promise, resolve, reject };
}

const analysisFor = (marker) => ({
  urgency_analysis: {
    clinical_urgency_score: 80,
    administrative_urgency_score: 60,
    overall_urgency_score: 75,
    priority_level: 'High',
    urgency_factors: [],
    reasoning: marker,
  },
  missing_information: { critical_missing: [], recommended_missing: [], data_completeness_score: 90 },
  scheduling_recommendations: { ideal_first_visit_timeframe: 'Within 24 hours' },
  risk_flags: [],
  nurse_requirements: { experience_level: 'Advanced' },
});

const referralA = { demographics: { full_name: 'Alpha Patient' }, diagnosis: 'CHF' };
const referralB = { demographics: { full_name: 'Beta Patient' }, diagnosis: 'COPD' };

beforeEach(() => {
  invokeLLM.mockReset();
});

describe('ReferralAnalyzer', () => {
  it('shows the loading card, then renders the analysis and reports it upward', async () => {
    const d = deferred();
    invokeLLM.mockReturnValueOnce(d.promise);
    const onComplete = vi.fn();

    render(<ReferralAnalyzer referralData={referralA} onAnalysisComplete={onComplete} />);

    expect(screen.getByText(/Analyzing referral with AI/i)).toBeInTheDocument();
    expect(invokeLLM).toHaveBeenCalledTimes(1);

    await act(async () => { d.resolve(analysisFor('REASONING-A')); });

    expect(screen.getByText('REASONING-A')).toBeInTheDocument();
    expect(screen.getByText(/Referral Priority/i)).toBeInTheDocument();
    expect(onComplete).toHaveBeenCalledTimes(1);
    expect(onComplete).toHaveBeenCalledWith(expect.objectContaining({
      urgency_analysis: expect.objectContaining({ reasoning: 'REASONING-A' }),
    }));
  });

  it('discards a superseded in-flight analysis — an older referral\'s slow response never displays or reports as the newer one\'s', async () => {
    const dA = deferred();
    const dB = deferred();
    invokeLLM.mockReturnValueOnce(dA.promise).mockReturnValueOnce(dB.promise);
    const onComplete = vi.fn();

    const { rerender } = render(
      <ReferralAnalyzer referralData={referralA} onAnalysisComplete={onComplete} />
    );
    // A second referral arrives while the first call is still in flight.
    rerender(<ReferralAnalyzer referralData={referralB} onAnalysisComplete={onComplete} />);
    expect(invokeLLM).toHaveBeenCalledTimes(2);

    // The newer (B) call completes first…
    await act(async () => { dB.resolve(analysisFor('REASONING-B')); });
    expect(screen.getByText('REASONING-B')).toBeInTheDocument();

    // …then the stale (A) response lands. It must be ignored entirely.
    await act(async () => { dA.resolve(analysisFor('REASONING-A')); });
    expect(screen.getByText('REASONING-B')).toBeInTheDocument();
    expect(screen.queryByText('REASONING-A')).not.toBeInTheDocument();
    expect(onComplete).toHaveBeenCalledTimes(1);
    expect(onComplete).toHaveBeenCalledWith(expect.objectContaining({
      urgency_analysis: expect.objectContaining({ reasoning: 'REASONING-B' }),
    }));
  });

  it('clears the previous referral\'s analysis while a new referral is being analyzed', async () => {
    const dA = deferred();
    const dB = deferred();
    invokeLLM.mockReturnValueOnce(dA.promise).mockReturnValueOnce(dB.promise);

    const { rerender } = render(<ReferralAnalyzer referralData={referralA} />);
    await act(async () => { dA.resolve(analysisFor('REASONING-A')); });
    expect(screen.getByText('REASONING-A')).toBeInTheDocument();

    rerender(<ReferralAnalyzer referralData={referralB} />);

    // The old analysis must not linger under the new referral.
    await waitFor(() => {
      expect(screen.queryByText('REASONING-A')).not.toBeInTheDocument();
      expect(screen.getByText(/Analyzing referral with AI/i)).toBeInTheDocument();
    });

    await act(async () => { dB.resolve(analysisFor('REASONING-B')); });
    expect(screen.getByText('REASONING-B')).toBeInTheDocument();
  });

  it('shows the error card on failure and recovers via Retry', async () => {
    // status 400 → non-retryable, so runWithRetry rejects immediately.
    const failure = Object.assign(new Error('bad request'), { status: 400 });
    const dRetry = deferred();
    invokeLLM.mockRejectedValueOnce(failure).mockReturnValueOnce(dRetry.promise);

    render(<ReferralAnalyzer referralData={referralA} />);

    const retryButton = await screen.findByRole('button', { name: /Retry analysis/i });
    expect(screen.getByText(/Couldn't analyze this referral/i)).toBeInTheDocument();

    await userEvent.click(retryButton);
    await act(async () => { dRetry.resolve(analysisFor('REASONING-RETRY')); });
    expect(screen.getByText('REASONING-RETRY')).toBeInTheDocument();
  });

  it('renders the deterministic Face-to-Face validation even while the AI analysis is still loading', async () => {
    const d = deferred();
    invokeLLM.mockReturnValueOnce(d.promise);

    const referralWithF2F = {
      diagnosis: 'Congestive heart failure',
      estimated_start_date: '2026-08-25',
      face_to_face: {
        encounter_date: '2026-08-20',
        practitioner_name: 'Dr. Jane Smith',
        practitioner_type: 'MD',
        clinical_reason: 'Follow-up of congestive heart failure exacerbation',
      },
    };
    render(<ReferralAnalyzer referralData={referralWithF2F} />);

    // AI call still pending — the 42 CFR 424.22 result must already be on screen.
    // (The colon form targets the F2F alert specifically; the Medicare-criteria
    // card renders its own "Face-to-Face encounter" row label.)
    expect(screen.getByText(/Analyzing referral with AI/i)).toBeInTheDocument();
    expect(screen.getByText(/Face-to-Face Encounter:/i)).toBeInTheDocument();
    expect(screen.getByText('42 CFR 424.22')).toBeInTheDocument();
    expect(screen.getByText('Compliant')).toBeInTheDocument();

    // The deterministic result is also handed to the model so its
    // missing-information analysis can't contradict it.
    const prompt = invokeLLM.mock.calls[0][0].prompt;
    expect(prompt).toContain('DETERMINISTIC PRE-CHECK');
    expect(prompt).toContain('status: valid');

    await act(async () => { d.resolve(analysisFor('REASONING-A')); });
    expect(screen.getByText(/Face-to-Face Encounter:/i)).toBeInTheDocument();
  });

  it('flags a referral with NO documented F2F: warning alert renders and the prompt instructs critical_missing', async () => {
    const d = deferred();
    invokeLLM.mockReturnValueOnce(d.promise);

    render(<ReferralAnalyzer referralData={referralA} />);

    // The missing condition-of-payment document is visible immediately —
    // deterministic, before/without the AI analysis.
    expect(screen.getByText('Not documented')).toBeInTheDocument();
    expect(screen.getByText(/No Face-to-Face encounter is documented/i)).toBeInTheDocument();

    const prompt = invokeLLM.mock.calls[0][0].prompt;
    expect(prompt).toContain('No Face-to-Face encounter is documented');
    // referralA carries no payer → the F2F directive is the verify-the-plan
    // form, NOT the federal condition-of-payment directive.
    expect(prompt).toContain('recommended_missing');
    expect(prompt).not.toContain('include the Face-to-Face encounter documentation in critical_missing');
    // Anti-hallucination contract: every analysis is grounded in the referral.
    expect(prompt).toContain('NON-NEGOTIABLE GROUNDING RULES');
    expect(prompt).toContain('Never invent demographics, diagnoses, codes, medications, dates, findings, or history');
    expect(prompt).toContain('omit that estimate rather than guessing');
    await act(async () => { d.resolve(analysisFor('REASONING-A')); });
  });

  it('a Medicare referral with NO F2F gets the federal condition-of-payment directive', async () => {
    const d = deferred();
    invokeLLM.mockReturnValueOnce(d.promise);
    const medicareReferral = {
      ...referralA,
      demographics: { ...referralA.demographics, insurance_primary: 'Medicare' },
    };
    render(<ReferralAnalyzer referralData={medicareReferral} />);
    const prompt = invokeLLM.mock.calls[0][0].prompt;
    expect(prompt).toContain('federal condition of payment for this payer');
    expect(prompt).toContain('include the Face-to-Face encounter documentation in critical_missing');
    await act(async () => { d.resolve(analysisFor('REASONING-A')); });
  });

  it('renders the deterministic Medicare-criteria and visit-plan panels in every state', async () => {
    const d = deferred();
    invokeLLM.mockReturnValueOnce(d.promise);

    const referralWithOrders = {
      demographics: { insurance_primary: 'Medicare', referring_physician: 'Dr. A. Wong, MD' },
      skilled_needs: { frequency_duration: 'SN 3w2, 2w2, 1w5', services_ordered: ['SN 3w2, 2w2, 1w5'] },
    };
    render(<ReferralAnalyzer referralData={referralWithOrders} />);

    // Still loading — both deterministic panels are already on screen.
    expect(screen.getByText(/Analyzing referral with AI/i)).toBeInTheDocument();
    expect(screen.getByText(/Medicare Home Health Criteria/i)).toBeInTheDocument();
    expect(screen.getByText(/Visit Plan & Episode Structure/i)).toBeInTheDocument();
    // Ordered frequencies parsed verbatim (3/wk × 2 wks → 2/wk × 2 wks → 1/wk × 5 wks).
    expect(screen.getByText(/3\/wk × 2 wks/)).toBeInTheDocument();
    // Medicare FFS: both 30-day periods get LUPA banding (10 and 4 visits).
    expect(screen.getByText('10 visits')).toBeInTheDocument();
    expect(screen.getByText('4 visits')).toBeInTheDocument();

    await act(async () => { d.resolve(analysisFor('REASONING-A')); });
    expect(screen.getByText(/Medicare Home Health Criteria/i)).toBeInTheDocument();
    expect(screen.getByText(/Visit Plan & Episode Structure/i)).toBeInTheDocument();
  });

  it('renders the AI patient summary and AI visit estimates when nothing is ordered', async () => {
    const d = deferred();
    invokeLLM.mockReturnValueOnce(d.promise);

    render(<ReferralAnalyzer referralData={referralA} />);
    const result = {
      ...analysisFor('REASONING-A'),
      patient_summary: {
        narrative: 'SUMMARY-NARRATIVE for Alpha Patient.',
        key_conditions: ['CHF', 'Hypertension'],
        functional_snapshot: 'Ambulates with walker.',
        support_and_home: 'Lives with spouse.',
      },
      visit_estimates: {
        nursing_visits_first_30_days: 5,
        nursing_visits_days_31_60: 3,
        pt_visits: 4,
        suggested_frequency: 'SN 2w2, 1w6; PT 1w4',
        rationale: 'CHF teaching and monitoring.',
        confidence: 'medium',
      },
    };
    await act(async () => { d.resolve(result); });

    expect(screen.getByText(/Patient Summary/i)).toBeInTheDocument();
    expect(screen.getByText('SUMMARY-NARRATIVE for Alpha Patient.')).toBeInTheDocument();
    expect(screen.getByText(/AI visit estimates \(planning only/i)).toBeInTheDocument();
    expect(screen.getByText('Nursing — days 1–30')).toBeInTheDocument();
    expect(screen.getByText('SN 2w2, 1w6; PT 1w4')).toBeInTheDocument();
  });

  it('fires a single billed call under StrictMode double-mounted effects', async () => {
    const d = deferred();
    invokeLLM.mockReturnValue(d.promise);

    render(
      <StrictMode>
        <ReferralAnalyzer referralData={referralA} />
      </StrictMode>
    );

    // StrictMode runs the mount effect twice; the in-flight dedupe must keep
    // the identical second call from double-billing the LLM.
    expect(invokeLLM).toHaveBeenCalledTimes(1);
    await act(async () => { d.resolve(analysisFor('REASONING-A')); });
    expect(screen.getByText('REASONING-A')).toBeInTheDocument();
  });

  it('renders without the urgency sections when the model omits urgency_analysis', async () => {
    const d = deferred();
    invokeLLM.mockReturnValueOnce(d.promise);

    render(<ReferralAnalyzer referralData={referralA} />);
    const partial = analysisFor('unused');
    delete partial.urgency_analysis;
    await act(async () => { d.resolve(partial); });

    expect(screen.queryByText(/Referral Priority/i)).not.toBeInTheDocument();
    expect(screen.queryByText(/AI Urgency Analysis/i)).not.toBeInTheDocument();
    expect(screen.getByText(/Nurse Requirements/i)).toBeInTheDocument();
  });
});
