import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { renderHook, waitFor } from '@testing-library/react';
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

describe('authorized Document list boundary', () => {
  beforeEach(() => {
    clearTrustedTenantContext();
    mocks.authMe.mockReset();
    mocks.getTenantContext.mockReset();
    mocks.listDocuments.mockReset();
    mocks.authMe.mockResolvedValue({ id: 'user-a', email: 'manager@agency.test' });
    mocks.getTenantContext.mockResolvedValue({ tenant_context: tenantContext() });
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

    expect(mocks.getTenantContext).toHaveBeenCalledWith({
      agencyId: 'agency-a',
      expectedMembershipId: 'membership-a',
      expectedMembershipVersion: 4,
    });
    expect(result.current.data.map((row) => row.id)).toEqual(['document-a']);
    expect(result.current.tenantScope).toEqual(SCOPE);
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
    expect(mocks.getTenantContext).toHaveBeenCalledWith({
      agencyId: 'agency-a',
      expectedMembershipId: 'membership-a',
      expectedMembershipVersion: 4,
    });
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
});
