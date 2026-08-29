import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

const update = vi.fn(async () => ({}));
const filter = vi.fn(async () => []);
vi.mock('@/api/base44Client', () => ({
  base44: { entities: { Patient: { update: (...a) => update(...a), filter: (...a) => filter(...a) } } },
}));

const HealthHistorySection = (await import('./HealthHistorySection')).default;

const renderSection = (patient) =>
  render(
    <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } })}>
      <HealthHistorySection patient={patient} />
    </QueryClientProvider>,
  );

const BASE = { id: 'p1', first_name: 'Ada', last_name: 'Lovelace' };

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

  it('saves the schema OBJECT shape, preserving fields the dialog does not edit', async () => {
    update.mockClear();
    renderSection({
      ...BASE,
      family_medical_history: { diabetes: true, other_conditions: [{ condition: 'Melanoma', relation: 'Mother' }] },
    });

    fireEvent.click(screen.getByRole('button', { name: 'Edit family medical history' }));
    await waitFor(() => expect(screen.getByText('Conditions in the family')).toBeInTheDocument());

    fireEvent.click(screen.getByLabelText('Heart disease'));
    fireEvent.change(screen.getByLabelText('Notes'), { target: { value: 'Two siblings with CAD.' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save Changes' }));

    await waitFor(() => expect(update).toHaveBeenCalled());
    const [, payload] = update.mock.calls.at(-1);
    expect(payload.family_medical_history).toMatchObject({
      diabetes: true,
      heart_disease: true,
      notes: 'Two siblings with CAD.',
      // Untouched by this dialog — must survive the write, not be dropped.
      other_conditions: [{ condition: 'Melanoma', relation: 'Mother' }],
    });
    expect(typeof payload.family_medical_history).toBe('object');
  });
});
