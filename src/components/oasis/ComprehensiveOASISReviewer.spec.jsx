import { describe, it, expect, vi, beforeEach } from 'vitest';
import { act, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

// Controllable LLM stub — each test decides when/what each call resolves, so we
// can exercise auto-run gating, loading, error, and raced completions.
const { invokeLLM } = vi.hoisted(() => ({ invokeLLM: vi.fn() }));
vi.mock('@/api/base44Client', () => ({
  base44: { integrations: { Core: { InvokeLLM: invokeLLM } } },
}));

vi.mock('sonner', () => ({
  toast: { error: vi.fn(), success: vi.fn() },
}));

import ComprehensiveOASISReviewer from '@/components/oasis/ComprehensiveOASISReviewer';
import { toast } from 'sonner';

function deferred() {
  let resolve, reject;
  const promise = new Promise((res, rej) => { resolve = res; reject = rej; });
  return { promise, resolve, reject };
}

const reviewFor = (marker, extra = {}) => ({
  review_summary: marker,
  overall_risk_level: 'high',
  total_findings: 1,
  compliance_risks: [],
  quality_measure_opportunities: [],
  documentation_inconsistencies: [],
  critical_action_items: [],
  strengths: [],
  ...extra,
});

const oasis1 = { functional_scores: { m1860_ambulation: 2 } };
const results1 = { summary: 'assessment one' };

beforeEach(() => {
  invokeLLM.mockReset();
  toast.error.mockReset?.();
});

describe('ComprehensiveOASISReviewer', () => {
  it('auto-runs once per assessment and renders the findings', async () => {
    const d = deferred();
    invokeLLM.mockReturnValueOnce(d.promise);

    render(
      <ComprehensiveOASISReviewer oasisData={oasis1} analysisResults={results1} autoReview={true} />
    );

    expect(invokeLLM).toHaveBeenCalledTimes(1);
    expect(screen.getByText(/AI performing comprehensive OASIS review/i)).toBeInTheDocument();

    await act(async () => { d.resolve(reviewFor('SUMMARY-1')); });

    expect(screen.getByText('SUMMARY-1')).toBeInTheDocument();
    expect(screen.getByText(/HIGH RISK/i)).toBeInTheDocument();
  });

  it('does NOT re-fire a billed review when oasisData is corrected in place — only a new assessment re-runs it', async () => {
    const d1 = deferred();
    const d2 = deferred();
    invokeLLM.mockReturnValueOnce(d1.promise).mockReturnValueOnce(d2.promise);

    const { rerender } = render(
      <ComprehensiveOASISReviewer oasisData={oasis1} analysisResults={results1} autoReview={true} />
    );
    await act(async () => { d1.resolve(reviewFor('SUMMARY-1')); });
    expect(screen.getByText('SUMMARY-1')).toBeInTheDocument();

    // The parent applies an in-place correction: pdgmData gets a NEW object
    // identity, but it is still the SAME assessment.
    const correctedOasis = { ...oasis1, functional_scores: { m1860_ambulation: 3 } };
    rerender(
      <ComprehensiveOASISReviewer oasisData={correctedOasis} analysisResults={results1} autoReview={true} />
    );
    await act(async () => {});
    expect(invokeLLM).toHaveBeenCalledTimes(1);
    expect(screen.getByText('SUMMARY-1')).toBeInTheDocument();

    // A genuinely new assessment (new analysisResults object) re-runs the review,
    // and the stale findings clear while it runs.
    const results2 = { summary: 'assessment two' };
    rerender(
      <ComprehensiveOASISReviewer oasisData={correctedOasis} analysisResults={results2} autoReview={true} />
    );
    expect(invokeLLM).toHaveBeenCalledTimes(2);
    await waitFor(() => {
      expect(screen.queryByText('SUMMARY-1')).not.toBeInTheDocument();
      expect(screen.getByText(/AI performing comprehensive OASIS review/i)).toBeInTheDocument();
    });

    await act(async () => { d2.resolve(reviewFor('SUMMARY-2')); });
    expect(screen.getByText('SUMMARY-2')).toBeInTheDocument();
  });

  it('ignores a superseded in-flight review — a slow old response never overwrites the newer one', async () => {
    const d1 = deferred();
    const d2 = deferred();
    invokeLLM.mockReturnValueOnce(d1.promise).mockReturnValueOnce(d2.promise);

    const { rerender } = render(
      <ComprehensiveOASISReviewer oasisData={oasis1} analysisResults={results1} autoReview={true} />
    );
    // A second assessment loads while the first review is still in flight.
    const results2 = { summary: 'assessment two' };
    rerender(
      <ComprehensiveOASISReviewer oasisData={oasis1} analysisResults={results2} autoReview={true} />
    );
    expect(invokeLLM).toHaveBeenCalledTimes(2);

    await act(async () => { d2.resolve(reviewFor('SUMMARY-2')); });
    expect(screen.getByText('SUMMARY-2')).toBeInTheDocument();

    await act(async () => { d1.resolve(reviewFor('SUMMARY-1')); });
    expect(screen.getByText('SUMMARY-2')).toBeInTheDocument();
    expect(screen.queryByText('SUMMARY-1')).not.toBeInTheDocument();
  });

  it('surfaces a failed review with a retry, and the retry recovers', async () => {
    // status 400 → non-retryable, so runWithRetry rejects immediately.
    const failure = Object.assign(new Error('bad request'), { status: 400 });
    const dRetry = deferred();
    invokeLLM.mockRejectedValueOnce(failure).mockReturnValueOnce(dRetry.promise);

    render(
      <ComprehensiveOASISReviewer oasisData={oasis1} analysisResults={results1} autoReview={true} />
    );

    const retryButton = await screen.findByRole('button', { name: /Retry Comprehensive Review/i });
    expect(screen.getByText(/didn't complete/i)).toBeInTheDocument();
    expect(toast.error).toHaveBeenCalled();

    await userEvent.click(retryButton);
    await act(async () => { dRetry.resolve(reviewFor('SUMMARY-RETRY')); });
    expect(screen.getByText('SUMMARY-RETRY')).toBeInTheDocument();
  });

  it('with autoReview off, waits for the Start button', async () => {
    const d = deferred();
    invokeLLM.mockReturnValueOnce(d.promise);

    render(
      <ComprehensiveOASISReviewer oasisData={oasis1} analysisResults={results1} autoReview={false} />
    );
    expect(invokeLLM).not.toHaveBeenCalled();

    await userEvent.click(screen.getByRole('button', { name: /Start Comprehensive Review/i }));
    expect(invokeLLM).toHaveBeenCalledTimes(1);
    await act(async () => { d.resolve(reviewFor('SUMMARY-MANUAL')); });
    expect(screen.getByText('SUMMARY-MANUAL')).toBeInTheDocument();
  });

  it('renders CMS guideline links only for safe URLs', async () => {
    const d = deferred();
    invokeLLM.mockReturnValueOnce(d.promise);

    render(
      <ComprehensiveOASISReviewer oasisData={oasis1} analysisResults={results1} autoReview={true} />
    );
    await act(async () => {
      d.resolve(reviewFor('SUMMARY-LINKS', {
        compliance_risks: [
          {
            risk_title: 'Safe-link risk',
            description: 'x',
            severity: 'high',
            cms_regulation: '42 CFR 484.55',
            cms_guideline_link: 'https://www.cms.gov/some-guideline',
            corrective_action: 'fix',
          },
          {
            risk_title: 'Unsafe-link risk',
            description: 'y',
            severity: 'high',
            cms_regulation: '42 CFR 484.60',
            cms_guideline_link: 'javascript:alert(1)',
            corrective_action: 'fix',
          },
        ],
      }));
    });

    // The compliance section is expanded by default; only the safe URL renders a link.
    const links = screen.getAllByRole('link', { name: /View Official CMS Guideline/i });
    expect(links).toHaveLength(1);
    expect(links[0]).toHaveAttribute('href', 'https://www.cms.gov/some-guideline');
  });
});
