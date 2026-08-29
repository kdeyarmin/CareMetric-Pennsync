import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor, fireEvent } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

const { invoke, payerFilter, payerList } = vi.hoisted(() => ({
  invoke: vi.fn(),
  payerFilter: vi.fn(),
  payerList: vi.fn(),
}));

vi.mock('@/api/base44Client', () => ({
  base44: {
    functions: { invoke: (...a) => invoke(...a) },
    entities: {
      PayerRateConfig: { filter: (...a) => payerFilter(...a), list: (...a) => payerList(...a) },
    },
  },
}));

vi.mock('sonner', () => ({ toast: { error: vi.fn(), success: vi.fn() } }));

import PayerRatesManager from '@/components/pdgm/PayerRatesManager';

const ADMIN = { email: 'admin@a.example', role: 'admin', agency_name: 'Agency A' };

const savedConfig = {
  id: 'cfg1',
  agency_name: 'Agency A',
  source_file: 'rates_2026.csv',
  payers: [
    {
      payer_name: 'Aetna Medicare Advantage',
      payer_type: 'medicare_advantage',
      payment_model: 'per_visit',
      per_visit_rates: { SN: 165 },
      approved_visits: { SN: 10 },
      auth_required: true,
      match_terms: ['aetna'],
    },
  ],
};

const renderManager = () =>
  render(
    <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } })}>
      <PayerRatesManager currentUser={ADMIN} />
    </QueryClientProvider>
  );

beforeEach(() => {
  invoke.mockReset().mockResolvedValue({ data: { success: true, saved_count: 1 } });
  payerFilter.mockReset().mockResolvedValue([savedConfig]);
  payerList.mockReset().mockResolvedValue([]);
});

describe('PayerRatesManager', () => {
  it('renders the saved payer table scoped to the caller agency', async () => {
    renderManager();
    expect(await screen.findByText('Aetna Medicare Advantage')).toBeInTheDocument();
    expect(screen.getByText(/last import: rates_2026\.csv/)).toBeInTheDocument();
    expect(payerFilter).toHaveBeenCalledWith({ agency_name: 'Agency A' }, '-created_date', 1);
  });

  it('shows the empty-state instruction when nothing is imported', async () => {
    payerFilter.mockResolvedValue([]);
    renderManager();
    expect(await screen.findByText(/No payer rates imported yet/)).toBeInTheDocument();
  });

  it('parses an uploaded CSV, previews it, and saves via savePayerRateConfig', async () => {
    renderManager();
    await screen.findByText('Aetna Medicare Advantage');

    const csv = [
      'payer_name,payer_type,payment_model,episode_rate,per_visit_sn,approved_sn,match_terms',
      'Keystone First,medicaid,per_visit,,110,12,keystone',
      'Highmark,commercial,episodic,2400,,,highmark',
    ].join('\n');
    const file = new File([csv], 'import.csv', { type: 'text/csv' });
    const input = document.querySelector('input[type="file"]');
    fireEvent.change(input, { target: { files: [file] } });

    expect(await screen.findByText(/2 payers parsed from/)).toBeInTheDocument();
    expect(screen.getByText('Keystone First')).toBeInTheDocument();

    await userEvent.click(screen.getByRole('button', { name: /Import & replace saved table/i }));
    await waitFor(() => expect(invoke).toHaveBeenCalledTimes(1));
    const [fn, payload] = invoke.mock.calls[0];
    expect(fn).toBe('savePayerRateConfig');
    expect(payload.source_file).toBe('import.csv');
    expect(payload.payers).toHaveLength(2);
    expect(payload.payers[0]).toMatchObject({ payer_name: 'Keystone First', payer_type: 'medicaid' });
    expect(payload.payers[1]).toMatchObject({ payer_name: 'Highmark', payment_model: 'episodic', episode_rate: 2400 });
  });

  it('surfaces parse errors and refuses to import an unusable file', async () => {
    renderManager();
    await screen.findByText('Aetna Medicare Advantage');
    const file = new File(['foo,bar\n1,2'], 'bad.csv', { type: 'text/csv' });
    fireEvent.change(document.querySelector('input[type="file"]'), { target: { files: [file] } });
    expect(await screen.findByText(/No payer_name column found/)).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /Import & replace/i })).not.toBeInTheDocument();
    expect(invoke).not.toHaveBeenCalled();
  });

  it('removing a payer saves the remaining set', async () => {
    renderManager();
    await screen.findByText('Aetna Medicare Advantage');
    await userEvent.click(screen.getByRole('button', { name: /Remove Aetna Medicare Advantage/i }));
    await waitFor(() => expect(invoke).toHaveBeenCalledTimes(1));
    expect(invoke.mock.calls[0][1].payers).toHaveLength(0);
  });
});
