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
    expect(screen.getByText(/Analyzing referral with AI/i)).toBeInTheDocument();
    expect(screen.getByText(/Face-to-Face Encounter/i)).toBeInTheDocument();
    expect(screen.getByText('42 CFR 424.22')).toBeInTheDocument();
    expect(screen.getByText('Compliant')).toBeInTheDocument();

    await act(async () => { d.resolve(analysisFor('REASONING-A')); });
    expect(screen.getByText(/Face-to-Face Encounter/i)).toBeInTheDocument();
  });
});
