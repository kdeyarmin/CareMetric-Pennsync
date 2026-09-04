import { beforeEach, describe, expect, it, vi } from 'vitest';

const invoke = vi.fn();
vi.mock('@/api/base44Client', () => ({
  base44: { functions: { invoke: (...args) => invoke(...args) } },
}));

import { getAuthorizedDocument } from './getAuthorizedDocument';
import { listAuthorizedDocuments } from './listAuthorizedDocuments';

const memberScope = {
  agency_id: 'agency-a',
  membership_id: 'membership-a',
  membership_version: 2,
  tenant_role: 'clinician',
};

const metadataDocument = (overrides = {}) => ({
  id: 'document-a',
  title: 'Document-a.pdf',
  description: null,
  file_name: 'Document-a.pdf',
  file_size: 1024,
  file_type: 'application/pdf',
  category: 'other',
  patient_id: 'patient-a',
  tags: ['patient_document'],
  document_date: '2026-09-03',
  is_sensitive: true,
  expiration_date: null,
  is_signed: false,
  is_locked: false,
  updated_date: '2026-09-03T15:00:00.000Z',
  ...overrides,
});

const libraryDocument = (id = 'document-a', overrides = {}) => ({
  id,
  title: `${id}.pdf`,
  file_name: `${id}.pdf`,
  file_size: 1024,
  file_type: 'application/pdf',
  category: 'other',
  patient_id: 'patient-a',
  document_date: '2026-09-03',
  is_sensitive: true,
  expiration_date: null,
  is_signed: false,
  is_locked: false,
  updated_date: '2026-09-03T15:00:00.000Z',
  ...overrides,
});

const cursor = (overrides = {}) => ({
  version: 1,
  after_document_id: 'document-a',
  agency_id: 'agency-a',
  purpose: 'library',
  patient_id: 'patient-a',
  binding_purpose: null,
  sort: 'document_id_asc',
  page_size: 1,
  subject_user_id: 'user-1',
  membership_id: 'membership-a',
  membership_version: 2,
  tenant_role: 'clinician',
  ...overrides,
});

describe('authorized Document read wrappers', () => {
  beforeEach(() => invoke.mockReset());

  it('invokes the exact broker with a finite purpose and validates its full envelope', async () => {
    invoke.mockResolvedValue({
      data: {
        success: true,
        purpose: 'metadata',
        document: metadataDocument(),
        scope: memberScope,
      },
    });
    const result = await getAuthorizedDocument({
      agencyId: 'agency-a', documentId: 'document-a', purpose: 'metadata',
    });
    expect(invoke).toHaveBeenCalledWith('getAuthorizedDocument', {
      agency_id: 'agency-a', document_id: 'document-a', purpose: 'metadata',
    });
    expect(result.document.id).toBe('document-a');
  });

  it('rejects invalid exact-read input before invoking Base44', async () => {
    await expect(getAuthorizedDocument({
      agencyId: 'agency-a', documentId: { $ne: null }, purpose: 'metadata',
    })).rejects.toThrow(/documentId/);
    await expect(getAuthorizedDocument({
      agencyId: 'agency-a', documentId: 'document-a', purpose: 'all_fields',
    })).rejects.toThrow(/purpose/);
    await expect(getAuthorizedDocument({
      agencyId: 'agency-a', documentId: 'document-a', purpose: 'download',
    })).rejects.toThrow(/purpose/);
    await expect(getAuthorizedDocument({
      agencyId: 'agency-a', documentId: 'document-a', purpose: 'metadata', fields: ['file_url'],
    })).rejects.toThrow(/unsupported/);
    expect(invoke).not.toHaveBeenCalled();
  });

  it('rejects false-success exact envelopes, extra fields, and scope drift', async () => {
    for (const payload of [
      {
        success: true,
        purpose: 'metadata',
        document: { ...metadataDocument(), file_url: 'https://files.base44.app/leak.pdf' },
        scope: memberScope,
      },
      {
        success: true,
        purpose: 'metadata',
        document: metadataDocument({ id: 'document-b' }),
        scope: memberScope,
      },
      {
        success: true,
        purpose: 'metadata',
        document: metadataDocument({ updated_date: 'not-a-date' }),
        scope: memberScope,
      },
      {
        success: true,
        purpose: 'metadata',
        document: metadataDocument(),
        scope: { ...memberScope, membership_version: null },
      },
    ]) {
      invoke.mockResolvedValueOnce({ data: payload });
      await expect(getAuthorizedDocument({
        agencyId: 'agency-a', documentId: 'document-a', purpose: 'metadata',
      })).rejects.toThrow(/lookup failed/);
    }
  });

  it('invokes the list broker with explicit scope and accepts a bounded final page', async () => {
    invoke.mockResolvedValue({
      data: {
        success: true,
        purpose: 'library',
        documents: [libraryDocument()],
        scope: { ...memberScope, patient_id: 'patient-a' },
        page: {
          page_size: 10,
          sort: 'document_id_asc',
          after_document_id: null,
          scanned_count: 1,
          returned_count: 1,
          has_more: false,
          next_cursor: null,
        },
      },
    });
    const result = await listAuthorizedDocuments({
      agencyId: 'agency-a', purpose: 'library', patientId: 'patient-a',
    });
    expect(invoke).toHaveBeenCalledWith('listAuthorizedDocuments', {
      agency_id: 'agency-a',
      purpose: 'library',
      patient_id: 'patient-a',
      binding_purpose: null,
      sort: 'document_id_asc',
      page_size: 10,
      cursor: null,
    });
    expect(result.documents).toHaveLength(1);
  });

  it('accepts only a context-bound keyset continuation returned by the broker', async () => {
    const nextCursor = cursor();
    invoke.mockResolvedValue({
      data: {
        success: true,
        purpose: 'library',
        documents: [libraryDocument()],
        scope: { ...memberScope, patient_id: 'patient-a' },
        page: {
          page_size: 1,
          sort: 'document_id_asc',
          after_document_id: null,
          scanned_count: 1,
          returned_count: 1,
          has_more: true,
          next_cursor: nextCursor,
        },
      },
    });
    await expect(listAuthorizedDocuments({
      agencyId: 'agency-a',
      purpose: 'library',
      patientId: 'patient-a',
      pageSize: 1,
    })).resolves.toMatchObject({ page: { has_more: true } });

    await expect(listAuthorizedDocuments({
      agencyId: 'agency-a',
      purpose: 'library',
      patientId: 'patient-b',
      pageSize: 1,
      cursor: nextCursor,
    })).rejects.toThrow(/cursor/);
  });

  it('rejects invalid list input before invocation', async () => {
    await expect(listAuthorizedDocuments({
      agencyId: '$agency', purpose: 'library', patientId: 'patient-a',
    })).rejects.toThrow(/agencyId/);
    await expect(listAuthorizedDocuments({
      agencyId: 'agency-a', purpose: 'download', patientId: 'patient-a',
    })).rejects.toThrow(/purpose/);
    await expect(listAuthorizedDocuments({
      agencyId: 'agency-a', purpose: 'library', patientId: ' patient-a',
    })).rejects.toThrow(/patientId/);
    await expect(listAuthorizedDocuments({
      agencyId: 'agency-a', purpose: 'library', patientId: 'patient-a', pageSize: 11,
    })).rejects.toThrow(/pageSize/);
    await expect(listAuthorizedDocuments({
      agencyId: 'agency-a', purpose: 'library', patientId: 'patient-a', search: 'secret',
    })).rejects.toThrow(/unsupported/);
  });

  it('rejects list projection, ordering, count, page, and tenant-scope drift', async () => {
    const base = {
      success: true,
      purpose: 'library',
      documents: [libraryDocument()],
      scope: { ...memberScope, patient_id: 'patient-a' },
      page: {
        page_size: 10,
        sort: 'document_id_asc',
        after_document_id: null,
        scanned_count: 1,
        returned_count: 1,
        has_more: false,
        next_cursor: null,
      },
    };
    const invalid = [
      { ...base, documents: [{ ...libraryDocument(), file_url: 'https://files.base44.app/leak.pdf' }] },
      {
        ...base,
        documents: [libraryDocument('document-b'), libraryDocument('document-a')],
        page: { ...base.page, scanned_count: 2, returned_count: 2 },
      },
      { ...base, scope: { ...base.scope, agency_id: 'agency-b' } },
      { ...base, page: { ...base.page, returned_count: 0 } },
      { ...base, page: { ...base.page, has_more: true, next_cursor: cursor() } },
    ];
    for (const payload of invalid) {
      invoke.mockResolvedValueOnce({ data: payload });
      await expect(listAuthorizedDocuments({
        agencyId: 'agency-a', purpose: 'library', patientId: 'patient-a',
      })).rejects.toThrow(/list failed/);
    }

    invoke.mockResolvedValueOnce({
      data: {
        ...base,
        documents: [],
        scope: { ...memberScope, patient_id: null },
        page: {
          ...base.page,
          scanned_count: 0,
          returned_count: 0,
        },
      },
    });
    await expect(listAuthorizedDocuments({
      agencyId: 'agency-a', purpose: 'library', patientId: null,
    })).rejects.toThrow(/list failed/);
  });

  it('rejects continuation rollback, scope drift, short non-final pages, and subject drift', async () => {
    const suppliedCursor = cursor({ after_document_id: 'document-b' });
    const continuationBase = {
      success: true,
      purpose: 'library',
      documents: [libraryDocument('document-c')],
      scope: { ...memberScope, patient_id: 'patient-a' },
      page: {
        page_size: 1,
        sort: 'document_id_asc',
        after_document_id: 'document-b',
        scanned_count: 1,
        returned_count: 1,
        has_more: false,
        next_cursor: null,
      },
    };
    const invalidContinuations = [
      {
        ...continuationBase,
        documents: [libraryDocument('document-a')],
      },
      {
        ...continuationBase,
        scope: {
          ...continuationBase.scope,
          membership_version: 3,
        },
      },
      {
        ...continuationBase,
        documents: [libraryDocument('document-c')],
        page: {
          ...continuationBase.page,
          page_size: 2,
          has_more: true,
          next_cursor: cursor({
            after_document_id: 'document-c',
            page_size: 2,
          }),
        },
      },
      {
        ...continuationBase,
        page: {
          ...continuationBase.page,
          has_more: true,
          next_cursor: cursor({
            after_document_id: 'document-c',
            subject_user_id: 'user-2',
          }),
        },
      },
    ];

    for (const [index, payload] of invalidContinuations.entries()) {
      invoke.mockResolvedValueOnce({ data: payload });
      await expect(listAuthorizedDocuments({
        agencyId: 'agency-a',
        purpose: 'library',
        patientId: 'patient-a',
        pageSize: index === 2 ? 2 : 1,
        cursor: index === 2
          ? cursor({ after_document_id: 'document-b', page_size: 2 })
          : suppliedCursor,
      })).rejects.toThrow(/list failed/);
    }
  });
});
