import { describe, it, expect, vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

vi.mock('sonner', () => ({ toast: { error: vi.fn(), success: vi.fn() } }));

import WageIndexUpload from '@/components/pdgm/WageIndexUpload';
import { PA_WAGE_INDEX_CY2026 } from '@/components/pdgm/paWageIndexCy2026';

describe('WageIndexUpload — bundled PA dataset', () => {
  it('loads the CMS CY2026 PA rows into the preview and stores them via onPersist with provenance', async () => {
    const onPersist = vi.fn().mockResolvedValue();
    render(<WageIndexUpload storedTable={null} onPersist={onPersist} uploadedBy="admin@agency.test" />);

    // Nothing stored yet.
    expect(screen.getByText(/No wage-index table stored/)).toBeInTheDocument();

    await userEvent.click(screen.getByRole('button', { name: /Load PA counties \(CMS CY2026\)/ }));
    // The bundled load lands in the same preview → Store flow as a CSV import.
    expect(screen.getByText(PA_WAGE_INDEX_CY2026.source_file)).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: /Store table/ }));

    await waitFor(() => expect(onPersist).toHaveBeenCalledTimes(1));
    const stored = onPersist.mock.calls[0][0];
    expect(stored.rows).toBe(PA_WAGE_INDEX_CY2026.rows);
    expect(stored.rows).toHaveLength(19);
    expect(stored.source).toMatch(/CY 2026 Final HH PPS Wage Index/);
    expect(stored.uploaded_by_email).toBe('admin@agency.test');
    expect(stored.uploaded_at).toEqual(expect.any(String));
  });

  it('a stored table renders its row count and source', () => {
    render(
      <WageIndexUpload
        storedTable={{ source: 'CY 2026 Final HH PPS Wage Index.xlsx (CMS, bundled: PA counties)', rows: PA_WAGE_INDEX_CY2026.rows }}
        onPersist={vi.fn()}
      />
    );
    expect(screen.getByText(/19 CBSA rows stored/)).toBeInTheDocument();
  });
});
