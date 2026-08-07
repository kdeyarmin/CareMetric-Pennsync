import { createClientFromRequest } from 'npm:@base44/sdk@0.8.31';
import { jsPDF } from 'npm:jspdf@4.0.0';
import { PDFDocument, StandardFonts, degrees, rgb } from 'npm:pdf-lib@1.17.1';

// generateAdrPacket — assemble the submission-ready ADR response packet for an
// AdrAuditCase:
//   Part 1 (generated front matter, jsPDF): cover page with the audit metadata
//     and an HONEST readiness banner, a computed table of contents (every
//     requirement -> final page number or MISSING), and an outstanding-items
//     sheet listing everything still missing/deficient with its CMS citation.
//   Part 2 (the agency's uploaded packet, pdf-lib): merged behind the front
//     matter, every page stamped "Page X of Y", and the pages where critical/
//     high-severity evidence begins framed in red with a labeled banner so the
//     Medicare reviewer lands on the key documents immediately.
//
// The TOC/key-page/follow-up content is NOT recomputed here — it renders the
// deterministic verification_summary persisted by the ADR Center flow
// (src/components/adr/adrPacketReview.js), so what staff reviewed on screen is
// exactly what prints. Page numbers shown in the TOC are packet-relative pages
// offset by the front-matter page count (two-pass render: pass 1 counts front-
// matter pages, pass 2 draws the real numbers).

// <<<BEGIN SHARED HELPER: isSafeFetchUrl — generated, edit base44/_shared/backendHelpers.mjs>>>
// SSRF guard: only fetch https URLs on the app's own storage/app hosts, never
// internal IPs / metadata. The allowlist is hardcoded (always-on, fail-closed)
// rather than env-configured; add a host here if file storage ever moves.
const FILE_URL_ALLOWED_HOSTS = ['qtrypzzcjebvfcihiynt.supabase.co', 'base44.app', 'base44.io'];
function isSafeFetchUrl(raw) {
  let u;
  try { u = new URL(String(raw)); } catch { return false; }
  if (u.protocol !== 'https:') return false;
  const host = u.hostname.toLowerCase();
  if (['localhost', '0.0.0.0', '127.0.0.1', '::1', '169.254.169.254'].includes(host)) return false;
  if (host.endsWith('.internal') || host.endsWith('.local')) return false;
  const m = host.match(/^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/);
  if (m) {
    const a = +m[1], b = +m[2];
    if (a === 10 || a === 127 || (a === 169 && b === 254) || (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168)) return false;
  }
  if (!FILE_URL_ALLOWED_HOSTS.some((h) => host === h || host.endsWith('.' + h))) return false;
  return true;
}
// <<<END SHARED HELPER: isSafeFetchUrl>>>

// <<<BEGIN SHARED HELPER: requireActiveUser — generated, edit base44/_shared/backendHelpers.mjs>>>
const isDeactivatedUser = (u) => !!u && u.is_active === false;
const DEACTIVATED_USER_RESPONSE = () => Response.json(
  { error: 'Unauthorized - account is deactivated' },
  { status: 403 },
);
// <<<END SHARED HELPER: requireActiveUser>>>


// Fetch that re-validates every redirect hop against isSafeFetchUrl. With the
// default redirect:'follow' the guard only checks the FIRST URL, so an
// allowlisted host that 3xx-redirects to an internal/metadata IP would still be
// fetched (SSRF). Returns null if a hop resolves to a disallowed host.
async function safeFetchFollow(initialUrl) {
  let response;
  let nextUrl = initialUrl;
  for (let hop = 0; hop < 4; hop++) {
    response = await fetch(nextUrl, { redirect: 'manual' });
    if (response.status >= 300 && response.status < 400) {
      const location = response.headers.get('location');
      if (!location) break;
      const resolved = new URL(location, nextUrl).toString();
      if (!isSafeFetchUrl(resolved)) return null;
      nextUrl = resolved;
      continue;
    }
    break;
  }
  return response;
}

const NAVY = [33, 58, 118];
const RED = [185, 28, 28];
const SLATE = [71, 85, 105];
const INK = [15, 23, 42];

// Mirrors AUDIT_TYPES in src/components/adr/adrRequirements.js — the printed
// program name must match what the screen shows.
const AUDIT_TYPE_LABELS = {
  mac_adr: 'MAC ADR (prepayment/postpayment medical review)',
  tpe: 'Targeted Probe & Educate (TPE)',
  rcd: 'Review Choice Demonstration (RCD)',
  upic: 'UPIC investigation',
  smrc: 'SMRC review',
  cert: 'CERT audit',
  ra: 'Recovery Auditor (RAC)',
  managed_care: 'Medicare Advantage / managed-care audit',
  state_survey: 'State survey / other',
  other: 'Other documentation request',
};

const STATUS_LABELS = { found: 'Included', partial: 'PARTIAL', missing: 'MISSING', not_applicable: 'N/A' };

/**
 * Render the generated front matter into a jsPDF doc. `offset` is the number
 * of front-matter pages that will precede the packet (0 on the counting pass).
 * Returns the number of pages rendered.
 */
function renderFrontMatter(doc, adrCase, summary, offset, packetPageCount = Infinity) {
  const pageWidth = doc.internal.pageSize.getWidth();
  const pageHeight = doc.internal.pageSize.getHeight();
  const margin = 16;
  const lineHeight = 5.4;
  let yPos = 20;

  const checkPageBreak = (needed = 14) => {
    if (yPos + needed > pageHeight - 18) {
      doc.addPage();
      yPos = 20;
      return true;
    }
    return false;
  };
  const addText = (text, fontSize = 10, isBold = false, color = INK, x = margin, maxWidth = pageWidth - margin * 2) => {
    doc.setFontSize(fontSize);
    doc.setFont('helvetica', isBold ? 'bold' : 'normal');
    doc.setTextColor(...color);
    const lines = doc.splitTextToSize(String(text), maxWidth);
    checkPageBreak(lines.length * lineHeight + 2);
    doc.text(lines, x, yPos);
    yPos += lines.length * lineHeight;
  };
  const addSectionHeader = (title, color = NAVY) => {
    checkPageBreak(16);
    doc.setFillColor(...color);
    doc.rect(margin - 6, yPos - 5.5, pageWidth - (margin - 6) * 2, 10, 'F');
    doc.setTextColor(255, 255, 255);
    doc.setFontSize(12);
    doc.setFont('helvetica', 'bold');
    doc.text(title, margin, yPos + 1);
    yPos += 12;
    doc.setTextColor(...INK);
  };

  // ── Cover page ────────────────────────────────────────────────────────────
  doc.setFillColor(...NAVY);
  doc.rect(0, 0, pageWidth, 34, 'F');
  doc.setTextColor(255, 255, 255);
  doc.setFontSize(20);
  doc.setFont('helvetica', 'bold');
  doc.text('ADR Response Packet', pageWidth / 2, 16, { align: 'center' });
  doc.setFontSize(10);
  doc.setFont('helvetica', 'normal');
  doc.text('Medical Review Documentation Response', pageWidth / 2, 24, { align: 'center' });
  yPos = 46;

  const rows = [
    ['Review program', AUDIT_TYPE_LABELS[adrCase.audit_type] || AUDIT_TYPE_LABELS.other],
    ['Reviewing contractor', adrCase.contractor_name],
    ['Beneficiary', adrCase.patient_name],
    ['Medicare number (MBI)', adrCase.medicare_number],
    ['Claim / DCN', adrCase.claim_number],
    ['Dates of service', adrCase.dates_of_service],
    ['Letter date', adrCase.letter_date],
    ['Response due', adrCase.response_due_date],
  ];
  for (const [key, value] of rows) {
    if (!value) continue;
    // Wrap with the same font state the value is drawn in (splitTextToSize
    // measures with the ACTIVE font), and advance by the real block height so
    // a long contractor name / DOS range cannot collide with the next row.
    doc.setFontSize(10);
    doc.setFont('helvetica', 'normal');
    const valueLines = doc.splitTextToSize(String(value), pageWidth - margin * 2 - 58);
    checkPageBreak(valueLines.length * lineHeight + 2);
    doc.setFont('helvetica', 'bold');
    doc.setTextColor(...SLATE);
    doc.text(`${key}:`, margin, yPos);
    doc.setFont('helvetica', 'normal');
    doc.setTextColor(...INK);
    doc.text(valueLines, margin + 58, yPos);
    yPos += Math.max(7, valueLines.length * lineHeight + 1.6);
  }
  yPos += 4;

  const readiness = summary.readiness || {};
  const counts = `${summary.found_count ?? 0} located · ${summary.partial_count ?? 0} partial · ${summary.missing_count ?? 0} missing${summary.na_count ? ` · ${summary.na_count} N/A` : ''} of ${(summary.items || []).length} required items`;
  if (readiness.level === 'ready') {
    doc.setFillColor(239, 253, 244);
    doc.setDrawColor(134, 239, 172);
    doc.roundedRect(margin - 2, yPos - 4, pageWidth - (margin - 2) * 2, 20, 2, 2, 'FD');
    doc.setTextColor(21, 128, 61);
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(11);
    doc.text('Verification: all required items were located in this packet.', margin + 4, yPos + 3);
    doc.setFont('helvetica', 'normal');
    doc.setFontSize(9);
    doc.text(counts, margin + 4, yPos + 10);
  } else {
    doc.setFillColor(254, 242, 242);
    doc.setDrawColor(...RED);
    doc.roundedRect(margin - 2, yPos - 4, pageWidth - (margin - 2) * 2, 26, 2, 2, 'FD');
    doc.setTextColor(...RED);
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(11);
    const headline = readiness.level === 'not_ready'
      ? 'NOT SUBMISSION-READY: required documentation is missing or deficient.'
      : 'Needs attention before submission — see Outstanding Items.';
    doc.text(doc.splitTextToSize(headline, pageWidth - margin * 2 - 8), margin + 4, yPos + 3);
    doc.setFont('helvetica', 'normal');
    doc.setFontSize(9);
    doc.text(counts, margin + 4, yPos + 15);
    doc.text('Review the Outstanding Items page before sending this packet.', margin + 4, yPos + 20);
  }
  yPos += 34;

  addText('Key documents inside this packet are framed in red with a labeled banner so the reviewer can locate the evidence for each requirement quickly. Page numbers below refer to this assembled packet.', 9, false, SLATE);
  yPos += 2;
  addText('Assembled with AI-assisted verification. The agency remains responsible for confirming every document before submission.', 8, false, SLATE);

  // ── Table of contents ─────────────────────────────────────────────────────
  doc.addPage();
  yPos = 20;
  addSectionHeader('Table of Contents');
  doc.setFontSize(9);
  doc.setFont('helvetica', 'bold');
  doc.setTextColor(...SLATE);
  checkPageBreak(8);
  doc.text('Requirement', margin, yPos);
  doc.text('Status', pageWidth - margin - 40, yPos);
  doc.text('Page', pageWidth - margin, yPos, { align: 'right' });
  yPos += 6;

  for (const entry of summary.toc || []) {
    const titleWidth = pageWidth - margin * 2 - 52;
    // splitTextToSize measures with the ACTIVE font — set the draw font before
    // wrapping or the widths lie and text overprints the status/page columns.
    doc.setFontSize(9.5);
    doc.setFont('helvetica', 'bold');
    const titleLines = doc.splitTextToSize(String(entry.title || ''), titleWidth);
    const citation = String(entry.citation || '');
    doc.setFontSize(7.5);
    doc.setFont('helvetica', 'normal');
    const citationLines = citation ? doc.splitTextToSize(citation, titleWidth) : [];
    const blockHeight = (titleLines.length + citationLines.length) * 4.6 + 3.5;
    checkPageBreak(blockHeight);

    const missing = entry.status === 'missing';
    doc.setFontSize(9.5);
    doc.setFont('helvetica', 'bold');
    doc.setTextColor(...(missing ? RED : INK));
    doc.text(titleLines, margin, yPos);
    doc.setFontSize(9);
    doc.setTextColor(...(missing ? RED : SLATE));
    doc.text(STATUS_LABELS[entry.status] || '—', pageWidth - margin - 40, yPos);
    doc.setTextColor(...(missing ? RED : INK));
    // Clamp against the REAL packet: a hallucinated page number (possible when
    // the client's local page count failed and the AI's own count was the
    // fallback) must not print a TOC reference past the end of the final PDF.
    const tocPage = Number(entry.packet_page);
    const tocPageValid = Number.isInteger(tocPage) && tocPage >= 1 && tocPage <= packetPageCount;
    doc.text(tocPageValid ? String(offset + tocPage) : '—', pageWidth - margin, yPos, { align: 'right' });
    yPos += titleLines.length * 4.6;
    if (citationLines.length) {
      doc.setFont('helvetica', 'normal');
      doc.setFontSize(7.5);
      doc.setTextColor(...SLATE);
      doc.text(citationLines, margin, yPos);
      yPos += citationLines.length * 4.0;
    }
    yPos += 2.5;
  }

  // ── Outstanding items ─────────────────────────────────────────────────────
  const followUps = summary.follow_ups || [];
  const observations = summary.overall_observations || [];
  if (followUps.length || observations.length) {
    doc.addPage();
    yPos = 20;
    addSectionHeader('Outstanding Items — Action Required', RED);
    addText('The following gaps were identified when this packet was verified against the ADR requirements. Resolve each item (or document why it does not apply) before submitting the response.', 9, false, SLATE);
    yPos += 2;
    followUps.forEach((fu, idx) => {
      doc.setFontSize(9.5);
      doc.setFont('helvetica', 'bold');
      const actionLines = doc.splitTextToSize(`${idx + 1}. [${String(fu.severity || '').toUpperCase()}] ${fu.action || fu.title || ''}`, pageWidth - margin * 2);
      doc.setFontSize(8);
      doc.setFont('helvetica', 'normal');
      const whyLines = doc.splitTextToSize(`${fu.why || ''}  (${fu.citation || 'no citation'})`, pageWidth - margin * 2 - 6);
      checkPageBreak(actionLines.length * 4.8 + whyLines.length * 4.2 + 4);
      doc.setFontSize(9.5);
      doc.setFont('helvetica', 'bold');
      doc.setTextColor(...(fu.severity === 'critical' ? RED : INK));
      doc.text(actionLines, margin, yPos);
      yPos += actionLines.length * 4.8;
      doc.setFontSize(8);
      doc.setFont('helvetica', 'normal');
      doc.setTextColor(...SLATE);
      doc.text(whyLines, margin + 6, yPos);
      yPos += whyLines.length * 4.2 + 3;
    });
    if (observations.length) {
      yPos += 3;
      addText('Packet-level observations:', 10, true);
      for (const obs of observations) {
        addText(`• ${obs}`, 9, false, SLATE);
      }
    }
  }

  return doc.internal.getNumberOfPages();
}

Deno.serve(async (req) => {
  try {
    const base44 = createClientFromRequest(req);
    const user = await base44.auth.me().catch(() => null);
    if (isDeactivatedUser(user)) return DEACTIVATED_USER_RESPONSE();
    if (!user) {
      return Response.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const { case_id } = await req.json();
    if (!case_id) {
      return Response.json({ error: 'Missing case_id' }, { status: 400 });
    }

    // User-context read: RLS limits this to the caller's own cases (+ admins),
    // so the packet fetched below is one the caller is authorized to handle.
    const cases = await base44.entities.AdrAuditCase.filter({ id: case_id }, undefined, 5000);
    if (!cases || cases.length === 0) {
      return Response.json({ error: 'ADR case not found' }, { status: 404 });
    }
    const adrCase = cases[0];

    const summary = adrCase.verification_summary;
    if (!adrCase.packet_file_url || !summary || !Array.isArray(summary.items)) {
      return Response.json({
        error: 'Case is not ready: upload the response packet and run verification first',
      }, { status: 400 });
    }
    // The persisted summary describes the packet only while the case is in a
    // verified state. A re-uploaded packet moves the case back to
    // 'packet_uploaded' before verification runs — generating from the OLD
    // summary would stamp key-item frames and a TOC that describe a different
    // file ('packet_generated' stays allowed for the Regenerate flow).
    if (!['packet_verified', 'packet_generated'].includes(adrCase.status)) {
      return Response.json({
        error: 'The packet was re-uploaded but not verified — run verification before generating',
      }, { status: 400 });
    }
    if (!isSafeFetchUrl(adrCase.packet_file_url)) {
      return Response.json({ error: 'Case packet has an invalid or disallowed file URL' }, { status: 400 });
    }

    const packetResponse = await safeFetchFollow(adrCase.packet_file_url);
    if (!packetResponse) {
      return Response.json({ error: 'Packet URL redirected to a disallowed host' }, { status: 400 });
    }
    if (!packetResponse.ok) {
      return Response.json({ error: 'Failed to fetch the uploaded packet' }, { status: 502 });
    }
    const packetBytes = await packetResponse.arrayBuffer();
    let packetPdf;
    try {
      packetPdf = await PDFDocument.load(packetBytes, { ignoreEncryption: true });
    } catch {
      return Response.json({ error: 'The uploaded packet is not a readable PDF' }, { status: 400 });
    }
    // ignoreEncryption only suppresses the load error — pdf-lib cannot decrypt,
    // so copied pages from an encrypted packet render blank/garbage. Reject
    // with an actionable message instead of shipping a corrupt Medicare packet.
    if (packetPdf.isEncrypted) {
      return Response.json({
        error: 'The uploaded packet is password-protected. Re-export or print it to an unencrypted PDF, upload it again, and re-run verification.',
      }, { status: 400 });
    }
    const packetPageCount = packetPdf.getPageCount();

    // Two-pass front matter: pass 1 counts pages (offset 0 placeholder), pass 2
    // renders TOC page numbers with the real offset. The page count cannot
    // change between passes — only the digits in a fixed-width column differ.
    const countingDoc = new jsPDF({ unit: 'mm', format: 'letter' });
    const frontPages = renderFrontMatter(countingDoc, adrCase, summary, 0, packetPageCount);
    const frontDoc = new jsPDF({ unit: 'mm', format: 'letter' });
    renderFrontMatter(frontDoc, adrCase, summary, frontPages, packetPageCount);
    const frontBytes = frontDoc.output('arraybuffer');

    // Merge front matter + packet, then stamp page numbers and key-item frames.
    const finalPdf = await PDFDocument.create();
    const frontSrc = await PDFDocument.load(frontBytes);
    const frontCopied = await finalPdf.copyPages(frontSrc, frontSrc.getPageIndices());
    frontCopied.forEach((p) => finalPdf.addPage(p));
    const packetCopied = await finalPdf.copyPages(packetPdf, packetPdf.getPageIndices());
    packetCopied.forEach((p) => finalPdf.addPage(p));

    const helvetica = await finalPdf.embedFont(StandardFonts.Helvetica);
    const helveticaBold = await finalPdf.embedFont(StandardFonts.HelveticaBold);
    const pages = finalPdf.getPages();
    const totalPages = pages.length;
    const red = rgb(0.73, 0.11, 0.11);

    // Key-item map: packet-relative start page -> labels (clamped to the real
    // packet in adrPacketReview.js, but re-clamped here defensively).
    const keyByFinalIndex = new Map();
    for (const key of summary.key_pages || []) {
      const p = Number(key?.packet_page);
      if (!Number.isInteger(p) || p < 1 || p > packetPageCount) continue;
      keyByFinalIndex.set(frontPages + p - 1, (key.labels || []).map((l) => String(l)));
    }

    pages.forEach((page, index) => {
      // Scanned packet pages frequently carry /Rotate 90|180|270. Stamps must
      // be placed in DISPLAY space (what the reviewer sees) and mapped back
      // into unrotated page space, or they render sideways along the wrong
      // edge. Rotations are 90° multiples, so mapped rectangles stay
      // axis-aligned and text is counter-rotated by the page's own angle.
      const rot = ((page.getRotation().angle % 360) + 360) % 360;
      const { width, height } = page.getSize();
      const dispW = rot % 180 === 0 ? width : height;
      const dispH = rot % 180 === 0 ? height : width;
      const toPagePoint = (dx, dy) => {
        if (rot === 90) return { x: width - dy, y: dx };
        if (rot === 180) return { x: width - dx, y: height - dy };
        if (rot === 270) return { x: dy, y: height - dx };
        return { x: dx, y: dy };
      };
      const toPageRect = (dx, dy, dw, dh) => {
        const a = toPagePoint(dx, dy);
        const b = toPagePoint(dx + dw, dy + dh);
        return {
          x: Math.min(a.x, b.x),
          y: Math.min(a.y, b.y),
          width: Math.abs(a.x - b.x),
          height: Math.abs(a.y - b.y),
        };
      };
      const textRotate = degrees(rot);
      const drawDisplayText = (text, dx, dy, size, font, color) => {
        const { x, y } = toPagePoint(dx, dy);
        page.drawText(text, { x, y, size, font, color, rotate: textRotate });
      };

      // Page number stamp, every page (display bottom-right).
      const stamp = `Page ${index + 1} of ${totalPages}`;
      const stampWidth = helvetica.widthOfTextAtSize(stamp, 8);
      page.drawRectangle({
        ...toPageRect(dispW - stampWidth - 14, 4, stampWidth + 8, 12),
        color: rgb(1, 1, 1), opacity: 0.72,
      });
      drawDisplayText(stamp, dispW - stampWidth - 10, 7, 8, helvetica, rgb(0.35, 0.4, 0.5));

      const labels = keyByFinalIndex.get(index);
      if (!labels || labels.length === 0) return;
      // Red attention frame around the page (symmetric — same in page space).
      page.drawRectangle({
        x: 5, y: 5, width: width - 10, height: height - 10,
        borderColor: red, borderWidth: 2.5,
      });
      // Labeled banner along the display top edge naming the key item(s)
      // (at most 3 labels are drawn, so size the banner to what is drawn).
      const bannerHeight = 14 + (Math.min(labels.length, 3) - 1) * 10;
      page.drawRectangle({
        ...toPageRect(5, dispH - 5 - bannerHeight, dispW - 10, bannerHeight),
        color: red,
      });
      labels.slice(0, 3).forEach((label, li) => {
        let text = `KEY ITEM: ${label}`;
        while (helveticaBold.widthOfTextAtSize(text, 8.5) > dispW - 26 && text.length > 12) {
          text = `${text.slice(0, -5)}…`;
        }
        drawDisplayText(text, 12, dispH - 15 - li * 10, 8.5, helveticaBold, rgb(1, 1, 1));
      });
    });

    const finalBytes = await finalPdf.save();

    // Non-identifying filename: no beneficiary name/MBI in file metadata.
    const blob = new Blob([finalBytes], { type: 'application/pdf' });
    const file = new File([blob], `adr_response_packet_${Date.now()}.pdf`, { type: 'application/pdf' });
    const uploadResult = await base44.asServiceRole.integrations.Core.UploadFile({ file });

    // Re-check the case before persisting: if a revised packet was uploaded
    // while this assembly ran, writing 'packet_generated' would make the stale
    // final PDF (built from the OLD file + summary) look current. Best-effort
    // guard — Base44 has no transactions, but this closes the practical race.
    const recheck = await base44.entities.AdrAuditCase.filter({ id: case_id }, undefined, 5000);
    const current = recheck && recheck[0];
    if (
      !current ||
      current.packet_file_url !== adrCase.packet_file_url ||
      !['packet_verified', 'packet_generated'].includes(current.status)
    ) {
      return Response.json({
        error: 'The packet changed while the final packet was being generated — re-run verification, then generate again.',
      }, { status: 409 });
    }

    await base44.entities.AdrAuditCase.update(case_id, {
      final_packet_url: uploadResult.file_url,
      final_packet_pages: totalPages,
      status: 'packet_generated',
    });

    await base44.asServiceRole.entities.UserActivity.create({
      user_email: user.email,
      user_name: user.full_name,
      action: 'adr_packet_generated',
      details: {
        case_id,
        audit_type: adrCase.audit_type,
        packet_pages: packetPageCount,
        final_pages: totalPages,
        readiness: summary.readiness?.level,
        final_packet: uploadResult.file_url,
      },
      page: 'adr_center',
    });

    return Response.json({
      success: true,
      final_packet_url: uploadResult.file_url,
      final_packet_pages: totalPages,
      front_matter_pages: frontPages,
    });
  } catch (error) {
    console.error('ADR packet generation error:', error);
    return Response.json({ error: 'Failed to generate ADR packet' }, { status: 500 });
  }
});
