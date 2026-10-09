import { beforeEach, describe, expect, it, vi } from 'vitest';

const invoke = vi.hoisted(() => vi.fn());
vi.mock('@/api/base44Client', () => ({ base44: { functions: { invoke } } }));

import {
  EsignClientError,
  cancelSignatureRequest,
  createSignatureRequest,
  listSignatureRequests,
  sendSignatureReminder,
  sendSigningLink,
  settleEsign,
  signDischargeSummary,
  signInPerson,
  updateSignatureFields,
} from '@/lib/esignClient';
import { base64ToBytes, signatureFileFromDataUrl } from '@/lib/signatureFile';

const PNG = `data:image/png;base64,${btoa(String.fromCharCode(...new Uint8Array(120).map((_, index) => index)))}`;

beforeEach(() => {
  invoke.mockReset();
  invoke.mockResolvedValue({ data: { success: true } });
});

describe('esignClient', () => {
  it('names the exact broker and the bound agency for every call', async () => {
    await listSignatureRequests({ agencyId: 'agency-1', status: 'open' });
    expect(invoke).toHaveBeenLastCalledWith('manageSignatureRequests', {
      action: 'list', agency_id: 'agency-1', status: 'open', limit: 200,
    });
    await sendSigningLink({ agencyId: 'agency-1', packageId: 'package-1', signerId: 'signer-1' });
    expect(invoke).toHaveBeenLastCalledWith('generateSignerToken', expect.objectContaining({
      agency_id: 'agency-1', package_id: 'package-1', signer_id: 'signer-1',
    }));
    expect(invoke.mock.lastCall[1]).not.toHaveProperty('rotate');
    await sendSignatureReminder({ agencyId: 'agency-1', packageId: 'package-1', signerId: 'signer-1' });
    expect(invoke.mock.lastCall[0]).toBe('sendSignatureReminder');
    await cancelSignatureRequest({ agencyId: 'agency-1', requestKey: 'a'.repeat(64), reason: 'Wrong address' });
    expect(invoke).toHaveBeenLastCalledWith('manageSignatureRequests', {
      action: 'cancel', agency_id: 'agency-1', request_key: 'a'.repeat(64), reason: 'Wrong address',
    });
    await updateSignatureFields({ agencyId: 'agency-1', documentSignatureId: 'doc-1' }, []);
    expect(invoke).toHaveBeenLastCalledWith('embedAnnotationsToPDF', {
      agency_id: 'agency-1', document_signature_id: 'doc-1', signature_fields: [],
    });
  });

  it('refuses to call any broker without an agency', async () => {
    await expect(createSignatureRequest({ patient_id: 'patient-1' })).rejects.toBeInstanceOf(EsignClientError);
    await expect(listSignatureRequests({ agencyId: '' })).rejects.toThrow(/agency/);
    expect(invoke).not.toHaveBeenCalled();
  });

  it('surfaces the broker’s own message and code, never a raw transport error', async () => {
    invoke.mockRejectedValueOnce({ response: { status: 503, data: { error: 'Signing is not configured', code: 'signature_agreement_not_configured' } } });
    await expect(listSignatureRequests({ agencyId: 'agency-1' })).rejects.toMatchObject({
      message: 'Signing is not configured', code: 'signature_agreement_not_configured', status: 503,
    });
    await expect(settleEsign(Promise.resolve({ data: { success: false } }), 'Fallback')).rejects.toThrow('Fallback');
    await expect(settleEsign(Promise.reject(new Error('socket hang up')), 'Fallback')).rejects.toThrow('Fallback');
  });

  it('sends in-person and discharge signatures as files with their exact modes', async () => {
    const file = signatureFileFromDataUrl(PNG);
    await signInPerson({
      agencyId: 'agency-1', documentSignatureId: 'doc-1', signerId: 'signer-1', typedName: 'Pat Example',
      agreementVersion: 'signature-consent-v1', file, clientRequestId: 'request-1',
    });
    expect(invoke).toHaveBeenLastCalledWith('submitDocumentSignatures', expect.objectContaining({
      mode: 'in_person', identity_confirmed: 'true', signature_file: file, signer_id: 'signer-1',
    }));
    await signDischargeSummary({ agencyId: 'agency-1', dischargeSummaryId: 'summary-1', file, clientRequestId: 'request-2' });
    expect(invoke).toHaveBeenLastCalledWith('submitDocumentSignatures', {
      mode: 'discharge_summary', agency_id: 'agency-1', discharge_summary_id: 'summary-1',
      attestation_version: 'discharge-attestation-v1', client_request_id: 'request-2', signature_file: file,
    });
  });

  it('turns only a real PNG data URL into a signature file', () => {
    const file = signatureFileFromDataUrl(PNG);
    expect(file).toBeInstanceOf(File);
    expect(file.type).toBe('image/png');
    expect(file.size).toBe(120);
    expect(() => signatureFileFromDataUrl('data:image/png;base64,AAAA')).toThrow(/signature/);
    expect(() => signatureFileFromDataUrl('data:image/svg+xml;base64,AAAA')).toThrow(/signature/);
    expect(() => signatureFileFromDataUrl(null)).toThrow(/signature/);
    expect(Array.from(base64ToBytes('AQID'))).toEqual([1, 2, 3]);
  });
});
