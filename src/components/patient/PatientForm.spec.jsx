import { describe, it, expect, vi, beforeEach } from 'vitest';
import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { renderWithProviders } from '@/test/testUtils';

// Hoisted so the vi.mock factory (hoisted above imports) can reference them.
const { listMock, createMock } = vi.hoisted(() => ({
  listMock: vi.fn(),
  createMock: vi.fn(),
}));

vi.mock('@/api/base44Client', () => {
  const entityStub = new Proxy(
    {},
    {
      get: (_t, prop) => {
        if (prop === 'then') return undefined;
        if (prop === 'list') return listMock;
        if (prop === 'create') return createMock;
        if (prop === 'get' || prop === 'update') return async () => ({});
        return async () => [];
      },
    }
  );
  return {
    base44: {
      entities: new Proxy({}, { get: () => entityStub }),
      functions: new Proxy({}, { get: () => async () => ({ data: {} }) }),
      auth: { me: async () => ({ role: 'nurse' }) },
    },
  };
});

// security helpers: pass data through, no-op logging.
vi.mock('../utils/security', () => ({
  sanitizeObject: (o) => o,
  handleSecureError: vi.fn(),
  logSecurityEvent: vi.fn(),
}));

import PatientForm from './PatientForm';

const EXISTING = {
  id: 'existing-1',
  first_name: 'John',
  last_name: 'Smith',
  date_of_birth: '1950-01-15',
  medical_record_number: 'MRN-100',
  is_archived: false,
  status: 'active',
};

async function fillRequired(user) {
  await user.type(screen.getByLabelText(/First Name/i), 'John');
  await user.type(screen.getByLabelText(/Last Name/i), 'Smith');
}

describe('PatientForm add-time duplicate guard', () => {
  beforeEach(() => {
    listMock.mockReset();
    createMock.mockReset();
    listMock.mockResolvedValue([EXISTING]);
    createMock.mockResolvedValue({ id: 'new-1' });
  });

  it('warns and does NOT create when the entered patient matches an existing one', async () => {
    const user = userEvent.setup();
    const onSuccess = vi.fn();
    renderWithProviders(<PatientForm onSuccess={onSuccess} onCancel={() => {}} />);

    // Wait for the existing roster to load into the query cache.
    await waitFor(() => expect(listMock).toHaveBeenCalled());

    await fillRequired(user);
    // Match on MRN + name so the candidate is unmistakably a duplicate.
    await user.type(screen.getByLabelText(/Medical Record Number/i), 'MRN-100');

    await user.click(screen.getByRole('button', { name: /Add Patient/i }));

    // The duplicate warning appears and the patient is NOT created.
    await screen.findByText(/Possible duplicate patient/i);
    expect(screen.getByRole('button', { name: /Open chart/i })).toBeInTheDocument();
    expect(createMock).not.toHaveBeenCalled();
  });

  it('creates the patient anyway after the user overrides the warning', async () => {
    const user = userEvent.setup();
    const onSuccess = vi.fn();
    renderWithProviders(<PatientForm onSuccess={onSuccess} onCancel={() => {}} />);
    await waitFor(() => expect(listMock).toHaveBeenCalled());

    await fillRequired(user);
    await user.type(screen.getByLabelText(/Medical Record Number/i), 'MRN-100');
    await user.click(screen.getByRole('button', { name: /Add Patient/i }));

    await screen.findByText(/Possible duplicate patient/i);
    await user.click(screen.getByRole('button', { name: /Add as new anyway/i }));

    await waitFor(() => expect(createMock).toHaveBeenCalledTimes(1));
    expect(onSuccess).toHaveBeenCalled();
  });

  it('creates without warning when no existing patient matches', async () => {
    const user = userEvent.setup();
    const onSuccess = vi.fn();
    renderWithProviders(<PatientForm onSuccess={onSuccess} onCancel={() => {}} />);
    await waitFor(() => expect(listMock).toHaveBeenCalled());

    await user.type(screen.getByLabelText(/First Name/i), 'Zelda');
    await user.type(screen.getByLabelText(/Last Name/i), 'Nightingale');
    await user.click(screen.getByRole('button', { name: /Add Patient/i }));

    await waitFor(() => expect(createMock).toHaveBeenCalledTimes(1));
    expect(screen.queryByText(/Possible duplicate patient/i)).not.toBeInTheDocument();
    expect(onSuccess).toHaveBeenCalled();
  });
});
