import { beforeEach, describe, expect, it, vi } from 'vitest';
const mocks = vi.hoisted(() => ({ upload: vi.fn(), sign: vi.fn(), assert: vi.fn(), lease: {} }));
vi.mock('@/api/base44Client', () => ({ base44: { integrations: { Core: { UploadPrivateFile: mocks.upload, CreateFileSignedUrl: mocks.sign } } } }));
vi.mock('@/lib/tenantSdkRealmGate', () => ({ captureTenantSdkRealmLease: () => mocks.lease, assertTenantSdkRealmLeaseCurrent: mocks.assert }));
import uploadClinicalFile from './uploadClinicalFile';
describe('private clinical processing uploads', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.assert.mockReset();
    mocks.upload.mockResolvedValue({ file_uri: 'private-file' });
    mocks.sign.mockResolvedValue({ signed_url: 'https://example.invalid/temporary' });
  });
  it('uploads privately and signs a temporary processing link', async () => {
    const file = new Blob(['audio']);
    expect(await uploadClinicalFile({ file })).toEqual({ file_url: 'https://example.invalid/temporary' });
    expect(mocks.upload).toHaveBeenCalledWith({ file });
    expect(mocks.sign).toHaveBeenCalledWith({ file_uri: 'private-file', expires_in: 600 });
  });
  it('does not sign after workspace authority changes', async () => {
    mocks.assert.mockImplementationOnce(() => {}).mockImplementationOnce(() => { throw new Error('stale'); });
    await expect(uploadClinicalFile({ file: new Blob() })).rejects.toThrow('stale');
    expect(mocks.sign).not.toHaveBeenCalled();
  });
  it('refuses a missing upload locator', async () => {
    mocks.upload.mockResolvedValue({});
    await expect(uploadClinicalFile({ file: new Blob() })).rejects.toThrow('could not be uploaded');
    expect(mocks.sign).not.toHaveBeenCalled();
  });
});