import { describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router';
import SwipeablePatientCard from './SwipeablePatientCard';

const patient = {
  id: 'patient /?&=one',
  first_name: 'Ada',
  last_name: 'Lovelace',
  status: 'active',
  agency_id: 'mutable-patient-agency-must-not-authorize',
};

function renderCard(props = {}) {
  return render(
    <MemoryRouter>
      <SwipeablePatientCard
        patient={patient}
        isSelected={false}
        onToggleSelect={vi.fn()}
        onEdit={vi.fn()}
        {...props}
      />
    </MemoryRouter>,
  );
}

describe('SwipeablePatientCard PatientDetails route scope', () => {
  it('encodes both exact identifiers in a scoped chart link', () => {
    renderCard({ patientDetailsAgencyId: 'agency /?&=two' });
    expect(screen.getByRole('link', { name: 'View' })).toHaveAttribute(
      'href',
      '/PatientDetails?id=patient+%2F%3F%26%3Done&agencyId=agency+%2F%3F%26%3Dtwo',
    );
  });

  it('renders a disabled button and no chart link when scope is unavailable', () => {
    renderCard();
    expect(screen.queryByRole('link', { name: 'View' })).toBeNull();
    expect(screen.getByRole('button', { name: 'View' })).toBeDisabled();
  });
});
