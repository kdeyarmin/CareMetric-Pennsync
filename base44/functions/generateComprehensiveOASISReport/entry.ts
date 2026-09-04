import { createClientFromRequest } from 'npm:@base44/sdk@0.8.31';
import { jsPDF } from 'npm:jspdf@2.5.2';

// <<<BEGIN SHARED HELPER: requireActiveUser — generated, edit base44/_shared/backendHelpers.mjs>>>
const isDeactivatedUser = (u) => !!u && u.is_active === false;
const DEACTIVATED_USER_RESPONSE = () => Response.json(
  { error: 'Unauthorized - account is deactivated' },
  { status: 403 },
);
// <<<END SHARED HELPER: requireActiveUser>>>

// <<<BEGIN SHARED HELPER: pdgmReimbursementGate — generated, edit base44/_shared/backendHelpers.mjs>>>
const PDGM_REIMBURSEMENT_ENABLED = false;
// Independent retirement lock for every legacy PDGM financial surface. A future
// source edit to the global feature flag must not revive the factorized model.
const LEGACY_FACTORIZED_PDGM_MODEL_RETIRED = true;
const PDGM_LEGACY_SURFACES_ENABLED = PDGM_REIMBURSEMENT_ENABLED
  && !LEGACY_FACTORIZED_PDGM_MODEL_RETIRED;
const PDGM_REIMBURSEMENT_BLOCKER = 'The app does not yet use a verified CMS HHGS 432-group grouper with golden-case tests.';
const PDGM_REIMBURSEMENT_ACTION = 'Use the official EMR/CMS-approved grouper for billing and reimbursement decisions.';
function pdgmUnavailablePayload(extra = {}) {
  return {
    featureEnabled: PDGM_LEGACY_SURFACES_ENABLED,
    calculationStatus: 'blocked',
    paymentAvailable: false,
    payment: null,
    totalPayment: null,
    caseMixWeight: null,
    reason: 'cms_verified_pdgm_grouper_unavailable',
    message: `PDGM reimbursement is unavailable — this is not a $0 result. ${PDGM_REIMBURSEMENT_BLOCKER}`,
    actionRequired: [PDGM_REIMBURSEMENT_ACTION],
    ...extra,
  };
}
// <<<END SHARED HELPER: pdgmReimbursementGate>>>

// This endpoint otherwise turns arbitrary caller payloads into an authoritative
// OASIS report. Pause it until the server can resolve a tenant-bound,
// clinician-reviewed analysis record instead of trusting request data.
const COMPREHENSIVE_OASIS_REPORT_ENABLED = false;

Deno.serve(async (req) => {
  if (!COMPREHENSIVE_OASIS_REPORT_ENABLED) {
    return Response.json({
      success: false,
      available: false,
      reason: 'comprehensive_oasis_report_paused',
      message: 'Comprehensive OASIS report export is unavailable pending tenant-scoped, clinician-reviewed provenance.',
    }, { status: 409 });
  }

  try {
    const base44 = createClientFromRequest(req);
    const user = await base44.auth.me();
    if (isDeactivatedUser(user)) return DEACTIVATED_USER_RESPONSE();

    if (!user) {
      return Response.json({ error: 'Unauthorized' }, { status: 401 });
    }

    // Resolve once and gate EVERY financial block below. The revenue score and
    // revenue tips are financial content too — rendering them for a nurse put
    // dollar-driven revenue data into an exportable PDF despite the gate.
    // No caller-supplied financial payload has server-verifiable provenance.
    // Keep every financial section disabled for every role.
    const allowFinancials = false;
    const pdgmUnavailable = pdgmUnavailablePayload();

    const {
      analysisResults = {},
      revenueData,
      navigationData,
      qualityScore,
      patientName
    } = await req.json();

    const doc = new jsPDF();
    let y = 20;
    const pageWidth = doc.internal.pageSize.width;
    const margin = 20;
    const contentWidth = pageWidth - (2 * margin);

    // Helper functions
    const addText = (text, x, yPos, options = {}) => {
      const { fontSize = 10, fontStyle = 'normal', color = [0, 0, 0], maxWidth = contentWidth } = options;
      doc.setFontSize(fontSize);
      doc.setFont('helvetica', fontStyle);
      doc.setTextColor(...color);
      
      const lines = doc.splitTextToSize(text, maxWidth);
      lines.forEach(line => {
        if (yPos > 270) {
          doc.addPage();
          yPos = 20;
        }
        doc.text(line, x, yPos);
        yPos += fontSize * 0.5;
      });
      return yPos;
    };

    const addSection = (title) => {
      if (y > 250) {
        doc.addPage();
        y = 20;
      }
      y += 5;
      doc.setFillColor(59, 130, 246);
      doc.rect(margin, y, contentWidth, 8, 'F');
      doc.setTextColor(255, 255, 255);
      doc.setFontSize(12);
      doc.setFont('helvetica', 'bold');
      doc.text(title, margin + 2, y + 5.5);
      y += 12;
      doc.setTextColor(0, 0, 0);
    };

    const addKeyValue = (key, value, options = {}) => {
      const { bold = false, indent = 0 } = options;
      if (y > 270) {
        doc.addPage();
        y = 20;
      }
      doc.setFontSize(10);
      doc.setFont('helvetica', 'bold');
      doc.text(key + ':', margin + indent, y);
      doc.setFont('helvetica', bold ? 'bold' : 'normal');
      const keyWidth = doc.getTextWidth(key + ': ');
      const lines = doc.splitTextToSize(String(value), contentWidth - keyWidth - indent);
      lines.forEach((line, idx) => {
        if (y > 270) {
          doc.addPage();
          y = 20;
        }
        doc.text(line, margin + indent + (idx === 0 ? keyWidth : 0), y);
        if (idx < lines.length - 1) y += 5;
      });
      y += 6;
    };

    // Title
    doc.setFillColor(79, 70, 229);
    doc.rect(0, 0, pageWidth, 30, 'F');
    doc.setTextColor(255, 255, 255);
    doc.setFontSize(20);
    doc.setFont('helvetica', 'bold');
    doc.text('OASIS Comprehensive Analysis Report', pageWidth / 2, 15, { align: 'center' });
    doc.setFontSize(10);
    doc.text(`Generated: ${new Date().toLocaleDateString()}`, pageWidth / 2, 22, { align: 'center' });

    y = 40;
    doc.setTextColor(0, 0, 0);

    // Patient Info
    if (patientName) {
      addKeyValue('Patient', patientName, { bold: true });
      y += 3;
    }

    // Overall Scores Section — only render if analysisResults has score data
    if (analysisResults.overall_score !== undefined || analysisResults.accuracy_score !== undefined) {
      addSection('OVERALL ASSESSMENT SCORES');
      addKeyValue('Overall Score', analysisResults.overall_score !== undefined ? `${analysisResults.overall_score}%` : 'N/A');
      addKeyValue('Accuracy Score', analysisResults.accuracy_score !== undefined ? `${analysisResults.accuracy_score}%` : 'N/A');
      addKeyValue('Compliance Score', analysisResults.compliance_score !== undefined ? `${analysisResults.compliance_score}%` : 'N/A');
      if (allowFinancials) {
        addKeyValue('Revenue Optimization', analysisResults.revenue_optimization_score !== undefined ? `${analysisResults.revenue_optimization_score}%` : 'N/A');
      }
    }
    
    if (qualityScore) {
      y += 3;
      addKeyValue('Documentation Quality', `${qualityScore.overall_quality_score}% (Grade: ${qualityScore.overall_grade})`);
      addKeyValue('Audit Risk Level', qualityScore.audit_risk_level?.toUpperCase());
    }

    // Never export legacy/LLM-derived PDGM grouping, functional points, weights,
    // or payments. Those values are not a verified CMS HHGS 432-group result.
    if (navigationData || revenueData) {
      addSection('PDGM NAVIGATOR');
      addKeyValue('Grouping and Payment', 'Unavailable — not $0');
      addKeyValue('Unavailable Reason', pdgmUnavailable.message);
      addKeyValue('Required Action', pdgmUnavailable.actionRequired.join('; '));
    }

    // Key Recommendations
    if (analysisResults.key_recommendations?.length > 0) {
      addSection('KEY RECOMMENDATIONS');
      analysisResults.key_recommendations.forEach((rec, idx) => {
        y = addText(`${idx + 1}. ${rec}`, margin, y, { fontSize: 10 });
        y += 2;
      });
    }

    // Accuracy Issues
    if (analysisResults.accuracy_issues?.length > 0) {
      addSection('ACCURACY ISSUES');
      analysisResults.accuracy_issues.slice(0, 10).forEach((issue, idx) => {
        if (y > 250) {
          doc.addPage();
          y = 20;
        }
        doc.setFontSize(9);
        doc.setFont('helvetica', 'bold');
        doc.text(`${idx + 1}. ${issue.item || 'General'}`, margin, y);
        y += 5;
        doc.setFont('helvetica', 'normal');
        y = addText(`Issue: ${issue.issue}`, margin + 3, y, { fontSize: 8, maxWidth: contentWidth - 3 });
        y = addText(`Fix: ${issue.recommendation}`, margin + 3, y, { fontSize: 8, maxWidth: contentWidth - 3, color: [34, 197, 94] });
        y += 3;
      });
    }

    // Compliance Concerns
    if (analysisResults.compliance_concerns?.length > 0) {
      addSection('COMPLIANCE CONCERNS');
      analysisResults.compliance_concerns.slice(0, 10).forEach((concern, idx) => {
        if (y > 250) {
          doc.addPage();
          y = 20;
        }
        doc.setFontSize(9);
        doc.setFont('helvetica', 'bold');
        doc.text(`${idx + 1}. ${concern.area}`, margin, y);
        y += 5;
        doc.setFont('helvetica', 'normal');
        y = addText(`Issue: ${concern.issue}`, margin + 3, y, { fontSize: 8, maxWidth: contentWidth - 3 });
        y = addText(`Action: ${concern.recommendation}`, margin + 3, y, { fontSize: 8, maxWidth: contentWidth - 3, color: [34, 197, 94] });
        y += 3;
      });
    }

    // Quality Criteria
    if (qualityScore?.criteria_scores) {
      addSection('DOCUMENTATION QUALITY BREAKDOWN');
      Object.entries(qualityScore.criteria_scores).forEach(([key, data]) => {
        if (y > 260) {
          doc.addPage();
          y = 20;
        }
        const criterionName = key.charAt(0).toUpperCase() + key.slice(1);
        addKeyValue(criterionName, `${data.score}%`);
        if (data.findings?.length > 0) {
          doc.setFontSize(8);
          doc.text('Strengths:', margin + 3, y);
          y += 4;
          data.findings.slice(0, 3).forEach(finding => {
            y = addText(`• ${finding}`, margin + 5, y, { fontSize: 8, maxWidth: contentWidth - 5 });
          });
        }
        y += 2;
      });
    }

    // Footer on each page
    const pageCount = doc.internal.getNumberOfPages();
    for (let i = 1; i <= pageCount; i++) {
      doc.setPage(i);
      doc.setFontSize(8);
      doc.setTextColor(128, 128, 128);
      doc.text(`Page ${i} of ${pageCount}`, pageWidth / 2, 285, { align: 'center' });
      doc.text('OASIS Comprehensive Report - Confidential', pageWidth / 2, 290, { align: 'center' });
    }

    const pdfBytes = doc.output('arraybuffer');

    return new Response(pdfBytes, {
      status: 200,
      headers: {
        'Content-Type': 'application/pdf',
        'Content-Disposition': 'attachment; filename=OASIS_Comprehensive_Report.pdf'
      }
    });
  } catch (error) {
    console.error('PDF generation error:', error);
    return Response.json({ error: 'Internal server error' }, { status: 500 });
  }
});
