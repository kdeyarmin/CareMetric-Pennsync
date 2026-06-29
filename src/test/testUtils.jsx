/**
 * Shared helpers for component/integration tests (Vitest + React Testing Library).
 *
 * - `renderWithProviders` wraps a component in the providers the app needs at
 *   runtime (React Query + Router) so page/feature components mount the way they
 *   do in production.
 * - `makeBase44Stub` builds a Proxy stub of the Base44 SDK that resolves every
 *   entity/auth/function/integration call to empty data, so a test that only
 *   cares about render/behavior doesn't have to hand-mock each call. Pass
 *   `overrides` to supply specific responses. Use it inside a `vi.mock(
 *   '@/api/base44Client', ...)` factory (which Vitest hoists).
 */
import { render } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { ConfirmDialogProvider } from '@/components/ui/confirm-dialog';

/** Render `ui` inside Router + a fresh (retry-disabled) QueryClient. */
export function renderWithProviders(ui, { route = '/', queryClient } = {}) {
  const qc =
    queryClient ||
    new QueryClient({
      defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
    });
  return render(
    <QueryClientProvider client={qc}>
      <ConfirmDialogProvider>
        <MemoryRouter initialEntries={[route]}>{ui}</MemoryRouter>
      </ConfirmDialogProvider>
    </QueryClientProvider>
  );
}

/**
 * Build a Base44 SDK stub. Every entity method (filter/list/bulk*) resolves to
 * [], get/create/update to {}, functions/integrations to { data: {} }. Override
 * specific paths via `overrides`, e.g.:
 *   makeBase44Stub({ auth: { me: async () => ({ role: 'admin' }) } })
 */
export function makeBase44Stub(overrides = {}) {
  const arr = async () => [];
  const obj = async () => ({});
  const entityStub = new Proxy(
    {},
    {
      get: (_t, prop) => {
        if (prop === 'then') return undefined; // never look like a thenable
        if (prop === 'get' || prop === 'create' || prop === 'update') return obj;
        return arr; // filter / list / bulk* → []
      },
    }
  );
  const entities = new Proxy({}, { get: () => entityStub });
  const functions = new Proxy({}, { get: () => async () => ({ data: {} }) });
  const integrations = new Proxy(
    {},
    { get: () => new Proxy({}, { get: () => async () => ({}) }) }
  );
  return {
    entities,
    functions,
    integrations,
    auth: {
      me: async () => ({}),
      logout: () => {},
      redirectToLogin: () => {},
      ...(overrides.auth || {}),
    },
    asServiceRole: { entities, functions, integrations },
    ...overrides,
  };
}
