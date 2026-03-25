import { createClientFromRequest } from 'npm:@base44/sdk@0.8.4';
import { jsPDF } from 'npm:jspdf@2.5.1';

Deno.serve(async (req) => {
  try {
    const base44 = createClientFromRequest(req);
    const user = await base44.auth.me();

    if (!user) {
      return Response.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const { 
      analysisResults, 
      pdgmData, 
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

    // Overall Scores Section
    addSection('OVERALL ASSESSMENT SCORES');
    addKeyValue('Overall Score', `${analysisResults.overall_score}%`);
    addKeyValue('Accuracy Score', `${analysisResults.accuracy_score}%`);
    addKeyValue('Compliance Score', `${analysisResults.compliance_score}%`);
    addKeyValue('Revenue Optimization', `${analysisResults.revenue_optimization_score}%`);
    
    if (qualityScore) {
      y += 3;
      addKeyValue('Documentation Quality', `${qualityScore.overall_quality_score}% (Grade: ${qualityScore.overall_grade})`);
      addKeyValue('Audit Risk Level', qualityScore.audit_risk_level?.toUpperCase());
    }

    // PDGM Navigator Results
    if (navigationData) {
      addSection('PDGM GROUPING ANALYSIS');
      addKeyValue('Clinical Group', navigationData.clinical_group?.group_name || 'N/A');
      addKeyValue('Confidence Level', navigationData.clinical_group?.confidence || 'N/A');
      addKeyValue('Functional Level', `${navigationData.functional_level?.level || 'N/A'} (${navigationData.functional_level?.total_points || 0} points)`);
      addKeyValue('Comorbidity Adjustment', navigationData.comorbidity_adjustment?.level || 'none');
      addKeyValue('Admission Source', navigationData.admission_timing?.admission_source || 'N/A');
      addKeyValue('Episode Timing', navigationData.admission_timing?.episode_timing || 'N/A');

      if (navigationData.case_mix_calculation) {
        y += 3;
        addKeyValue('Base Payment', `$${navigationData.case_mix_calculation.base_payment?.toFixed(2)}`);
        addKeyValue('Clinical Weight', navigationData.case_mix_calculation.clinical_weight?.toFixed(4));
        addKeyValue('Functional Multiplier', `×${navigationData.case_mix_calculation.functional_multiplier?.toFixed(2)}`);
        addKeyValue('Comorbidity Multiplier', `×${navigationData.case_mix_calculation.comorbidity_multiplier?.toFixed(3)}`);
        addKeyValue('Final Case-Mix Weight', navigationData.case_mix_calculation.final_case_mix_weight?.toFixed(4), { bold: true });
        addKeyValue('Calculated Payment', `$${navigationData.case_mix_calculation.calculated_payment?.toFixed(2)}`, { bold: true });
      }
    }

    // Revenue Analysis
    if (revenueData) {
      addSection('REVENUE OPTIMIZATION ANALYSIS');
      addKeyValue('Current Payment', `$${revenueData.original?.totalPayment?.toFixed(2) || 0}`);
      addKeyValue('Optimized Payment', `$${revenueData.corrected?.totalPayment?.toFixed(2) || 0}`);
      addKeyValue('Potential Increase', `$${revenueData.revenueDifference?.toFixed(2) || 0} (+${revenueData.percentageIncrease?.toFixed(1) || 0}%)`);
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

    // Revenue Tips
    if (analysisResults.revenue_tips?.length > 0) {
      addSection('REVENUE OPTIMIZATION OPPORTUNITIES');
      analysisResults.revenue_tips.slice(0, 10).forEach((tip, idx) => {
        if (y > 250) {
          doc.addPage();
          y = 20;
        }
        doc.setFontSize(9);
        doc.setFont('helvetica', 'bold');
        doc.text(`${idx + 1}. ${tip.category} - ${tip.potential_impact} impact`, margin, y);
        y += 5;
        doc.setFont('helvetica', 'normal');
        y = addText(`Opportunity: ${tip.opportunity}`, margin + 3, y, { fontSize: 8, maxWidth: contentWidth - 3 });
        y = addText(`Action: ${tip.specific_action}`, margin + 3, y, { fontSize: 8, maxWidth: contentWidth - 3, color: [59, 130, 246] });
        y += 3;
      });
    }

    // PDGM Discrepancies
    if (navigationData?.discrepancies?.length > 0) {
      addSection('PDGM DISCREPANCIES');
      navigationData.discrepancies.forEach((disc, idx) => {
        if (y > 250) {
          doc.addPage();
          y = 20;
        }
        doc.setFontSize(9);
        doc.setFont('helvetica', 'bold');
        doc.text(`${idx + 1}. ${disc.type} - ${disc.severity}`, margin, y);
        y += 5;
        doc.setFont('helvetica', 'normal');
        y = addText(`Finding: ${disc.finding}`, margin + 3, y, { fontSize: 8, maxWidth: contentWidth - 3 });
        y = addText(`Expected: ${disc.expected} | Actual: ${disc.actual}`, margin + 3, y, { fontSize: 8, maxWidth: contentWidth - 3 });
        y = addText(`Fix: ${disc.recommendation}`, margin + 3, y, { fontSize: 8, maxWidth: contentWidth - 3, color: [34, 197, 94] });
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
    return Response.json({ error: error.message }, { status: 500 });
  }
});