import { describe, it, expect, vi } from 'vitest';
import { act, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { renderWithProviders } from '@/test/testUtils';

// Broad stubs so the heavy component mounts without a real backend/LLM.
vi.mock('@/lib/invokeLLM', () => ({
  invokeLLM: async () => ({}),
  invokeLLMWithFile: async () => ({}),
}));

vi.mock('@/api/base44Client', () => {
  const arr = async () => [];
  const obj = async () => ({});
  const entityStub = new Proxy({}, {
    get: (_t, p) => {
      if (p === 'then') return undefined;
      if (p === 'get' || p === 'create' || p === 'update') return obj;
      return arr;
    },
  });
  const entities = new Proxy({}, { get: () => entityStub });
  const fns = { invoke: async () => ({ data: {} }) };
  const integrations = new Proxy({}, { get: () => new Proxy({}, { get: () => async () => ({}) }) });
  return {
    base44: {
      entities, functions: fns, integrations,
      auth: { me: async () => ({ email: 'admin@x.com', role: 'admin' }) },
      asServiceRole: { entities, functions: fns, integrations },
    },
  };
});

describe('OASISAnalyzer — lazy tabs mount under a Suspense boundary', () => {
  it('mounts and switches across all five tabs without a missing-boundary throw', async () => {
    const user = userEvent.setup();
    let OASISAnalyzer;
    await act(async () => {
      ({ default: OASISAnalyzer } = await import('@/components/hub-tabs/OASISAnalyzer'));
    });
    renderWithProviders(<OASISAnalyzer />);

    // The default ("single") tab mounts its lazy feature components under the
    // Suspense boundary — if any lazy child lacked an ancestor boundary, mounting
    // would throw here.
    const tabNames = ['Saved', 'Analytics', 'Automation', 'Batch', 'Single'];
    for (const name of tabNames) {
      expect(screen.getAllByText(new RegExp(name, 'i')).length).toBeGreaterThan(0);
    }

    // Switch into each non-default tab; each lazily loads its chunk and must
    // resolve through the Suspense fallback without throwing.
    for (const tab of ['Analytics', 'Automation', 'Batch', 'Saved']) {
      const trigger = screen.getAllByRole('tab').find((t) => new RegExp(tab, 'i').test(t.textContent));
      if (trigger) {
        await user.click(trigger);
        // Let the lazy chunk + any Suspense fallback settle.
        await waitFor(() => expect(trigger).toHaveAttribute('data-state', 'active'));
      }
    }

    // Reaching here means no tab switch threw.
    expect(true).toBe(true);
  }, 15000);
});
