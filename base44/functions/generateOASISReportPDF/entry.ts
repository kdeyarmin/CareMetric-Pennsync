import { createClientFromRequest } from 'npm:@base44/sdk@0.8.31';
// <<<BEGIN SHARED HELPER: pennsyncProductionAppId — generated, edit base44/_shared/backendHelpers.mjs>>>
const PENNSYNC_PRODUCTION_APP_ID = '694ec16e72e01b60d22f7cbf';
// <<<END SHARED HELPER: pennsyncProductionAppId>>>
// <<<BEGIN SHARED HELPER: base44ClientRequest — generated, edit base44/_shared/backendHelpers.mjs>>>
function pinnedBase44Request(req, expectedAppId, forwardUserCredential) {
  if (typeof expectedAppId !== 'string' || expectedAppId === '') {
    throw new Error('pinned Base44 request requires an expected Base44-App-Id');
  }
  // Read the inbound headers without ever throwing on the SHAPE of req. A production
  // request is always a real Request with a Headers bag; a bare object with no usable
  // headers (a test fixture, a malformed direct call) carries no inbound header, which
  // is the absent case handled below. Only a PRESENT, different app id throws, and that
  // requires a real header an attacker would have to set — so a real Request always
  // reaches this read and the refusal is never skipped by the tolerance.
  const inbound =
    req && req.headers && typeof req.headers.get === 'function' ? req.headers : null;
  const read = (name) => (inbound ? inbound.get(name) : null);
  const received = read('Base44-App-Id');
  // Refuse only an ACTIVE mismatch: a caller presenting a DIFFERENT app id is the
  // tenant-redirect attack, and that is the case the refusal exists for. An ABSENT
  // header is not a mismatch and selects no other tenant — it only means the request
  // did not arrive through the platform, which always injects this header. We SET the
  // pinned constant below either way, so absent falls back to the correct app exactly
  // as the dropped Base44-Api-Url falls back to the default serverUrl. Throwing on
  // absent would turn every anonymous denial into a 500 instead of a clean 403.
  if (received !== null && received !== expectedAppId) {
    throw new Error(
      'Base44-App-Id mismatch: expected ' + expectedAppId + ', received ' + received
    );
  }
  const headers = new Headers();
  // Load-bearing: SET the constant (never forward the inbound value). The SDK reads
  // appId from this header and throws of its own accord when it is absent, so pinning
  // requires setting it here — dropping the inbound header alone would not suffice.
  headers.set('Base44-App-Id', expectedAppId);
  const serviceAuth = read('Base44-Service-Authorization');
  if (serviceAuth !== null) headers.set('Base44-Service-Authorization', serviceAuth);
  if (forwardUserCredential) {
    const authorization = read('Authorization');
    if (authorization !== null) headers.set('Authorization', authorization);
    const dataEnv = read('X-Data-Env');
    if (dataEnv === 'dev' || dataEnv === 'prod') headers.set('X-Data-Env', dataEnv);
  }
  // Cosmetic URL: serverUrl comes from the dropped Base44-Api-Url, not from here.
  // No method: the SDK request factory reads only headers.get(...), never the
  // method, so the request defaults to GET. An explicit POST would be inert for the
  // SDK and would read as an outbound delivery primitive to the inventory scanner
  // once this block is inlined into the fax status pollers.
  return new Request('https://base44.app', { headers });
}
function userScopedClientRequest(req, expectedAppId) {
  return pinnedBase44Request(req, expectedAppId, true);
}
function serviceRoleClientRequest(req, expectedAppId) {
  return pinnedBase44Request(req, expectedAppId, false);
}
// <<<END SHARED HELPER: base44ClientRequest>>>
import { jsPDF } from 'npm:jspdf@2.5.2';

// <<<BEGIN SHARED HELPER: requireActiveUser — generated, edit base44/_shared/backendHelpers.mjs>>>
const isDeactivatedUser = (u) => !!u && u.is_active === false;
const DEACTIVATED_USER_RESPONSE = () => Response.json(
  { error: 'Unauthorized - account is deactivated' },
  { status: 403 },
);
// <<<END SHARED HELPER: requireActiveUser>>>

// Released by the owner on 2026-10-08 ("approve everything"). It renders the
// analysis the signed-in caller already holds into a PDF for that caller; it
// reads no other record and makes no claim beyond what the caller sent.
const OASIS_REPORT_PDF_ENABLED = true;

Deno.serve(async (req) => {
  if (!OASIS_REPORT_PDF_ENABLED) {
    return Response.json({
      success: false,
      available: false,
      reason: 'oasis_report_pdf_paused',
      message: 'OASIS analysis PDF export is unavailable pending tenant-scoped, clinician-reviewed provenance.',
    }, { status: 409 });
  }

  try {
    const base44 = createClientFromRequest(userScopedClientRequest(req, PENNSYNC_PRODUCTION_APP_ID));
    const user = await base44.auth.me();
    if (isDeactivatedUser(user)) return DEACTIVATED_USER_RESPONSE();

    if (!user) {
      return Response.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const { analysisResults } = await req.json();

    if (!analysisResults) {
      return Response.json({ error: 'No analysis results provided' }, { status: 400 });
    }

    const doc = new jsPDF();
    const pageWidth = doc.internal.pageSize.getWidth();
    const margin = 20;
    const contentWidth = pageWidth - (margin * 2);
    let y = 20;

    // Helper function to check if we need a new page
    const checkNewPage = (neededHeight = 30) => {
      if (y + neededHeight > 270) {
        doc.addPage();
        y = 20;
        return true;
      }
      return false;
    };

    // Helper function to add wrapped text
    const addWrappedText = (text, x, startY, maxWidth, lineHeight = 5) => {
      const lines = doc.splitTextToSize(text, maxWidth);
      lines.forEach((line, index) => {
        checkNewPage(lineHeight);
        doc.text(line, x, y);
        y += lineHeight;
      });
      return y;
    };

    // Title
    doc.setFontSize(22);
    doc.setTextColor(30, 58, 138); // Blue
    doc.text('OASIS Analysis Report', margin, y);
    y += 10;

    // Date
    doc.setFontSize(10);
    doc.setTextColor(100, 100, 100);
    doc.text(`Generated: ${new Date().toLocaleString()}`, margin, y);
    y += 12;

    // AI-estimate disclaimer (the scores below are AI-generated, not an official determination)
    doc.setFontSize(8);
    doc.setTextColor(146, 64, 14); // Amber
    addWrappedText(
      'AI-generated estimates from the assessment text - not an official OASIS/PDGM determination. A clinician must verify all M-items before submission; scores do not guarantee coverage or reimbursement.',
      margin, y, contentWidth, 4
    );
    y += 8;

    // Score Overview Section
    doc.setFontSize(14);
    doc.setTextColor(0, 0, 0);
    doc.text('Score Overview', margin, y);
    y += 8;

    // Draw score boxes
    const scores = [
      { label: 'Overall', value: analysisResults.overall_score },
      { label: 'Accuracy', value: analysisResults.accuracy_score },
      { label: 'Compliance', value: analysisResults.compliance_score },
    ];

    const boxWidth = (contentWidth - 15) / 4;
    scores.forEach((score, index) => {
      const x = margin + (index * (boxWidth + 5));
      
      // Box background color based on score
      if (score.value >= 80) {
        doc.setFillColor(220, 252, 231); // Green
      } else if (score.value >= 60) {
        doc.setFillColor(254, 249, 195); // Yellow
      } else {
        doc.setFillColor(254, 226, 226); // Red
      }
      
      doc.roundedRect(x, y, boxWidth, 25, 2, 2, 'F');
      
      doc.setFontSize(8);
      doc.setTextColor(100, 100, 100);
      doc.text(score.label, x + 5, y + 8);
      
      doc.setFontSize(16);
      if (score.value >= 80) {
        doc.setTextColor(22, 163, 74);
      } else if (score.value >= 60) {
        doc.setTextColor(202, 138, 4);
      } else {
        doc.setTextColor(220, 38, 38);
      }
      doc.text(`${score.value}%`, x + 5, y + 20);
    });
    y += 35;

    // Summary
    if (analysisResults.summary) {
      checkNewPage(40);
      doc.setFillColor(239, 246, 255);
      doc.roundedRect(margin, y, contentWidth, 25, 2, 2, 'F');
      doc.setFontSize(10);
      doc.setTextColor(30, 64, 175);
      y += 7;
      addWrappedText(analysisResults.summary, margin + 5, y, contentWidth - 10, 5);
      y += 10;
    }

    // Key Recommendations
    if (analysisResults.key_recommendations?.length > 0) {
      checkNewPage(50);
      doc.setFontSize(14);
      doc.setTextColor(67, 56, 202);
      doc.text('Key Recommendations', margin, y);
      y += 8;

      doc.setFontSize(10);
      doc.setTextColor(0, 0, 0);
      analysisResults.key_recommendations.forEach((rec, index) => {
        checkNewPage(15);
        doc.setTextColor(67, 56, 202);
        doc.text(`${index + 1}.`, margin, y);
        doc.setTextColor(0, 0, 0);
        addWrappedText(rec, margin + 8, y, contentWidth - 10, 5);
        y += 3;
      });
      y += 5;
    }

    // Strengths
    if (analysisResults.strengths?.length > 0) {
      checkNewPage(40);
      doc.setFontSize(14);
      doc.setTextColor(22, 163, 74);
      doc.text('Strengths', margin, y);
      y += 8;

      doc.setFontSize(10);
      doc.setTextColor(0, 0, 0);
      analysisResults.strengths.forEach((strength) => {
        checkNewPage(10);
        doc.text(`• ${strength}`, margin + 5, y);
        y += 6;
      });
      y += 5;
    }

    // Accuracy Issues - limit to top 5
    if (analysisResults.accuracy_issues?.length > 0) {
      checkNewPage(40);
      doc.setFontSize(14);
      doc.setTextColor(202, 138, 4);
      doc.text(`Top Accuracy Issues (${Math.min(5, analysisResults.accuracy_issues.length)})`, margin, y);
      y += 8;

      const topIssues = analysisResults.accuracy_issues.slice(0, 5);
      topIssues.forEach((issue, index) => {
        checkNewPage(25);
        doc.setFillColor(254, 252, 232);
        doc.roundedRect(margin, y, contentWidth, 20, 2, 2, 'F');
        
        doc.setFontSize(9);
        doc.setTextColor(0, 0, 0);
        doc.text(`${issue.item || 'N/A'}:`, margin + 5, y + 7);
        
        const issueText = doc.splitTextToSize(issue.issue || '', contentWidth - 15);
        doc.text(issueText[0], margin + 5, y + 14);
        
        y += 23;
      });
      y += 5;
    }

    // Compliance Concerns - limit to top 5
    if (analysisResults.compliance_concerns?.length > 0) {
      checkNewPage(40);
      doc.setFontSize(14);
      doc.setTextColor(220, 38, 38);
      doc.text(`Top Compliance Concerns (${Math.min(5, analysisResults.compliance_concerns.length)})`, margin, y);
      y += 8;

      const topConcerns = analysisResults.compliance_concerns.slice(0, 5);
      topConcerns.forEach((concern) => {
        checkNewPage(25);
        doc.setFillColor(254, 242, 242);
        doc.roundedRect(margin, y, contentWidth, 20, 2, 2, 'F');
        
        doc.setFontSize(9);
        doc.setTextColor(0, 0, 0);
        doc.text(`${concern.area || 'N/A'}:`, margin + 5, y + 7);
        
        const issueText = doc.splitTextToSize(concern.issue || '', contentWidth - 15);
        doc.text(issueText[0], margin + 5, y + 14);
        
        y += 23;
      });
      y += 5;
    }

    // Audit Risk Areas - limit to top 3
    if (analysisResults.audit_risk_areas?.length > 0) {
      checkNewPage(40);
      doc.setFontSize(14);
      doc.setTextColor(234, 88, 12);
      doc.text(`Top Audit Risks (${Math.min(3, analysisResults.audit_risk_areas.length)})`, margin, y);
      y += 8;

      const topRisks = analysisResults.audit_risk_areas.slice(0, 3);
      topRisks.forEach((risk) => {
        checkNewPage(20);
        doc.setFillColor(255, 247, 237);
        doc.roundedRect(margin, y, contentWidth, 15, 2, 2, 'F');
        
        doc.setFontSize(9);
        doc.setTextColor(0, 0, 0);
        doc.text(`${risk.area || 'N/A'}:`, margin + 5, y + 7);
        
        const mitText = doc.splitTextToSize(risk.mitigation || '', contentWidth - 15);
        doc.text(mitText[0], margin + 5, y + 12);
        
        y += 18;
      });
    }

    // Footer on last page
    const pageCount = doc.internal.getNumberOfPages();
    for (let i = 1; i <= pageCount; i++) {
      doc.setPage(i);
      doc.setFontSize(8);
      doc.setTextColor(150, 150, 150);
      doc.text(`Page ${i} of ${pageCount}`, pageWidth / 2, 290, { align: 'center' });
      doc.text('Generated by OASIS Analyzer', margin, 290);
    }

    const pdfBytes = doc.output('arraybuffer');

    return new Response(pdfBytes, {
      status: 200,
      headers: {
        'Content-Type': 'application/pdf',
        'Content-Disposition': `attachment; filename=OASIS_Analysis_Report_${new Date().toISOString().split('T')[0]}.pdf`
      }
    });
  } catch (error) {
    console.error('Error generating PDF:', error);
    return Response.json({ error: 'Internal server error' }, { status: 500 });
  }
});
