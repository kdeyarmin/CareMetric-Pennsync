import { createClientFromRequest } from 'npm:@base44/sdk@0.8.4';
import { jsPDF } from 'npm:jspdf@2.5.1';

Deno.serve(async (req) => {
  try {
    const base44 = createClientFromRequest(req);
    const user = await base44.auth.me();

    if (!user) {
      return Response.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const { revenueData, analysisResults, pdgmData } = await req.json();

    if (!revenueData) {
      return Response.json({ error: 'No revenue data provided' }, { status: 400 });
    }

    const doc = new jsPDF();
    const pageWidth = doc.internal.pageSize.getWidth();
    const margin = 20;
    const contentWidth = pageWidth - (margin * 2);
    let y = 20;

    const formatCurrency = (amount) => {
      return new Intl.NumberFormat('en-US', {
        style: 'currency',
        currency: 'USD'
      }).format(amount);
    };

    // Title
    doc.setFontSize(22);
    doc.setTextColor(22, 163, 74); // Green
    doc.text('PDGM Revenue Impact Analysis', margin, y);
    y += 10;

    // Date
    doc.setFontSize(10);
    doc.setTextColor(100, 100, 100);
    doc.text(`Generated: ${new Date().toLocaleString()}`, margin, y);
    y += 15;

    // Executive Summary Box
    doc.setFillColor(240, 253, 244); // Light green
    doc.roundedRect(margin, y, contentWidth, 45, 3, 3, 'F');
    
    doc.setFontSize(14);
    doc.setTextColor(22, 101, 52);
    doc.text('Executive Summary', margin + 5, y + 10);
    
    doc.setFontSize(24);
    doc.setTextColor(22, 163, 74);
    const diffText = revenueData.revenueDifference > 0 
      ? `+${formatCurrency(revenueData.revenueDifference)}`
      : formatCurrency(revenueData.revenueDifference || 0);
    doc.text(diffText, margin + 5, y + 28);
    
    doc.setFontSize(10);
    doc.setTextColor(22, 101, 52);
    doc.text('Potential Revenue Increase Per 30-Day Episode', margin + 5, y + 38);
    
    if (revenueData.percentageIncrease) {
      doc.setFontSize(16);
      doc.setTextColor(22, 163, 74);
      doc.text(`+${revenueData.percentageIncrease}%`, margin + contentWidth - 30, y + 25);
    }
    y += 55;

    // Revenue Comparison Section
    doc.setFontSize(14);
    doc.setTextColor(0, 0, 0);
    doc.text('30-Day Episode Payment Comparison', margin, y);
    y += 10;

    // Current vs Improved boxes
    const boxWidth = (contentWidth - 10) / 2;
    
    // Current Documentation Box
    doc.setFillColor(243, 244, 246);
    doc.roundedRect(margin, y, boxWidth, 40, 2, 2, 'F');
    doc.setFontSize(10);
    doc.setTextColor(107, 114, 128);
    doc.text('Current Documentation', margin + 5, y + 10);
    doc.setFontSize(20);
    doc.setTextColor(55, 65, 81);
    doc.text(formatCurrency(revenueData.original?.totalPayment || 0), margin + 5, y + 28);
    doc.setFontSize(8);
    doc.setTextColor(107, 114, 128);
    doc.text(`Case-Mix Weight: ${revenueData.original?.caseMixWeight?.toFixed(4) || 'N/A'}`, margin + 5, y + 36);

    // Improved Documentation Box
    doc.setFillColor(220, 252, 231);
    doc.roundedRect(margin + boxWidth + 10, y, boxWidth, 40, 2, 2, 'F');
    doc.setFontSize(10);
    doc.setTextColor(22, 101, 52);
    doc.text('With Documentation Improvements', margin + boxWidth + 15, y + 10);
    doc.setFontSize(20);
    doc.setTextColor(22, 163, 74);
    doc.text(formatCurrency(revenueData.corrected?.totalPayment || 0), margin + boxWidth + 15, y + 28);
    doc.setFontSize(8);
    doc.setTextColor(22, 101, 52);
    doc.text(`Case-Mix Weight: ${revenueData.corrected?.caseMixWeight?.toFixed(4) || 'N/A'}`, margin + boxWidth + 15, y + 36);
    y += 50;

    // Annual Impact Projection
    if (revenueData.financialImpact) {
      doc.setFontSize(14);
      doc.setTextColor(67, 56, 202);
      doc.text('Projected Annual Financial Impact', margin, y);
      y += 10;

      doc.setFillColor(238, 242, 255);
      doc.roundedRect(margin, y, contentWidth, 35, 2, 2, 'F');

      const colWidth = contentWidth / 3;
      
      doc.setFontSize(9);
      doc.setTextColor(79, 70, 229);
      doc.text('Per Episode', margin + 10, y + 10);
      doc.text('30 Episodes/Year', margin + colWidth + 10, y + 10);
      doc.text('60 Episodes/Year', margin + (colWidth * 2) + 10, y + 10);

      doc.setFontSize(14);
      doc.setTextColor(67, 56, 202);
      doc.text(formatCurrency(revenueData.financialImpact.perEpisode), margin + 10, y + 25);
      doc.text(formatCurrency(revenueData.financialImpact.annual30Episodes), margin + colWidth + 10, y + 25);
      doc.text(formatCurrency(revenueData.financialImpact.annual60Episodes), margin + (colWidth * 2) + 10, y + 25);
      y += 45;
    }

    // PDGM Component Breakdown
    doc.setFontSize(14);
    doc.setTextColor(0, 0, 0);
    doc.text('PDGM Component Analysis', margin, y);
    y += 10;

    // Table header
    doc.setFillColor(243, 244, 246);
    doc.rect(margin, y, contentWidth, 8, 'F');
    doc.setFontSize(9);
    doc.setTextColor(75, 85, 99);
    doc.text('Component', margin + 5, y + 6);
    doc.text('Current', margin + 70, y + 6);
    doc.text('Improved', margin + 110, y + 6);
    doc.text('Impact', margin + 150, y + 6);
    y += 10;

    // Table rows
    const components = [
      {
        name: 'Clinical Group',
        current: revenueData.original?.clinicalGroup?.replace('MMTA_', '') || 'N/A',
        improved: revenueData.corrected?.clinicalGroup?.replace('MMTA_', '') || 'N/A',
        currentWeight: revenueData.original?.clinicalWeight,
        improvedWeight: revenueData.corrected?.clinicalWeight
      },
      {
        name: 'Functional Level',
        current: revenueData.original?.functionalLevel || 'N/A',
        improved: revenueData.corrected?.functionalLevel || 'N/A',
        currentWeight: revenueData.original?.functionalMultiplier,
        improvedWeight: revenueData.corrected?.functionalMultiplier
      },
      {
        name: 'Comorbidity Adj.',
        current: revenueData.original?.comorbidityLevel || 'N/A',
        improved: revenueData.corrected?.comorbidityLevel || 'N/A',
        currentWeight: revenueData.original?.comorbidityMultiplier,
        improvedWeight: revenueData.corrected?.comorbidityMultiplier
      },
      {
        name: 'Admission Source',
        current: revenueData.original?.admissionSource || 'N/A',
        improved: revenueData.corrected?.admissionSource || 'N/A',
        currentWeight: revenueData.original?.admissionMultiplier,
        improvedWeight: revenueData.corrected?.admissionMultiplier
      },
      {
        name: 'Episode Timing',
        current: revenueData.original?.episodeTiming || 'N/A',
        improved: revenueData.corrected?.episodeTiming || 'N/A',
        currentWeight: revenueData.original?.timingMultiplier,
        improvedWeight: revenueData.corrected?.timingMultiplier
      }
    ];

    doc.setFontSize(9);
    components.forEach((comp, idx) => {
      if (idx % 2 === 0) {
        doc.setFillColor(249, 250, 251);
        doc.rect(margin, y - 1, contentWidth, 10, 'F');
      }

      doc.setTextColor(0, 0, 0);
      doc.text(comp.name, margin + 5, y + 6);
      
      doc.setTextColor(107, 114, 128);
      const currentText = `${comp.current} (${comp.currentWeight?.toFixed(2) || 'N/A'})`;
      doc.text(currentText, margin + 70, y + 6);
      
      const hasChange = comp.current !== comp.improved;
      doc.setTextColor(hasChange ? 22 : 107, hasChange ? 163 : 114, hasChange ? 74 : 128);
      const improvedText = `${comp.improved} (${comp.improvedWeight?.toFixed(2) || 'N/A'})`;
      doc.text(improvedText, margin + 110, y + 6);
      
      if (hasChange) {
        doc.setTextColor(22, 163, 74);
        doc.text('Improved', margin + 150, y + 6);
      } else {
        doc.setTextColor(107, 114, 128);
        doc.text('No Change', margin + 150, y + 6);
      }
      
      y += 10;
    });
    y += 10;

    // Documentation Recommendations
    if (analysisResults?.revenue_tips?.length > 0) {
      doc.setFontSize(14);
      doc.setTextColor(0, 0, 0);
      doc.text('Revenue Optimization Recommendations', margin, y);
      y += 8;

      doc.setFontSize(9);
      analysisResults.revenue_tips.slice(0, 5).forEach((tip, idx) => {
        if (y > 260) {
          doc.addPage();
          y = 20;
        }

        doc.setFillColor(tip.potential_impact === 'high' ? 220 : 254, tip.potential_impact === 'high' ? 252 : 249, tip.potential_impact === 'high' ? 231 : 195);
        doc.roundedRect(margin, y, contentWidth, 20, 2, 2, 'F');
        
        doc.setTextColor(0, 0, 0);
        doc.text(`${idx + 1}. ${tip.category}: ${tip.specific_action?.substring(0, 80) || ''}`, margin + 5, y + 8);
        
        doc.setTextColor(107, 114, 128);
        doc.text(`Impact: ${tip.potential_impact?.toUpperCase() || 'N/A'}`, margin + 5, y + 16);
        
        y += 25;
      });
    }

    // Disclaimer
    if (y > 250) {
      doc.addPage();
      y = 20;
    }
    y += 10;
    doc.setFontSize(8);
    doc.setTextColor(156, 163, 175);
    const disclaimer = 'Note: PDGM revenue calculations are estimates based on CMS guidelines and may vary based on actual case-mix adjustments, wage index, and other factors. Consult with your billing department for accurate payment projections.';
    const disclaimerLines = doc.splitTextToSize(disclaimer, contentWidth);
    disclaimerLines.forEach(line => {
      doc.text(line, margin, y);
      y += 4;
    });

    // Footer
    const pageCount = doc.internal.getNumberOfPages();
    for (let i = 1; i <= pageCount; i++) {
      doc.setPage(i);
      doc.setFontSize(8);
      doc.setTextColor(150, 150, 150);
      doc.text(`Page ${i} of ${pageCount}`, pageWidth / 2, 290, { align: 'center' });
      doc.text('PDGM Revenue Impact Analysis - Generated by OASIS Analyzer', margin, 290);
    }

    const pdfBytes = doc.output('arraybuffer');

    return new Response(pdfBytes, {
      status: 200,
      headers: {
        'Content-Type': 'application/pdf',
        'Content-Disposition': `attachment; filename=PDGM_Revenue_Comparison_${new Date().toISOString().split('T')[0]}.pdf`
      }
    });

  } catch (error) {
    console.error('Error generating PDGM PDF:', error);
    return Response.json({ error: error.message }, { status: 500 });
  }
});