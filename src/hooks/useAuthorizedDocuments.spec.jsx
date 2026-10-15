import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, renderHook, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  authMe: vi.fn(),
  getTenantContext: vi.fn(),
  listDocuments: vi.fn(),
}));

vi.mock('@/api/base44Client', () => ({
  base44: { auth: { me: mocks.authMe } },
}));
vi.mock('@/functions/getMyTenantContext', () => ({
  getMyTenantContext: mocks.getTenantContext,
}));
vi.mock('@/functions/listAuthorizedDocuments', () => ({
  listAuthorizedDocuments: mocks.listDocuments,
}));

import {
  loadAuthorizedDocumentPages,
  useAuthorizedDocuments,
} from './useAuthorizedDocuments';
import {
  bindTrustedTenantContext,
  clearTrustedTenantContext,
} from '@/lib/roles';

const SCOPE = {
  user_id: 'user-a',
  agency_id: 'agency-a',
  membership_id: 'membership-a',
  membership_version: 4,
  tenant_role: 'manager',
};

const tenantContext = (overrides = {}) => ({
  user_id: 'user-a',
  user_email: 'manager@agency.test',
  membership_id: 'membership-a',
  membership_key: 'agency-a:user-a',
  membership_version: 4,
  agency_id: 'agency-a',
  tenant_role: 'manager',
  membership_status: 'active',
  is_platform_owner: false,
  agency: { id: 'agency-a', name: 'Agency A', status: 'active' },
  ...overrides,
});

const documentRow = (id, updatedDate) => ({
  id,
  title: `${id}.pdf`,
  file_name: `${id}.pdf`,
  file_size: 20,
  file_type: 'application/pdf',
  category: 'other',
  patient_id: null,
  document_date: '2026-09-04',
  is_sensitive: true,
  expiration_date: null,
  is_signed: false,
  is_locked: false,
  updated_date: updatedDate,
});

const page = ({ documents = [], cursor = null, hasMore = false, scope = SCOPE } = {}) => ({
  success: true,
  purpose: 'library',
  documents,
  scope: { ...scope, patient_id: null },
  page: {
    page_size: 10,
    sort: 'document_id_asc',
    after_document_id: cursor?.after_document_id ?? null,
    scanned_count: documents.length,
    returned_count: documents.length,
    has_more: hasMore,
    next_cursor: hasMore ? {
      version: 1,
      after_document_id: documents.at(-1).id,
      agency_id: 'agency-a',
      purpose: 'library',
      patient_id: null,
      binding_purpose: null,
      sort: 'document_id_asc',
      page_size: 10,
      subject_user_id: 'user-a',
      membership_id: 'membership-a',
      membership_version: 4,
      tenant_role: 'manager',
    } : null,
  },
});

function wrapper() {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  return function TestProvider({ children }) {
    return <QueryClientProvider client={client}>{children}</QueryClientProvider>;
  };
}

function harnessClient() {
  return new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
}

function sharedWrapper(client) {
  return function TestProvider({ children }) {
    return <QueryClientProvider client={client}>{children}</QueryClientProvider>;
  };
}

describe('authorized Document list boundary', () => {
  beforeEach(() => {
    clearTrustedTenantContext();
    mocks.authMe.mockReset();
    mocks.getTenantContext.mockReset();
    mocks.listDocuments.mockReset();
    mocks.authMe.mockResolvedValue({ id: 'user-a', email: 'manager@agency.test' });
    mocks.listDocuments.mockResolvedValue(page());
    bindTrustedTenantContext(
      { id: 'user-a', email: 'manager@agency.test' },
      tenantContext(),
    );
  });

  afterEach(() => clearTrustedTenantContext());

  it('walks stable keyset pages, verifies scope, and applies UI ordering only afterward', async () => {
    const firstRows = [
      documentRow('document-a', '2026-09-01T00:00:00.000Z'),
      documentRow('document-b', '2026-09-04T00:00:00.000Z'),
    ];
    const secondRows = [documentRow('document-c', '2026-09-03T00:00:00.000Z')];
    mocks.listDocuments
      .mockResolvedValueOnce(page({ documents: firstRows, hasMore: true }))
      .mockImplementationOnce(({ cursor }) => page({ documents: secondRows, cursor }));

    const result = await loadAuthorizedDocumentPages({ tenantScope: SCOPE });

    expect(result.map((row) => row.id)).toEqual([
      'document-b', 'document-c', 'document-a',
    ]);
    expect(mocks.listDocuments).toHaveBeenNthCalledWith(1, {
      agencyId: 'agency-a',
      purpose: 'library',
      patientId: null,
      bindingPurpose: null,
      sort: 'document_id_asc',
      pageSize: 10,
      cursor: null,
    });
    expect(mocks.listDocuments.mock.calls[1][0].cursor.after_document_id).toBe('document-b');
  });

  it('resolves a singleton immutable tenant before exposing broker rows', async () => {
    mocks.listDocuments.mockResolvedValue(page({
      documents: [documentRow('document-a', '2026-09-04T00:00:00.000Z')],
    }));
    const { result } = renderHook(() => useAuthorizedDocuments(), { wrapper: wrapper() });

    expect(result.current.data).toEqual([]);
    await waitFor(() => expect(result.current.isSuccess).toBe(true));

    // Scope comes from the bound login context: the hook reaches the broker
    // without ever invoking getMyTenantContext, and the scope handed to the
    // broker wrapper is exactly the bound context's.
    expect(mocks.getTenantContext).not.toHaveBeenCalled();
    expect(mocks.listDocuments).toHaveBeenCalledWith({
      agencyId: 'agency-a',
      purpose: 'library',
      patientId: null,
      bindingPurpose: null,
      sort: 'document_id_asc',
      pageSize: 10,
      cursor: null,
    });
    expect(result.current.data.map((row) => row.id)).toEqual(['document-a']);
    expect(result.current.tenantScope).toEqual(SCOPE);
  });

  it('fires the broker wrapper exactly once on mount', async () => {
    mocks.listDocuments.mockResolvedValue(page({
      documents: [documentRow('document-a', '2026-09-04T00:00:00.000Z')],
    }));
    const { result } = renderHook(() => useAuthorizedDocuments(), { wrapper: wrapper() });

    await waitFor(() => expect(result.current.isSuccess).toBe(true));

    expect(mocks.listDocuments).toHaveBeenCalledTimes(1);
    expect(result.current.data.map((row) => row.id)).toEqual(['document-a']);
  });

  it('serves cached rows on focus and remount inside the stale window without another broker call', async () => {
    mocks.listDocuments.mockResolvedValue(page({
      documents: [documentRow('document-a', '2026-09-04T00:00:00.000Z')],
    }));
    const client = harnessClient();
    const wrap = sharedWrapper(client);
    const first = renderHook(() => useAuthorizedDocuments(), { wrapper: wrap });
    await waitFor(() => expect(first.result.current.isSuccess).toBe(true));
    expect(mocks.listDocuments).toHaveBeenCalledTimes(1);

    // Window focus: the identity query refetches on every focus (its own
    // 'always' policy), which proves the focus event was delivered — while
    // the documents list, still inside its stale window, must not spend
    // another broker invocation on it.
    const authCallsBeforeFocus = mocks.authMe.mock.calls.length;
    await act(async () => {
      // React Query's focus manager keys off visibilitychange/focus.
      window.dispatchEvent(new Event('visibilitychange'));
      window.dispatchEvent(new Event('focus'));
    });
    await act(async () => {});
    expect(mocks.authMe.mock.calls.length).toBeGreaterThan(authCallsBeforeFocus);
    expect(mocks.listDocuments).toHaveBeenCalledTimes(1);
    expect(first.result.current.isSuccess).toBe(true);
    expect(first.result.current.data.map((row) => row.id)).toEqual(['document-a']);
    first.unmount();

    // Remount (a Document Hub tab return): the query survives unmount and
    // its cached rows are served once this mount revalidates identity and
    // scope — again with no broker invocation.
    const second = renderHook(() => useAuthorizedDocuments(), { wrapper: wrap });
    await waitFor(() => expect(second.result.current.isSuccess).toBe(true));
    expect(mocks.listDocuments).toHaveBeenCalledTimes(1);
    expect(second.result.current.data.map((row) => row.id)).toEqual(['document-a']);
    second.unmount();
  });

  it('refetches on the next mount after the uploader invalidation, even inside the stale window', async () => {
    const client = harnessClient();
    const wrap = sharedWrapper(client);
    const first = renderHook(() => useAuthorizedDocuments(), { wrapper: wrap });
    await waitFor(() => expect(first.result.current.isSuccess).toBe(true));
    expect(mocks.listDocuments).toHaveBeenCalledTimes(1);
    first.unmount();

    // The exact call DocumentUploader makes on upload completion; the
    // partial ['documents'] key must still match this query after the
    // policy change, and the invalidation must break the stale window.
    await act(async () => {
      await client.invalidateQueries({ queryKey: ['documents'] });
    });

    const second = renderHook(() => useAuthorizedDocuments(), { wrapper: wrap });
    await waitFor(() => expect(second.result.current.isSuccess).toBe(true));
    expect(mocks.listDocuments).toHaveBeenCalledTimes(2);
    second.unmount();
  });

  it('surfaces a broker 503 with exactly one attempt per mount — the documents query does not retry', async () => {
    mocks.listDocuments.mockRejectedValue(Object.assign(
      new Error('Backend temporarily unavailable'),
      { status: 503 },
    ));
    // No harness retry override: the hook's own retry policy is what keeps
    // this to a single attempt (a bare QueryClient would retry 3 times).
    const client = new QueryClient();
    const { result } = renderHook(
      () => useAuthorizedDocuments(),
      { wrapper: sharedWrapper(client) },
    );

    await waitFor(() => expect(result.current.isError).toBe(true), { timeout: 3000 });
    expect(result.current.data).toEqual([]);
    expect(mocks.listDocuments).toHaveBeenCalledTimes(1);
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 250));
    });
    expect(mocks.listDocuments).toHaveBeenCalledTimes(1);
  });

  it('fails closed when no tenant context is bound for the signed-in principal', async () => {
    clearTrustedTenantContext();
    const { result } = renderHook(() => useAuthorizedDocuments(), { wrapper: wrapper() });

    // With no bound context the hook can never settle successfully: it
    // fabricates no scope, exposes no rows, and reaches neither the tenant
    // endpoint nor the broker — the same closed state as before the fix.
    await waitFor(() => expect(mocks.authMe).toHaveBeenCalled());
    await act(async () => {});
    expect(result.current.isSuccess).toBe(false);
    expect(result.current.data).toEqual([]);
    expect(result.current.tenantScope).toBeNull();
    expect(mocks.getTenantContext).not.toHaveBeenCalled();
    expect(mocks.listDocuments).not.toHaveBeenCalled();
  });

  it('fails closed when the bound context belongs to another principal', async () => {
    clearTrustedTenantContext();
    bindTrustedTenantContext(
      { id: 'user-b', email: 'other@agency.test' },
      tenantContext({
        user_id: 'user-b',
        user_email: 'other@agency.test',
        membership_id: 'membership-b',
        membership_key: 'agency-a:user-b',
      }),
    );
    const { result } = renderHook(() => useAuthorizedDocuments(), { wrapper: wrapper() });

    await waitFor(() => expect(mocks.authMe).toHaveBeenCalled());
    await act(async () => {});
    expect(result.current.isSuccess).toBe(false);
    expect(result.current.data).toEqual([]);
    expect(result.current.tenantScope).toBeNull();
    expect(mocks.getTenantContext).not.toHaveBeenCalled();
    expect(mocks.listDocuments).not.toHaveBeenCalled();
  });

  it('fails closed on broker scope drift and exposes no cached metadata', async () => {
    mocks.listDocuments.mockResolvedValue(page({
      documents: [documentRow('document-a', '2026-09-04T00:00:00.000Z')],
      scope: { ...SCOPE, membership_version: 5 },
    }));
    const { result } = renderHook(
      () => useAuthorizedDocuments({ agencyId: 'agency-a' }),
      { wrapper: wrapper() },
    );

    await waitFor(() => expect(result.current.isError).toBe(true));
    expect(result.current.data).toEqual([]);
    expect(result.current.error.message).toMatch(/scope changed/);
    expect(mocks.getTenantContext).not.toHaveBeenCalled();
  });

  it('rejects operator-shaped tenant input before authentication or listing', async () => {
    const { result } = renderHook(
      () => useAuthorizedDocuments({ agencyId: '$ne' }),
      { wrapper: wrapper() },
    );

    await waitFor(() => expect(result.current.isError).toBe(true));
    expect(result.current.data).toEqual([]);
    expect(result.current.error.message).toMatch(/agencyId/);
    expect(mocks.authMe).not.toHaveBeenCalled();
    expect(mocks.getTenantContext).not.toHaveBeenCalled();
    expect(mocks.listDocuments).not.toHaveBeenCalled();
  });

  it('serves rows normally when settlement completes before the settle deadline', async () => {
    mocks.listDocuments.mockResolvedValue(page({
      documents: [documentRow('document-a', '2026-09-04T00:00:00.000Z')],
    }));
    const { result } = renderHook(
      () => useAuthorizedDocuments({ settleDeadlineMs: 60_000 }),
      { wrapper: wrapper() },
    );

    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(result.current.isError).toBe(false);
    expect(result.current.error).toBeNull();
    expect(result.current.data.map((row) => row.id)).toEqual(['document-a']);
  });

  it('converts an identity fetch that never settles into the existing error state at the deadline', async () => {
    // The 4:21 PM production shape: the identity fetch stays non-terminal
    // with error === null, so no genuine error ever arrives and, without
    // the deadline, the hook would report loading forever.
    mocks.authMe.mockImplementation(() => new Promise(() => {}));
    const { result } = renderHook(
      () => useAuthorizedDocuments({ settleDeadlineMs: 50 }),
      { wrapper: wrapper() },
    );

    expect(result.current.isLoading).toBe(true);
    expect(result.current.isError).toBe(false);

    await waitFor(() => expect(result.current.isError).toBe(true));
    // The same presentation the page already turns into its unavailable
    // banner: isError with an Error, no rows, no scope — and the deadline
    // never enabled the documents query, so the broker was never invoked.
    expect(result.current.error).toBeInstanceOf(Error);
    expect(result.current.error.message).toMatch(/did not complete in time/);
    expect(result.current.status).toBe('error');
    expect(result.current.isLoading).toBe(false);
    expect(result.current.isPending).toBe(false);
    expect(result.current.data).toEqual([]);
    expect(result.current.tenantScope).toBeNull();
    expect(mocks.listDocuments).not.toHaveBeenCalled();
  });

  it('recovers to normal behavior when settlement completes after the deadline fired', async () => {
    let resolveMe;
    mocks.authMe.mockImplementation(
      () => new Promise((resolve) => { resolveMe = resolve; }),
    );
    mocks.listDocuments.mockResolvedValue(page({
      documents: [documentRow('document-a', '2026-09-04T00:00:00.000Z')],
    }));
    const { result } = renderHook(
      () => useAuthorizedDocuments({ settleDeadlineMs: 50 }),
      { wrapper: wrapper() },
    );

    await waitFor(() => expect(result.current.isError).toBe(true));
    expect(result.current.error.message).toMatch(/did not complete in time/);
    expect(mocks.listDocuments).not.toHaveBeenCalled();

    await act(async () => {
      resolveMe({ id: 'user-a', email: 'manager@agency.test' });
    });

    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(result.current.isError).toBe(false);
    expect(result.current.error).toBeNull();
    expect(result.current.data.map((row) => row.id)).toEqual(['document-a']);
    expect(result.current.tenantScope).toEqual(SCOPE);
    expect(mocks.listDocuments).toHaveBeenCalledTimes(1);
  });

  it('arms a fresh deadline per mount: a remount of a hung hook reports loading, not the fired deadline', async () => {
    mocks.authMe.mockImplementation(() => new Promise(() => {}));
    const wrap = sharedWrapper(harnessClient());
    const first = renderHook(
      () => useAuthorizedDocuments({ settleDeadlineMs: 50 }),
      { wrapper: wrap },
    );
    await waitFor(() => expect(first.result.current.isError).toBe(true));
    first.unmount();

    const second = renderHook(
      () => useAuthorizedDocuments({ settleDeadlineMs: 60_000 }),
      { wrapper: wrap },
    );
    expect(second.result.current.isError).toBe(false);
    expect(second.result.current.isLoading).toBe(true);
    second.unmount();
  });

  it('never lets the deadline mask a genuine error that arrives first', async () => {
    mocks.authMe.mockRejectedValue(new Error('identity transport failed'));
    const { result } = renderHook(
      () => useAuthorizedDocuments({ settleDeadlineMs: 50 }),
      { wrapper: wrapper() },
    );

    await waitFor(() => expect(result.current.isError).toBe(true));
    expect(result.current.error.message).toBe('identity transport failed');
    // Past the deadline, the surfaced error is still the genuine one.
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 120));
    });
    expect(result.current.isError).toBe(true);
    expect(result.current.error.message).toBe('identity transport failed');
    expect(mocks.listDocuments).not.toHaveBeenCalled();
  });

  it('settles from the bound authority when the identity cache was seeded before mount and the refetch never lands', async () => {
    // The production ordering from diagnosis #4: AuthContext binds the
    // trusted context (the beforeEach above) and then seeds ['currentUser']
    // by hand BEFORE the hook's observer exists, so the seed is absorbed
    // into the observer's initial state and the mount refetch of auth.me()
    // is the only possible second update. Here that refetch never resolves
    // and never errors — the 5:49 PM calm-window signature that left the
    // shipped hook pending forever. Settlement must come from the bound
    // authority itself: rows served, broker invoked exactly once.
    mocks.authMe.mockImplementation(() => new Promise(() => {}));
    mocks.listDocuments.mockResolvedValue(page({
      documents: [documentRow('document-a', '2026-09-04T00:00:00.000Z')],
    }));
    const client = harnessClient();
    client.setQueryData(['currentUser'], { id: 'user-a', email: 'manager@agency.test' });
    const { result } = renderHook(
      () => useAuthorizedDocuments(),
      { wrapper: sharedWrapper(client) },
    );

    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(mocks.authMe).toHaveBeenCalled();
    expect(mocks.listDocuments).toHaveBeenCalledTimes(1);
    expect(result.current.data.map((row) => row.id)).toEqual(['document-a']);
    expect(result.current.tenantScope).toEqual(SCOPE);
    expect(mocks.getTenantContext).not.toHaveBeenCalled();
  });

  it('seeded identity with no binding stays unsettled until the settle deadline, then errors without a broker call', async () => {
    clearTrustedTenantContext();
    mocks.authMe.mockImplementation(() => new Promise(() => {}));
    const client = harnessClient();
    client.setQueryData(['currentUser'], { id: 'user-a', email: 'manager@agency.test' });
    const { result } = renderHook(
      () => useAuthorizedDocuments({ settleDeadlineMs: 50 }),
      { wrapper: sharedWrapper(client) },
    );

    // Data is present but nothing is bound for this principal: no settle,
    // no scope, no rows — the deadline is the only terminator.
    expect(result.current.isLoading).toBe(true);
    expect(result.current.isError).toBe(false);
    expect(result.current.data).toEqual([]);
    expect(result.current.tenantScope).toBeNull();

    await waitFor(() => expect(result.current.isError).toBe(true));
    expect(result.current.error.message).toMatch(/did not complete in time/);
    expect(result.current.data).toEqual([]);
    expect(result.current.tenantScope).toBeNull();
    expect(mocks.listDocuments).not.toHaveBeenCalled();
    expect(mocks.getTenantContext).not.toHaveBeenCalled();
  });

  it('seeded identity with a binding for a different principal fails closed at the settle deadline', async () => {
    clearTrustedTenantContext();
    bindTrustedTenantContext(
      { id: 'user-b', email: 'other@agency.test' },
      tenantContext({
        user_id: 'user-b',
        user_email: 'other@agency.test',
        membership_id: 'membership-b',
        membership_key: 'agency-a:user-b',
      }),
    );
    mocks.authMe.mockImplementation(() => new Promise(() => {}));
    const client = harnessClient();
    client.setQueryData(['currentUser'], { id: 'user-a', email: 'manager@agency.test' });
    const { result } = renderHook(
      () => useAuthorizedDocuments({ settleDeadlineMs: 50 }),
      { wrapper: sharedWrapper(client) },
    );

    // The binding is exact-principal: another principal's bound context
    // settles nothing for the seeded user.
    expect(result.current.isSuccess).toBe(false);
    expect(result.current.data).toEqual([]);
    expect(result.current.tenantScope).toBeNull();

    await waitFor(() => expect(result.current.isError).toBe(true));
    expect(result.current.error.message).toMatch(/did not complete in time/);
    expect(result.current.data).toEqual([]);
    expect(result.current.tenantScope).toBeNull();
    expect(mocks.listDocuments).not.toHaveBeenCalled();
    expect(mocks.getTenantContext).not.toHaveBeenCalled();
  });

  it('surfaces a genuine identity error over the bound-state settle in the seeded arrangement', async () => {
    // Settlement comes from the binding, but it is not a mask: when the
    // post-mount identity refetch rejects, the genuine error revokes
    // settlement and surfaces — no rows, no scope.
    mocks.authMe.mockRejectedValue(new Error('identity transport failed'));
    const client = harnessClient();
    client.setQueryData(['currentUser'], { id: 'user-a', email: 'manager@agency.test' });
    const { result } = renderHook(
      () => useAuthorizedDocuments(),
      { wrapper: sharedWrapper(client) },
    );

    await waitFor(() => expect(result.current.isError).toBe(true));
    expect(result.current.error.message).toBe('identity transport failed');
    expect(result.current.isSuccess).toBe(false);
    expect(result.current.data).toEqual([]);
    expect(result.current.tenantScope).toBeNull();
  });
});
