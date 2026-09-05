import { readdirSync, readFileSync, statSync } from 'node:fs';
import path from 'node:path';
import process from 'node:process';
import { describe, expect, it } from 'vitest';

const root = process.cwd();
const read = (relativePath) => readFileSync(path.join(root, relativePath), 'utf8');

function productionSourceFiles(directory = path.join(root, 'src')) {
  return readdirSync(directory).flatMap((name) => {
    const absolute = path.join(directory, name);
    if (statSync(absolute).isDirectory()) return productionSourceFiles(absolute);
    if (!/\.[cm]?[jt]sx?$/.test(name) || /\.(?:spec|test)\.[cm]?[jt]sx?$/.test(name)) return [];
    return [absolute];
  });
}

describe('protected SDK browser-realm contract', () => {
  it('keeps createClient private behind the protected operation membrane', () => {
    const sdkImporters = productionSourceFiles()
      .filter((file) => readFileSync(file, 'utf8').includes("from '@base44/sdk'"))
      .map((file) => path.relative(root, file));
    expect(sdkImporters).toEqual(['src/api/base44Client.js']);

    const client = read('src/api/base44Client.js');
    expect(client).toMatch(/const rawBase44 = lockBase44FunctionRevision\(createClient\(/);
    expect(client).toMatch(/export const base44 = wrapTenantSdkClient\(rawBase44\)/);
    expect(client).not.toMatch(/export\s+(?:const\s+rawBase44\b|\{[^}]*\brawBase44\b)/);

    const gate = read('src/lib/tenantSdkRealmGate.js');
    expect(gate).toMatch(/const protectedClient = wrapProtectedObject\(client\)/);
    expect(gate).toMatch(/const protectedAuth = wrapProtectedObject\(rawAuth\)/);
    expect(gate).toMatch(/pinnedAuthoritySnapshot !== authoritySnapshot[\s\S]*?poison\(\)/);
    expect(gate).toMatch(/epoch \+= 1/);
    expect(gate).toMatch(/const guardArgument = \(argument\) =>/);
    expect(gate).toMatch(/callbackArgs\.map\([\s\S]*?wrapProtectedResult/);
    expect(gate).toMatch(/const subscriptionCleanup = \(value, hadCallbackArgument\) =>/);
    expect(gate).toMatch(/const wrapProtectedResult = \(value, seen = new WeakMap\(\)\) =>/);
    expect(gate).toMatch(/typeof then !== 'function'/);
    expect(gate).toMatch(/browserAuthorityEpochMatches\(pinnedBrowserAuthorityEpoch\)/);
    expect(gate).toMatch(/revokeSharedEpoch\(\);[\s\S]*?runTerminalCleanups\(\);/);
  });

  it('allows only exact tenant bootstrap consumers around the closed gate', () => {
    const allowedTenantAuthorityConsumers = [
      'src/functions/getMyTenantContext.js',
      'src/functions/listMyTenantMemberships.js',
      'src/lib/AuthContext.jsx',
    ];
    const sources = productionSourceFiles();
    const consumers = (symbol) => sources
      .filter((file) => readFileSync(file, 'utf8').includes(symbol))
      .map((file) => path.relative(root, file))
      .filter((file) => file !== 'src/api/base44Client.js')
      .sort();

    expect(consumers('tenantAuthorityClient')).toEqual(allowedTenantAuthorityConsumers);
    expect(consumers('publicCapabilityClient')).toEqual([]);

    const client = read('src/api/base44Client.js');
    for (const exactFunction of [
      'getMyTenantContext',
      'listMyTenantMemberships',
    ]) {
      expect(client, exactFunction).toContain(`'${exactFunction}'`);
    }
    expect(client).not.toMatch(
      /publicCapabilityClient|runPublicCapabilityOperation|submitFollowUpResponse|submitSignerSignature|validateFollowUpToken|validateSignerToken|uploadSignerArtifact|UploadFile/,
    );
    expect(client).not.toMatch(/tenantAuthorityClient[\s\S]{0,500}\binvoke\s*:/);
  });

  it('requires a fresh document realm for another READY agency', () => {
    const auth = read('src/lib/AuthContext.jsx');
    const layout = read('src/components/Layout.jsx');

    expect(auth).toMatch(/closeTenantSdkRealm\(\);[\s\S]{0,500}invalidateAuthorityDraftLeaseForTransition/);
    expect(auth).toMatch(/if \(!openTenantSdkRealm\(nextSnapshot\)\)/);
    expect(auth).toMatch(/browser_authority_change_requires_restart/);
    expect(auth).toMatch(/poisonTenantSdkRealm\(\);[\s\S]{0,200}if \(logoutInProgressRef\.current\)/);
    expect(layout).not.toContain('selectTenant');
    expect(layout).not.toContain('handleTenantChange');
    expect(layout).toContain('Sign out to switch agencies safely.');
  });

  it('does not create a detached ADR PHI print window', () => {
    const checklist = read('src/components/adr/AdrChecklistPanel.jsx');
    expect(checklist).not.toMatch(/window\.open|document\.write|buildChecklistPrintHtml/);
    expect(checklist).toMatch(/Separate print views are unavailable/);
  });

  it('routes every script-opened child context through transition teardown', () => {
    const directOpeners = productionSourceFiles()
      .filter((file) => /window\.open\(/.test(readFileSync(file, 'utf8')))
      .map((file) => path.relative(root, file));
    expect(directOpeners).toEqual([]);

    const auth = read('src/lib/AuthContext.jsx');
    expect(auth).toMatch(/closeTenantSdkRealm\(\);\s*closeAuthorityBoundWindows\(\);/);
    const main = read('src/main.jsx');
    expect(main).toMatch(
      /function installDocumentAuthorityGuards\(\)[\s\S]*?const pendingCleanups = \[\][\s\S]*?const installs = \[[\s\S]*?installAuthorityBoundLinkInterceptor[\s\S]*?installAuthorityBoundFileInputGuard[\s\S]*?installAuthorityBoundFileDropGuard[\s\S]*?installAuthorityBoundClipboard/,
    );
    expect(main).toMatch(
      /for \(const install of installs\)[\s\S]{0,300}const cleanup = install\(\)[\s\S]{0,300}pendingCleanups\.push\(cleanup\)/,
    );
    expect(main).toMatch(
      /catch \(error\)[\s\S]{0,500}pendingCleanups\.reverse\(\)[\s\S]{0,500}terminallyCloseDocumentAuthority\(\)[\s\S]{0,100}throw error/,
    );
    expect(read('src/lib/authorityBoundWindows.js'))
      .toMatch(/const guardedWindowOpen = \(\) => null/);
    expect(read('src/components/utils/pdfExporter.jsx')).toMatch(/isTenantSdkRealmOpen\(\)/);
    expect(read('src/lib/downloadCsv.js')).toMatch(/downloadAuthorityBoundBlob\(blob, filename\)/);
    const blobDownload = read('src/lib/downloadBlob.js');
    expect(blobDownload).toMatch(/captureTenantSdkRealmLease\(\)/);
    expect(blobDownload).toMatch(/assertTenantSdkRealmLeaseCurrent\(lease\)/);

    const publicWindowConsumers = productionSourceFiles()
      .filter((file) => readFileSync(file, 'utf8').includes('openPublicCapabilityWindow'))
      .map((file) => path.relative(root, file))
      .filter((file) => file !== 'src/lib/authorityBoundWindows.js');
    expect(publicWindowConsumers).toEqual([]);
    expect(read('src/components/signer/SignerDocumentSigner.jsx'))
      .toMatch(/Secure document review and signing are unavailable/);
  });

  it('keeps signing and public follow-up browser surfaces static and data-free', () => {
    const staticSurfaces = [
      'src/pages/SignDocument.jsx',
      'src/pages/SignerPortal.jsx',
      'src/pages/ProviderFollowUpPortal.jsx',
      'src/components/hub-tabs/DocumentSignatures.jsx',
      'src/components/hub-tabs/CreateSignatureRequest.jsx',
      'src/components/hub-tabs/BulkSignatureRequests.jsx',
      'src/components/documents/DocumentAnalytics.jsx',
      'src/components/documents/DocumentAuditLogViewer.jsx',
      'src/components/documents/BulkDocumentPackageCreator.jsx',
      'src/components/signer/SignatureRequestCreator.jsx',
      'src/components/signer/SignerPackageViewer.jsx',
      'src/components/signer/SignerDocumentSigner.jsx',
    ];
    const forbiddenCapability = /\bbase44\b|publicCapabilityClient|useQuery|useMutation|SignatureCanvas|dangerouslySetInnerHTML|<iframe|<input|<textarea|pdf_url|document_url|UploadFile/;

    for (const file of staticSurfaces) {
      expect(read(file), file).not.toMatch(forbiddenCapability);
    }
    expect(read('src/pages/SignDocument.jsx')).toMatch(/Document review and signing unavailable/);
    expect(read('src/pages/SignerPortal.jsx')).toMatch(/No token was submitted/);
    expect(read('src/pages/ProviderFollowUpPortal.jsx')).toMatch(/No token was submitted/);

    const directSignatureConsumers = productionSourceFiles()
      .filter((file) => /\b(?:base44\.)?entities\.DocumentSignature\b/.test(readFileSync(file, 'utf8')))
      .map((file) => path.relative(root, file));
    expect(directSignatureConsumers).toEqual([]);
  });

  it('binds every gate instance to the shared browser authority epoch', () => {
    const gate = read('src/lib/tenantSdkRealmGate.js');
    const browserEpoch = read('src/lib/browserAuthorityEpoch.js');
    const appParams = read('src/lib/app-params.js');

    expect(gate).toMatch(/bootstrapBrowserAuthorityEpoch = ensureBrowserAuthorityEpoch\(\)/);
    expect(gate).toMatch(/browserAuthorityEpochMatches\(bootstrapBrowserAuthorityEpoch\)/);
    expect(gate).toMatch(/sharedEpochIsCurrent\(\)/);
    expect(gate).toMatch(/expireForExternalTransition\?\.\(\)/);
    expect(gate).toMatch(/invalidateBrowserAuthorityEpoch\(pinnedBrowserAuthorityEpoch\)/);
    expect(browserEpoch).toContain('pennsync_tenant_browser_authority_epoch_v1');
    expect(browserEpoch).toContain('pennsync_tenant_browser_authority_revoked_v1:');
    expect(browserEpoch).toMatch(/storage\.getItem\(revocationKey\(expected\)\) !== '1'/);
    expect(appParams).toMatch(/invalidateBrowserAuthorityEpoch\(\)/);
  });
});
