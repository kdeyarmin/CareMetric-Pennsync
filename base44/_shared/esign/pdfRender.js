// Signed-PDF renderer (pdf-lib). Consumers import PDFDocument, StandardFonts
// and rgb from 'npm:pdf-lib@1.17.1'. Rendering is pure: it reads only the bytes
// and the server-derived signing facts it is handed, never a request body.
const ESIGN_LETTER = [612, 792];
const ESIGN_MARGIN = 54;

// Standard 14 fonts encode WinAnsi only; anything else would throw mid-render.
function esignPdfText(value, max) {
  const text = String(value ?? '').replace(/[\r\n\t]+/g, ' ');
  let out = '';
  for (const character of text) {
    const code = character.codePointAt(0);
    out += (code >= 0x20 && code <= 0x7e) || (code >= 0xa0 && code <= 0xff) ? character : '?';
    if (max && out.length >= max) break;
  }
  return out;
}

function esignWrapText(font, value, size, maxWidth) {
  const words = esignPdfText(value).split(' ');
  const lines = [];
  let line = '';
  for (const word of words) {
    const candidate = line ? line + ' ' + word : word;
    if (font.widthOfTextAtSize(candidate, size) <= maxWidth) {
      line = candidate;
      continue;
    }
    if (line) lines.push(line);
    // Hard-break a single token wider than the column (digests, long emails).
    let rest = word;
    while (font.widthOfTextAtSize(rest, size) > maxWidth && rest.length > 1) {
      let cut = rest.length - 1;
      while (cut > 1 && font.widthOfTextAtSize(rest.slice(0, cut), size) > maxWidth) cut -= 1;
      lines.push(rest.slice(0, cut));
      rest = rest.slice(cut);
    }
    line = rest;
  }
  if (line) lines.push(line);
  return lines.length ? lines : [''];
}

function esignUtcStamp(value) {
  const millis = Date.parse(String(value || ''));
  return Number.isFinite(millis) ? new Date(millis).toISOString().replace('T', ' ').replace(/\.\d{3}Z$/, ' UTC') : 'n/a';
}

function esignRoleLabel(role) {
  return ({
    patient: 'Patient', caregiver: 'Caregiver', legal_representative: 'Legal representative',
    witness: 'Witness', provider: 'Provider',
  })[role] || 'Signer';
}

function esignCaptureLabel(method) {
  return method === 'in_person'
    ? 'In person on an authenticated staff device; drawn signature and typed-name attestation'
    : 'Single-purpose emailed link; drawn signature and typed-name attestation';
}

async function esignEmbedImage(doc, bytes, fileType) {
  return fileType === 'image/jpeg' ? doc.embedJpg(bytes) : doc.embedPng(bytes);
}

async function esignLoadSourcePdf(bytes, fileType) {
  if (fileType === 'application/pdf') {
    // An encrypted PDF throws here; sealing an encrypted source is refused.
    return PDFDocument.load(bytes, { updateMetadata: false });
  }
  if (fileType !== 'image/png' && fileType !== 'image/jpeg') throw new Error('Unsupported source document type');
  const doc = await PDFDocument.create();
  const image = await esignEmbedImage(doc, bytes, fileType);
  const page = doc.addPage(ESIGN_LETTER);
  const maxWidth = ESIGN_LETTER[0] - ESIGN_MARGIN * 2;
  const maxHeight = ESIGN_LETTER[1] - ESIGN_MARGIN * 2;
  const scale = Math.min(maxWidth / image.width, maxHeight / image.height, 1);
  const width = image.width * scale;
  const height = image.height * scale;
  page.drawImage(image, {
    x: (ESIGN_LETTER[0] - width) / 2,
    y: ESIGN_LETTER[1] - ESIGN_MARGIN - height,
    width,
    height,
  });
  return doc;
}

function esignFitImage(image, boxWidth, boxHeight) {
  const scale = Math.min(boxWidth / image.width, boxHeight / image.height);
  return { width: image.width * scale, height: image.height * scale };
}

function esignInitials(name) {
  return esignPdfText(name).split(' ').filter(Boolean).map((part) => part[0].toUpperCase()).join('').slice(0, 4);
}

// Field boxes are page-relative percentages captured by the request builder.
function esignDrawFields(doc, font, fields, signerFacts, preview) {
  const pages = doc.getPages();
  const placed = new Set();
  for (const field of Array.isArray(fields) ? fields : []) {
    const facts = signerFacts.get(field?.signerId);
    if (!facts || (facts.status !== 'completed' && !preview)) continue;
    const pageNumber = Number(field.page || 1);
    if (!Number.isSafeInteger(pageNumber) || pageNumber < 1 || pageNumber > pages.length) continue;
    const page = pages[pageNumber - 1];
    const box = page.getMediaBox();
    const x = box.x + box.width * (Number(field.position?.x) / 100);
    const width = box.width * (Number(field.size?.width) / 100);
    const height = box.height * (Number(field.size?.height) / 100);
    const y = box.y + box.height - box.height * (Number(field.position?.y) / 100) - height;
    if (![x, y, width, height].every(Number.isFinite) || width <= 0 || height <= 0) continue;
    if (facts.status !== 'completed') {
      // Preview only: show where a still-pending signer will sign.
      page.drawRectangle({ x, y, width, height, borderColor: rgb(0.13, 0.23, 0.46), borderWidth: 0.75, opacity: 0.4 });
      const label = esignPdfText((field.label || field.type) + ': ' + facts.signer_name, 80);
      const size = Math.min(8, Math.max(5, height * 0.4));
      page.drawText(label, { x: x + 2, y: y + 2, size, font, color: rgb(0.13, 0.23, 0.46) });
      continue;
    }
    if (field.type === 'signature' && facts.image) {
      const fit = esignFitImage(facts.image, width, height);
      page.drawImage(facts.image, { x, y: y + (height - fit.height) / 2, width: fit.width, height: fit.height });
      placed.add(facts.signer_id);
    } else {
      const text = field.type === 'date'
        ? esignUtcStamp(facts.signed_at).slice(0, 10)
        : field.type === 'initials' ? esignInitials(facts.signer_name) : esignPdfText(facts.signer_name, 120);
      let size = Math.min(14, Math.max(6, height * 0.7));
      while (size > 6 && font.widthOfTextAtSize(text, size) > width) size -= 0.5;
      page.drawText(text, { x: x + 1, y: y + (height - size) / 2 + 1, size, font, color: rgb(0.05, 0.08, 0.2) });
    }
  }
  return placed;
}

function esignCertificateWriter(doc, fonts, preview) {
  let page = null;
  let cursor = 0;
  const width = ESIGN_LETTER[0] - ESIGN_MARGIN * 2;
  const newPage = () => {
    page = doc.addPage(ESIGN_LETTER);
    cursor = ESIGN_LETTER[1] - ESIGN_MARGIN;
    if (preview) {
      page.drawText('PREVIEW - NOT SEALED', {
        x: ESIGN_MARGIN, y: ESIGN_LETTER[1] / 2, size: 44, font: fonts.bold,
        color: rgb(0.85, 0.2, 0.2), opacity: 0.18,
      });
    }
  };
  const ensure = (height) => {
    if (!page || cursor - height < ESIGN_MARGIN) newPage();
  };
  const text = (value, options) => {
    const size = options?.size || 10;
    const font = options?.bold ? fonts.bold : fonts.regular;
    const lines = esignWrapText(font, value, size, width - (options?.indent || 0));
    for (const line of lines) {
      ensure(size + 4);
      page.drawText(line, {
        x: ESIGN_MARGIN + (options?.indent || 0), y: cursor - size, size, font,
        color: options?.muted ? rgb(0.33, 0.4, 0.5) : rgb(0.07, 0.1, 0.17),
      });
      cursor -= size + 4;
    }
  };
  const gap = (height) => { cursor -= height; };
  const rule = () => {
    ensure(8);
    page.drawLine({
      start: { x: ESIGN_MARGIN, y: cursor - 2 }, end: { x: ESIGN_MARGIN + width, y: cursor - 2 },
      thickness: 0.5, color: rgb(0.8, 0.84, 0.9),
    });
    cursor -= 8;
  };
  const image = (embedded, boxWidth, boxHeight) => {
    ensure(boxHeight + 6);
    page.drawRectangle({
      x: ESIGN_MARGIN, y: cursor - boxHeight, width: boxWidth, height: boxHeight,
      borderColor: rgb(0.8, 0.84, 0.9), borderWidth: 0.75,
    });
    if (embedded) {
      const fit = esignFitImage(embedded, boxWidth - 8, boxHeight - 8);
      page.drawImage(embedded, {
        x: ESIGN_MARGIN + 4, y: cursor - boxHeight + 4 + (boxHeight - 8 - fit.height) / 2,
        width: fit.width, height: fit.height,
      });
    }
    cursor -= boxHeight + 6;
  };
  return { text, gap, rule, image, newPage };
}

/**
 * Render the signed PDF: the exact source bytes, every collected signature in
 * its placed fields, and an appended certificate page.
 * input: { sourceBytes, sourceType, fields, signers: [{ signer_id, signer_name,
 *   signer_role, email, status, signed_at, capture_method, agreement_version,
 *   signature_sha256, imageBytes, imageType }], meta: { title, signatureId,
 *   requestKey, sourceSha256, agreementTextSha256, completedAt, agencyName }, preview }
 */
async function esignRenderSignedPdf(input) {
  const doc = await esignLoadSourcePdf(input.sourceBytes, input.sourceType);
  const fonts = {
    regular: await doc.embedFont(StandardFonts.Helvetica),
    bold: await doc.embedFont(StandardFonts.HelveticaBold),
  };
  const facts = new Map();
  for (const signer of input.signers) {
    const image = signer.imageBytes ? await esignEmbedImage(doc, signer.imageBytes, signer.imageType) : null;
    facts.set(signer.signer_id, { ...signer, image });
  }
  esignDrawFields(doc, fonts.regular, input.fields, facts, !!input.preview);

  const meta = input.meta || {};
  const certificate = esignCertificateWriter(doc, fonts, !!input.preview);
  certificate.newPage();
  certificate.text('Electronic Signature Certificate', { size: 18, bold: true });
  certificate.text(input.preview
    ? 'Preview of the signatures collected so far. This copy is not sealed and is not the signed record.'
    : 'This page is part of the sealed signed record produced by PennSync e-signature.', { size: 9, muted: true });
  certificate.gap(6);
  certificate.rule();
  certificate.text('Document: ' + esignPdfText(meta.title || 'Document', 200), { bold: true });
  if (meta.agencyName) certificate.text('Requested by: ' + esignPdfText(meta.agencyName, 200));
  certificate.text('Request reference: ' + esignPdfText(meta.signatureId || ''), { size: 9 });
  certificate.text('Source document SHA-256: ' + esignPdfText(meta.sourceSha256 || ''), { size: 9 });
  if (meta.agreementTextSha256) {
    certificate.text('Electronic signature consent text SHA-256: ' + esignPdfText(meta.agreementTextSha256), { size: 9 });
  }
  certificate.text(input.preview
    ? 'Status: in progress (preview generated ' + esignUtcStamp(meta.completedAt) + ')'
    : 'Completed: ' + esignUtcStamp(meta.completedAt), { size: 10, bold: !input.preview });
  certificate.gap(6);
  for (const signer of facts.values()) {
    certificate.rule();
    certificate.text(esignPdfText(signer.signer_name, 200) + ' - ' + esignRoleLabel(signer.signer_role), { bold: true, size: 11 });
    certificate.text('Email: ' + esignPdfText(signer.email, 320), { size: 9 });
    if (signer.status === 'completed') {
      certificate.text('Signed: ' + esignUtcStamp(signer.signed_at), { size: 9 });
      certificate.text('Method: ' + esignCaptureLabel(signer.capture_method), { size: 9 });
      certificate.text('Consent version: ' + esignPdfText(signer.agreement_version || 'n/a'), { size: 9 });
      certificate.text('Signature image SHA-256: ' + esignPdfText(signer.signature_sha256 || ''), { size: 9 });
      certificate.image(signer.image, 220, 70);
    } else {
      certificate.text('Status: awaiting signature', { size: 9, muted: true });
    }
  }
  certificate.rule();
  certificate.text(input.preview
    ? 'Preview only. The sealed record is produced when every required signer has signed.'
    : 'Integrity: this certificate is bound to the exact source document by its SHA-256 digest. '
      + 'The SHA-256 digest of this sealed PDF is recorded in the PennSync signature audit trail '
      + 'and can be re-verified with Signature Integrity.', { size: 8, muted: true });

  const stamp = new Date(Date.parse(String(meta.completedAt || '')) || Date.now());
  doc.setTitle(esignPdfText((input.preview ? 'PREVIEW - ' : 'Signed - ') + (meta.title || 'Document'), 200));
  doc.setSubject('Electronic signature record');
  doc.setProducer('PennSync e-signature');
  doc.setCreator('PennSync by CareMetric');
  doc.setCreationDate(stamp);
  doc.setModificationDate(stamp);
  return doc.save({ useObjectStreams: false });
}

/** A standalone certificate (no source pages) for an already-sealed request. */
async function esignRenderCertificatePdf(input) {
  const doc = await PDFDocument.create();
  const fonts = {
    regular: await doc.embedFont(StandardFonts.Helvetica),
    bold: await doc.embedFont(StandardFonts.HelveticaBold),
  };
  const meta = input.meta || {};
  const certificate = esignCertificateWriter(doc, fonts, false);
  certificate.newPage();
  certificate.text('Certificate of Electronic Signature Completion', { size: 18, bold: true });
  certificate.gap(6);
  certificate.rule();
  certificate.text('Document: ' + esignPdfText(meta.title || 'Document', 200), { bold: true });
  if (meta.agencyName) certificate.text('Requested by: ' + esignPdfText(meta.agencyName, 200));
  certificate.text('Request reference: ' + esignPdfText(meta.signatureId || ''), { size: 9 });
  certificate.text('Source document SHA-256: ' + esignPdfText(meta.sourceSha256 || ''), { size: 9 });
  certificate.text('Sealed signed PDF SHA-256: ' + esignPdfText(meta.signedSha256 || ''), { size: 9 });
  certificate.text('Completed: ' + esignUtcStamp(meta.completedAt), { size: 10, bold: true });
  for (const signer of input.signers) {
    certificate.rule();
    certificate.text(esignPdfText(signer.signer_name, 200) + ' - ' + esignRoleLabel(signer.signer_role), { bold: true, size: 11 });
    certificate.text('Email: ' + esignPdfText(signer.email, 320), { size: 9 });
    certificate.text('Signed: ' + esignUtcStamp(signer.signed_at), { size: 9 });
    certificate.text('Method: ' + esignCaptureLabel(signer.capture_method), { size: 9 });
    certificate.text('Consent version: ' + esignPdfText(signer.agreement_version || 'n/a'), { size: 9 });
    certificate.text('Signature image SHA-256: ' + esignPdfText(signer.signature_sha256 || ''), { size: 9 });
  }
  if (Array.isArray(input.events) && input.events.length) {
    certificate.rule();
    certificate.text('Audit trail', { bold: true, size: 11 });
    for (const event of input.events) {
      certificate.text(esignUtcStamp(event.occurred_at) + '  ' + esignPdfText(event.label, 160), { size: 8 });
    }
  }
  certificate.rule();
  certificate.text('Generated ' + esignUtcStamp(new Date().toISOString())
    + '. Verify the sealed PDF digest above with Signature Integrity in PennSync.', { size: 8, muted: true });
  doc.setTitle(esignPdfText('Signature certificate - ' + (meta.title || 'Document'), 200));
  doc.setProducer('PennSync e-signature');
  doc.setCreator('PennSync by CareMetric');
  return doc.save({ useObjectStreams: false });
}

function esignBase64(bytes) {
  let binary = '';
  const chunk = 0x8000;
  for (let index = 0; index < bytes.length; index += chunk) {
    binary += String.fromCharCode(...bytes.subarray(index, index + chunk));
  }
  return btoa(binary);
}
