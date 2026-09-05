import { readFileSync } from 'node:fs';
import path from 'node:path';
import process from 'node:process';
import { describe, expect, it } from 'vitest';

const root = process.cwd();
const read = (relativePath) => readFileSync(path.join(root, relativePath), 'utf8');

const quarantinedHandlers = {
  archiveSignedDocument: 'signed_document_archival_unavailable',
  bulkCreateDocumentPackages: 'bulk_document_packages_unavailable',
  embedAnnotationsToPDF: 'pdf_annotation_embedding_unavailable',
  generateDocumentPackageFromTemplate: 'document_package_generation_unavailable',
  generateSignatureCertificate: 'signature_certificate_unavailable',
  signatureIntegrity: 'signature_integrity_unavailable',
  stampSignatureOnPDF: 'signature_pdf_stamping_unavailable',
  notifyAdminOfSignedDocument: 'signed_document_notification_unavailable',
  onDocumentSigned: 'document_signing_completion_unavailable',
};

const quarantinedEntities = [
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
];

const unsignedFaxSenders = {
  'src/components/fax/DocumentFaxSender.jsx': /await sendFax\(/,
  'src/components/fax/PhotoUploadFaxSender.jsx': /functions\.invoke\('sendFax'/,
  'src/components/fax/EnhancedCameraFaxSender.jsx': /await sendFax\(/,
};

const dormantBulkCreator = 'src/components/documents/BulkDocumentPackageCreator.jsx';

describe('document-signing quarantine contract', () => {
  it('denies every direct operation on signing, token, version, and reminder rows', () => {
    for (const entity of quarantinedEntities) {
      const source = read(`base44/entities/${entity}.jsonc`);
      for (const operation of ['read', 'create', 'update', 'delete']) {
        expect(source, `${entity}.rls.${operation}`).toMatch(
          new RegExp(`"${operation}"\\s*:\\s*false`),
        );
      }
    }
  });

  it('keeps every residual signing backend entry an unconditional inert response', () => {
    for (const [functionName, code] of Object.entries(quarantinedHandlers)) {
      const source = read(`base44/functions/${functionName}/entry.ts`);
      const executableSource = source.replace(/^\s*\/\/.*$/gm, '').trimStart();

      expect(executableSource, functionName).toMatch(/^Deno\.serve\(\(\) => Response\.json\(/);
      expect(source, functionName).toContain(`code: '${code}'`);
      expect(source, functionName).toMatch(/status:\s*503/);
      expect(source, functionName).toMatch(/'Cache-Control':\s*'no-store'/);
      expect(source, functionName).toMatch(/Pragma:\s*'no-cache'/);
      expect(source, functionName).not.toMatch(
        /\b(?:import|await|fetch|createClientFromRequest)\b|\.entities\b|\.integrations\b|\.functions\b|Deno\.serve\(\s*\([^)]/,
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

  it('keeps the dormant bulk signing-package UI static and data-free', () => {
    const source = read(dormantBulkCreator);

    expect(source).toMatch(/<SigningUnavailable title="Bulk document packages unavailable" \/>/);
    expect(source).not.toMatch(/\bbase44\b|useQuery|useScopedPatients|<input|<textarea|bulkCreateDocumentPackages/);
  });

  it('keeps discharge review but removes direct clinician signature capture', () => {
    const workflow = read('src/components/discharge/DischargeSummaryWorkflow.jsx');

    expect(workflow).toMatch(/Clinician signature capture is unavailable/);
    expect(workflow).toMatch(/handleReviewComplete/);
    expect(workflow).not.toMatch(/DigitalSignaturePad|handleSignature|signature_data|status:\s*['"]signed['"]/);
  });
});
