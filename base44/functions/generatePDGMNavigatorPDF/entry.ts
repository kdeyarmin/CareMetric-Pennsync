import { createClientFromRequest } from 'npm:@base44/sdk@0.8.4';
import { jsPDF } from 'npm:jspdf@2.5.1';

Deno.serve(async (req) => {
  try {
    const base44 = createClientFromRequest(req);
    const user = await base44.auth.me();

    if (!user) {
      return Response.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const { navigationData, pdgmData, patientName } = await req.json();

    const doc = new jsPDF();
    let y = 20;

    // Helper to add text with wrapping
    const addText = (text, x, size = 10, maxWidth = 170) => {
      doc.setFontSize(size);
      const lines = doc.splitTextToSize(text, maxWidth);
      lines.forEach(line => {
        if (y > 280) {
          doc.addPage();
          y = 20;
        }
        doc.text(line, x, y);
        y += size * 0.5;
      });
      y += 2;
    };

    // Title
    doc.setFontSize(18);
    doc.setFont(undefined, 'bold');
    doc.text('PDGM Navigator Analysis Report', 20, y);
    y += 10;

    doc.setFontSize(10);
    doc.setFont(undefined, 'normal');
    doc.text(`Patient: ${patientName || 'Unknown'}`, 20, y);
    y += 6;
    doc.text(`Generated: ${new Date().toLocaleDateString()}`, 20, y);
    y += 10;

    // Summary Section
    if (navigationData?.summary) {
      doc.setFontSize(14);
      doc.setFont(undefined, 'bold');
      doc.text('Summary', 20, y);
      y += 8;

      doc.setFontSize(10);
      doc.setFont(undefined, 'normal');
      addText(`Estimated Payment: $${navigationData.summary.payment_amount?.toFixed(2) || '0.00'}`, 20);
      
      if (navigationData.summary.key_drivers?.length > 0) {
        addText('Key Payment Drivers:', 20);
        navigationData.summary.key_drivers.forEach(driver => {
          addText(`  • ${driver}`, 25);
        });
      }

      y += 5;
    }

    // Clinical Group
    if (navigationData?.clinical_group) {
      doc.setFontSize(14);
      doc.setFont(undefined, 'bold');
      doc.text('Clinical Group', 20, y);
      y += 8;

      doc.setFontSize(10);
      doc.setFont(undefined, 'normal');
      addText(`Assigned: ${navigationData.clinical_group.group_name}`, 20);
      addText(`Confidence: ${navigationData.clinical_group.confidence}`, 20);
      addText(`Rationale: ${navigationData.clinical_group.rationale}`, 20);
      
      y += 5;
    }

    // Functional Level
    if (navigationData?.functional_level) {
      doc.setFontSize(14);
      doc.setFont(undefined, 'bold');
      doc.text('Functional Impairment', 20, y);
      y += 8;

      doc.setFontSize(10);
      doc.setFont(undefined, 'normal');
      addText(`Level: ${navigationData.functional_level.level} (${navigationData.functional_level.total_points} points)`, 20);
      addText(`Threshold: ${navigationData.functional_level.threshold_used}`, 20);
      
      y += 5;
    }

    // Discrepancies
    if (navigationData?.discrepancies?.length > 0) {
      if (y > 240) {
        doc.addPage();
        y = 20;
      }

      doc.setFontSize(14);
      doc.setFont(undefined, 'bold');
      doc.text('Discrepancies Detected', 20, y);
      y += 8;

      navigationData.discrepancies.forEach((disc, idx) => {
        if (y > 260) {
          doc.addPage();
          y = 20;
        }

        doc.setFontSize(11);
        doc.setFont(undefined, 'bold');
        doc.text(`${idx + 1}. ${disc.type} (${disc.severity})`, 20, y);
        y += 6;

        doc.setFontSize(9);
        doc.setFont(undefined, 'normal');
        addText(`Finding: ${disc.finding}`, 25, 9);
        addText(`Expected: ${disc.expected} | Actual: ${disc.actual}`, 25, 9);
        addText(`Recommendation: ${disc.recommendation}`, 25, 9);
        
        y += 3;
      });
    }

    // Optimization Opportunities
    if (navigationData?.optimization_opportunities?.length > 0) {
      if (y > 240) {
        doc.addPage();
        y = 20;
      }

      doc.setFontSize(14);
      doc.setFont(undefined, 'bold');
      doc.text('Optimization Opportunities', 20, y);
      y += 8;

      navigationData.optimization_opportunities.forEach((opp, idx) => {
        if (y > 260) {
          doc.addPage();
          y = 20;
        }

        doc.setFontSize(11);
        doc.setFont(undefined, 'bold');
        doc.text(`${idx + 1}. ${opp.area}`, 20, y);
        y += 6;

        doc.setFontSize(9);
        doc.setFont(undefined, 'normal');
        addText(`Opportunity: ${opp.opportunity}`, 25, 9);
        addText(`Impact: ${opp.potential_impact}`, 25, 9);
        addText(`Action: ${opp.action_required}`, 25, 9);
        
        y += 3;
      });
    }

    const pdfBytes = doc.output('arraybuffer');

    return new Response(pdfBytes, {
      status: 200,
      headers: {
        'Content-Type': 'application/pdf',
        'Content-Disposition': 'attachment; filename=PDGM_Navigator_Report.pdf'
      }
    });
  } catch (error) {
    return Response.json({ error: error.message }, { status: 500 });
  }
});