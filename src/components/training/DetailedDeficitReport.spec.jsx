import { describe, it, expect, vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';

// A plain function, not a vi.fn(): the report's own try/catch is what we are
// exercising, and a spy that RECORDS a thrown result gets that error re-surfaced
// by the runner as if the test itself had thrown.
let respond = async () => ({ data: {} });
vi.mock('@/functions/analyzeNurseDeficits', () => ({
  analyzeNurseDeficits: (...args) => respond(...args),
}));

const DetailedDeficitReport = (await import('./DetailedDeficitReport')).default;

const renderReport = () => render(<DetailedDeficitReport nurseEmail="nurse@example.com" />);

describe('DetailedDeficitReport', () => {
  it('renders a partial payload instead of crashing', async () => {
    // The backend's own empty-data branch omits `analytics` entirely, and the
    // report reads analysis.analytics.categoryBreakdown / .severityDistribution
    // and analysis.deficits.length unguarded — one missing key blanked the tab.
    respond = async () => ({ data: { totalSuggestions: 4 } });
    renderReport();
    await waitFor(() => expect(screen.getByText('Documentation Pattern Analysis')).toBeInTheDocument());
    expect(screen.getByText('Total AI Suggestions')).toBeInTheDocument();
  });

  it('does not report a failed analysis as excellent documentation', async () => {
    // The catch used to leave `analysis` null, which falls into the empty state —
    // so an analysis that never ran congratulated the nurse on their charting.
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {});
    respond = () => { throw new Error('backend down'); };
    renderReport();
    await waitFor(() => expect(screen.getByText(/Couldn’t analyze your documentation/)).toBeInTheDocument());
    expect(screen.queryByText(/Excellent Documentation/)).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Try again' })).toBeInTheDocument();
    consoleError.mockRestore();
  });

  it('still shows the all-clear when the analysis genuinely found nothing', async () => {
    respond = async () => ({
      data: { totalSuggestions: 0, deficits: [], patterns: [], recommendations: [], strengths: [] },
    });
    renderReport();
    await waitFor(() => expect(screen.getByText(/Excellent Documentation/)).toBeInTheDocument());
  });
});
