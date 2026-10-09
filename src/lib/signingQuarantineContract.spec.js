import { readFileSync } from 'node:fs';
import path from 'node:path';
import process from 'node:process';
import { describe, expect, it } from 'vitest';

const root = process.cwd();
const read = (relativePath) => readFileSync(path.join(root, relativePath), 'utf8');

const releasedStaffBrokers = [
  'archiveSignedDocument',
  'bulkCreateDocumentPackages',
  'embedAnnotationsToPDF',
  'generateDocumentPackageFromTemplate',
  'generateSignatureCertificate',
  'manageSignatureRequests',
  'notifyAdminOfSignedDocument',
  'onDocumentSigned',
  'signatureIntegrity',
  'stampSignatureOnPDF',
  'submitDocumentSignatures',
];

const browserDeniedEntities = [
  'DigitalSignature',
  'DocumentAutomationWorkflow',
  'DocumentPackage',
  'DocumentPackageToken',
  'DocumentSignature',
  'DocumentSignatureTemplate',
  'DocumentVersion',
  'ProviderFollowUpToken',
  'ReminderLog',
  'ScheduledSignatureReminder',
  'SignatureArtifactBinding',
  'SignatureAuditEvent',
  'SignerReviewGrant',
];

const unsignedFaxSenders = {
  'src/components/fax/DocumentFaxSender.jsx': /await sendFax\(/,
  'src/components/fax/PhotoUploadFaxSender.jsx': /functions\.invoke\('sendFax'/,
  'src/components/fax/EnhancedCameraFaxSender.jsx': /await sendFax\(/,
};

describe('document-signing safety contract', () => {
  it('denies every direct operation on signing, token, version, and reminder rows', () => {
    for (const entity of browserDeniedEntities) {
      const source = read(`base44/entities/${entity}.jsonc`);
      for (const operation of ['read', 'create', 'update', 'delete']) {
        expect(source, `${entity}.rls.${operation}`).toMatch(
          new RegExp(`"${operation}"\\s*:\\s*false`),
        );
      }
    }
  });

  it('runs every released staff signing broker through the reviewed authority helper', () => {
    // Released 2026-10-08 (owner decision). What is pinned now is why each
    // broker is safe: a user-scoped client, the caller authenticated before the
    // body is read, membership and chart access decided by the shared
    // e-signature helper, private storage only, and no-store responses.
    for (const functionName of releasedStaffBrokers) {
      const source = read(`base44/functions/${functionName}/entry.ts`);
      const handler = source.slice(source.indexOf('Deno.serve('));

      expect(source, functionName).toContain('BEGIN SHARED HELPER: esignCore');
      expect(handler, functionName).toMatch(
        /createClientFromRequest\(userScopedClientRequest\(req, PENNSYNC_PRODUCTION_APP_ID\)\)/,
      );
      expect(handler.indexOf('await esignLoadCaller(base44)'), functionName).toBeGreaterThan(0);
      expect(handler, functionName).toMatch(/esignStaffAuthority\(/);
      expect(source, functionName).toMatch(/'Cache-Control':\s*'no-store'/);
      expect(source, functionName).not.toMatch(
        /\.UploadFile\(|signed_pdf_url\s*:|document_url\s*:|signature_data\s*:|Deno\.env\.get\('TELNYX/,
      );
    }
  });

  it('removes signature stamping from fax UIs without disabling unsigned fax', () => {
    const signingUiOrCall = /FaxSignaturePanel|stampSignatureOnPDF|signatureDataUrl|setSignatureDataUrl|onSignatureReady/;

    for (const [file, faxCall] of Object.entries(unsignedFaxSenders)) {
      const source = read(file);

      expect(source, file).not.toMatch(signingUiOrCall);
      expect(source, file).toMatch(faxCall);
    }
  });

  it('creates bulk requests one patient at a time through the template broker', () => {
    // Each patient is its own request, so membership and chart access are
    // decided by the broker for that exact chart; the UI reads no signing row.
    const source = read('src/components/documents/BulkDocumentPackageCreator.jsx');
    expect(source).toMatch(/createSignatureRequestFromTemplate\(\{[\s\S]*?patient_id: patientId,/);
    expect(source).toMatch(/for \(const patientId of selected\)/);
    expect(source).not.toMatch(/\bbase44\b|\.entities\.|UploadFile/);
  });

  it('signs a reviewed discharge summary only through the signing broker', () => {
    // 2026-10-08 owner decision: clinician signature capture is on. The
    // browser never writes the signature or the signed status itself; the
    // broker derives the signer from the session, requires chart access and a
    // reviewed summary, stores the image privately and seals the content digest.
    for (const file of [
      'src/components/discharge/DischargeSummaryWorkflow.jsx',
      'src/components/hub-tabs/DischargeSummaries.jsx',
    ]) {
      const source = read(file);
      expect(source, file).not.toMatch(
        /DigitalSignaturePad|signature_data|status:\s*['"]signed['"]|signature:\s*\{/,
      );
      for (const name of browserDeniedEntities) {
        expect(source, `${file} ${name}`).not.toMatch(new RegExp(`entities\\.${name}\\b`));
      }
    }
    const workflow = read('src/components/discharge/DischargeSummaryWorkflow.jsx');
    expect(workflow).toMatch(/signDischargeSummary\(\{[\s\S]*?dischargeSummaryId: summary\?\.id/);
    expect(workflow).toMatch(/disabled=\{!attested \|\| !signatureImage/);
    const client = read('src/lib/esignClient.js');
    expect(client).toMatch(/mode: 'discharge_summary'/);
    expect(client).toMatch(/attestation_version: DISCHARGE_ATTESTATION_VERSION/);
    expect(client).toMatch(/invoke\('submitDocumentSignatures'/);
  });
});
