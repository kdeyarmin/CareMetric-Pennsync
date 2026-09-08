import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

const invoke = vi.fn(async () => ({}));
const filter = vi.fn(async () => []);
vi.mock('@/api/base44Client', () => ({
  base44: {
    entities: { Patient: { filter: (...a) => filter(...a) } },
    functions: { invoke: (...a) => invoke(...a) },
  },
}));

vi.mock('@/lib/AuthContext', () => ({
  useAuth: () => ({ tenantContext: { agency_id: 'agency-1' } }),
}));

vi.mock('@/hooks/useAuthorizedPatient', () => ({
  useAuthorizedPatient: () => ({
    refetch: vi.fn(async () => ({ data: null })),
  }),
}));

const HealthHistorySection = (await import('./HealthHistorySection')).default;

const renderSection = (patient) =>
  render(
    <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } })}>
      <HealthHistorySection patient={patient} />
    </QueryClientProvider>,
  );

const BASE = {
  id: 'p1',
  agency_id: 'agency-1',
  updated_date: '2026-09-04T12:00:00.000Z',
  first_name: 'Ada',
  last_name: 'Lovelace',
};

describe('HealthHistorySection family medical history', () => {
  it('renders the structured object the entity schema declares', () => {
    // Regression: this object used to be interpolated straight into JSX, which
    // throws "Objects are not valid as a React child" and blanked the card.
    renderSection({
      ...BASE,
      family_medical_history: {
        heart_disease: true,
        diabetes: false,
        stroke: true,
        other_conditions: [{ condition: 'Melanoma', relation: 'Mother' }],
        notes: 'Maternal grandfather had early-onset CAD.',
      },
    });
    expect(screen.getByText('Heart disease')).toBeInTheDocument();
    expect(screen.getByText('Stroke')).toBeInTheDocument();
    expect(screen.getByText('Melanoma — Mother')).toBeInTheDocument();
    expect(screen.getByText('Maternal grandfather had early-onset CAD.')).toBeInTheDocument();
    // A condition that is false is not a finding.
    expect(screen.queryByText('Diabetes')).not.toBeInTheDocument();
  });

  it('still renders a legacy free-text value', () => {
    renderSection({ ...BASE, family_medical_history: 'Father: type 2 diabetes' });
    expect(screen.getByText('Father: type 2 diabetes')).toBeInTheDocument();
  });

  it('shows the empty state for a blank or absent history', () => {
    renderSection({ ...BASE, family_medical_history: {} });
    expect(screen.getByText('No family medical history recorded')).toBeInTheDocument();
  });

  it('keeps structured family history read-only until its dedicated workflow exists', async () => {
    invoke.mockClear();
    renderSection({
      ...BASE,
      family_medical_history: { diabetes: true, other_conditions: [{ condition: 'Melanoma', relation: 'Mother' }] },
    });

    expect(screen.getByRole('button', { name: 'Edit family medical history' })).toBeDisabled();
    expect(screen.getByText(/Family-history editing is temporarily read-only/i)).toBeInTheDocument();
    expect(invoke).not.toHaveBeenCalled();
  });
});
