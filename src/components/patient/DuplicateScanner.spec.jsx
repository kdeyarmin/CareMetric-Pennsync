import { describe, it, expect, vi, beforeEach } from 'vitest';
import { screen } from '@testing-library/react';
import { renderWithProviders } from '@/test/testUtils';

// Hoisted so the vi.mock factory (which is hoisted above imports) can reference it.
const { invoke } = vi.hoisted(() => ({ invoke: vi.fn() }));

vi.mock('@/api/base44Client', () => {
  const entityStub = new Proxy({}, { get: () => async () => [] });
  return {
    base44: {
      functions: { invoke },
      entities: new Proxy({}, { get: () => entityStub }),
      auth: { me: async () => ({ role: 'admin' }) },
    },
  };
});

// sonner toast is noisy/irrelevant here.
vi.mock('sonner', () => ({ toast: { info: vi.fn(), success: vi.fn(), error: vi.fn() } }));

import DuplicateScanner from './DuplicateScanner';

describe('DuplicateScanner fail-closed containment', () => {
  beforeEach(() => {
    invoke.mockReset();
  });

  it('renders a static pause notice without invoking the cross-tenant preview', () => {
    renderWithProviders(<DuplicateScanner />);
    expect(screen.getByText(/Patient Duplicate Scanner Paused/i)).toBeInTheDocument();
    expect(screen.getByText(/No patient data or service-role preview is loaded/i)).toBeInTheDocument();
    expect(screen.queryByRole('button')).not.toBeInTheDocument();
    expect(invoke).not.toHaveBeenCalled();
  });
});
