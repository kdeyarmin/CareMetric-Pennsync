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

  it('prefers official eCFR links derived from citations, falls back to safe AI links, and never renders unsafe ones', async () => {
    const d = deferred();
    invokeLLM.mockReturnValueOnce(d.promise);

    render(
      <ComprehensiveOASISReviewer oasisData={oasis1} analysisResults={results1} autoReview={true} />
    );
    await act(async () => {
      d.resolve(reviewFor('SUMMARY-LINKS', {
        compliance_risks: [
          {
            risk_title: 'Cited-regulation risk',
            description: 'x',
            severity: 'high',
            // Citation present → the derived official eCFR link wins over the AI link.
            cms_regulation: '42 CFR 484.55',
            cms_guideline_link: 'https://www.cms.gov/some-dead-page',
            corrective_action: 'fix',
          },
          {
            risk_title: 'Manual-reference risk',
            description: 'y',
            severity: 'high',
            // No citation → the AI link is used, since it is scheme-safe.
            cms_regulation: 'OASIS-E Guidance Manual, Section GG',
            cms_guideline_link: 'https://www.cms.gov/files/document/oasis-e-manual.pdf',
            corrective_action: 'fix',
          },
          {
            risk_title: 'Unlinkable risk',
            description: 'z',
            severity: 'high',
            // No citation, unsafe AI link, no matching topic → no link at all.
            cms_regulation: 'Internal agency policy',
            cms_guideline_link: 'javascript:alert(1)',
            corrective_action: 'fix',
          },
        ],
      }));
    });

    const links = screen.getAllByRole('link', { name: /View Official CMS Guideline/i });
    expect(links).toHaveLength(2);
    expect(links[0]).toHaveAttribute('href', 'https://www.ecfr.gov/current/title-42/section-484.55');
    expect(links[1]).toHaveAttribute('href', 'https://www.cms.gov/files/document/oasis-e-manual.pdf');
  });

  it('restores a persisted review without a billed LLM call and shows when it ran', async () => {
    const saved = { results: reviewFor('SUMMARY-SAVED'), reviewed_at: '2026-08-28T12:00:00Z' };

    render(
      <ComprehensiveOASISReviewer
        oasisData={oasis1}
        analysisResults={results1}
        autoReview={true}
        savedReview={saved}
      />
    );

    expect(invokeLLM).not.toHaveBeenCalled();
    expect(screen.getByText('SUMMARY-SAVED')).toBeInTheDocument();
    expect(screen.getByText(/^Reviewed /)).toBeInTheDocument();
  });

  it('reports completed reviews upward so the caller can persist them', async () => {
    const d = deferred();
    invokeLLM.mockReturnValueOnce(d.promise);
    const onReviewComplete = vi.fn();

    render(
      <ComprehensiveOASISReviewer
        oasisData={oasis1}
        analysisResults={results1}
        autoReview={true}
        onReviewComplete={onReviewComplete}
      />
    );
    await act(async () => { d.resolve(reviewFor('SUMMARY-1')); });

    expect(onReviewComplete).toHaveBeenCalledTimes(1);
    expect(onReviewComplete).toHaveBeenCalledWith({
      results: expect.objectContaining({ review_summary: 'SUMMARY-1' }),
      reviewed_at: expect.any(String),
    });
  });

  it('flags the review as outdated when the assessment data changes, and the inline re-run refreshes it', async () => {
    const d1 = deferred();
    const d2 = deferred();
    invokeLLM.mockReturnValueOnce(d1.promise).mockReturnValueOnce(d2.promise);

    const { rerender } = render(
      <ComprehensiveOASISReviewer oasisData={oasis1} analysisResults={results1} autoReview={true} />
    );
    await act(async () => { d1.resolve(reviewFor('SUMMARY-1')); });
    expect(screen.queryByText(/data has changed since this review/i)).not.toBeInTheDocument();

    // An in-place correction replaces the oasisData object.
    const correctedOasis = { ...oasis1, functional_scores: { m1860_ambulation: 3 } };
    rerender(
      <ComprehensiveOASISReviewer oasisData={correctedOasis} analysisResults={results1} autoReview={true} />
    );
    expect(await screen.findByText(/data has changed since this review/i)).toBeInTheDocument();
    expect(invokeLLM).toHaveBeenCalledTimes(1); // notice only — no automatic re-bill

    await userEvent.click(screen.getByRole('button', { name: /Re-run review/i }));
    expect(invokeLLM).toHaveBeenCalledTimes(2);
    await act(async () => { d2.resolve(reviewFor('SUMMARY-2')); });

    expect(screen.getByText('SUMMARY-2')).toBeInTheDocument();
    expect(screen.queryByText(/data has changed since this review/i)).not.toBeInTheDocument();
  });

  it('orders findings most-severe first regardless of model output order', async () => {
    const d = deferred();
    invokeLLM.mockReturnValueOnce(d.promise);

    render(
      <ComprehensiveOASISReviewer oasisData={oasis1} analysisResults={results1} autoReview={true} />
    );
    await act(async () => {
      d.resolve(reviewFor('SUMMARY-SORT', {
        compliance_risks: [
          { risk_title: 'Low-severity risk', description: 'x', severity: 'low', cms_regulation: 'r', corrective_action: 'a' },
          { risk_title: 'Critical-severity risk', description: 'y', severity: 'critical', cms_regulation: 'r', corrective_action: 'a' },
        ],
      }));
    });

    const titles = screen.getAllByRole('heading', { level: 4 }).map((h) => h.textContent);
    expect(titles.indexOf('Critical-severity risk')).toBeLessThan(titles.indexOf('Low-severity risk'));
  });

  it('sends only clinical patient fields to the LLM — never contact info or identifiers', async () => {
    const d = deferred();
    invokeLLM.mockReturnValueOnce(d.promise);

    render(
      <ComprehensiveOASISReviewer
        oasisData={oasis1}
        analysisResults={results1}
        autoReview={true}
        patientData={{
          first_name: 'Testy',
          last_name: 'McPatient',
          date_of_birth: '1950-02-03',
          phone: '555-867-5309',
          address: '123 Main St, Scranton PA',
          email: 'testy@example.com',
          emergency_contact_name: 'Cousin Contact',
          primary_diagnosis: 'Congestive heart failure',
          current_medications: [{ name: 'Furosemide' }],
        }}
      />
    );

    const prompt = invokeLLM.mock.calls[0][0].prompt;
    expect(prompt).toContain('Congestive heart failure');
    expect(prompt).toContain('Furosemide');
    expect(prompt).toContain('"age"');
    expect(prompt).not.toContain('555-867-5309');
    expect(prompt).not.toContain('123 Main St');
    expect(prompt).not.toContain('testy@example.com');
    expect(prompt).not.toContain('McPatient');
    expect(prompt).not.toContain('1950-02-03');
    expect(prompt).not.toContain('Cousin Contact');

    await act(async () => { d.resolve(reviewFor('SUMMARY-PHI')); });
  });
});
