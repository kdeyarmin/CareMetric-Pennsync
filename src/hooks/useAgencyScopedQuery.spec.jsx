import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { renderHook, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

const { userList, authMe } = vi.hoisted(() => ({ userList: vi.fn(), authMe: vi.fn() }));

vi.mock('@/api/base44Client', () => ({
  base44: { entities: { User: { list: userList } }, auth: { me: authMe } },
}));

const { useAgencyScopedQuery } = await import('./useAgencyScopedQuery.js');
const { resetAgencyRosterCache } = await import('@/lib/agencyRoster.js');

const ROSTER = [
  { email: 'a@x.com', agency_name: 'Acme' },
  { email: 'b@x.com', agency_name: 'Other' },
];
const ROWS = [
  { id: 'ours', created_by: 'a@x.com' },
  { id: 'theirs', created_by: 'b@x.com' },
  { id: 'departed', created_by: 'gone@x.com' },
];

function wrapper({ children }) {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false, staleTime: 60000 } },
  });
  return <QueryClientProvider client={client}>{children}</QueryClientProvider>;
}

describe('useAgencyScopedQuery', () => {
  beforeEach(() => {
    resetAgencyRosterCache();
    userList.mockReset().mockResolvedValue(ROSTER);
    authMe.mockReset().mockResolvedValue({ role: 'admin', agency_name: 'Acme' });
  });
  afterEach(() => resetAgencyRosterCache());

  it('hides records authored by another agency, keeping departed authors', async () => {
    const { result } = renderHook(() => useAgencyScopedQuery({
      queryKey: ['visits'],
      fetch: async () => ROWS,
    }), { wrapper });
    await waitFor(() => expect(result.current.data).toBeDefined());
    await waitFor(() => expect(result.current.data.map((r) => r.id)).toEqual(['ours', 'departed']));
  });

  it('fetches on mount even under a non-zero staleTime', async () => {
    const fetch = vi.fn(async () => ROWS);
    renderHook(() => useAgencyScopedQuery({
      queryKey: ['visits'], fetch, initialData: [],
    }), { wrapper });
    await waitFor(() => expect(fetch).toHaveBeenCalled());
  });

  it('honours a custom author field', async () => {
    const docs = [
      { id: 'ours', uploaded_by: 'a@x.com' },
      { id: 'theirs', uploaded_by: 'b@x.com' },
    ];
    const { result } = renderHook(() => useAgencyScopedQuery({
      queryKey: ['docs'],
      fetch: async () => docs,
      authorOf: (d) => d.uploaded_by,
    }), { wrapper });
    await waitFor(() => expect(result.current.data?.map((r) => r.id)).toEqual(['ours']));
  });

  describe('scoped: false', () => {
    // For a read already pinned to one chart or record. Filtering it again can
    // only hide rows — a document on THIS chart uploaded by a co-treating
    // clinician in another agency would vanish from the chart it belongs to.
    it('returns rows untouched', async () => {
      const { result } = renderHook(() => useAgencyScopedQuery({
        queryKey: ['patient-documents', 'p1'],
        fetch: async () => ROWS,
        scoped: false,
      }), { wrapper });
      await waitFor(() => expect(result.current.data?.map((r) => r.id))
        .toEqual(['ours', 'theirs', 'departed']));
    });

    it('does not append the agency to the key, so a pinned read keeps its own entry', async () => {
      const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
      const shared = ({ children }) => (
        <QueryClientProvider client={client}>{children}</QueryClientProvider>
      );
      renderHook(() => useAgencyScopedQuery({
        queryKey: ['patient-documents', 'p1'], fetch: async () => ROWS, scoped: false,
      }), { wrapper: shared });
      await waitFor(() => expect(client.getQueryData(['patient-documents', 'p1'])).toBeDefined());
    });

    it('does not wait on the caller, since nothing is being filtered', async () => {
      // auth never resolves; a scoped read would stall, an unscoped one must not.
      authMe.mockReturnValue(new Promise(() => {}));
      const fetch = vi.fn(async () => ROWS);
      renderHook(() => useAgencyScopedQuery({
        queryKey: ['patient-documents', 'p1'], fetch, scoped: false,
      }), { wrapper });
      await waitFor(() => expect(fetch).toHaveBeenCalled());
    });
  });
});
