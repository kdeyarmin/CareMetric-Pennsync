import { base44 } from '@/api/base44Client';
import { captureTenantSdkRealmLease, assertTenantSdkRealmLeaseCurrent } from '@/lib/tenantSdkRealmGate';

// Legacy document processors consume a URL, but the underlying clinical file
// must remain private. Mint only a short-lived processing capability.
export default async function uploadClinicalFile({ file }) {
  const lease = captureTenantSdkRealmLease();
  assertTenantSdkRealmLeaseCurrent(lease);
  const { file_uri } = await base44.integrations.Core.UploadPrivateFile({ file });
  assertTenantSdkRealmLeaseCurrent(lease);
  if (!file_uri) throw new Error('The clinical file could not be uploaded.');
  const { signed_url } = await base44.integrations.Core.CreateFileSignedUrl({ file_uri, expires_in: 600 });
  assertTenantSdkRealmLeaseCurrent(lease);
  if (!signed_url) throw new Error('The clinical file could not be prepared for processing.');
  return { file_url: signed_url };
}