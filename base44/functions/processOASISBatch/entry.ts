import { createClientFromRequest } from 'npm:@base44/sdk@0.8.4';
import { jsPDF } from 'npm:jspdf@2.5.1';
import JSZip from 'npm:jszip@3.10.1';

Deno.serve(async (req) => {
  try {
    const base44 = createClientFromRequest(req);
    const user = await base44.auth.me();

    if (!user) {
      return Response.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const { fileUrls, fileNames } = await req.json();

    if (!fileUrls || !Array.isArray(fileUrls) || fileUrls.length === 0) {
      return Response.json({ error: 'No files provided' }, { status: 400 });
    }

    const results = [];
    const zip = new JSZip();

    for (let i = 0; i < fileUrls.length; i++) {
      const fileUrl = fileUrls[i];
      const fileName = fileNames?.[i] || `Document_${i + 1}`;
      
      try {
        // Extract text from PDF
        const extractedData = await base44.integrations.Core.ExtractDataFromUploadedFile({
          file_url: fileUrl,
          json_schema: {
            type: "object",
            properties: {
              full_content: { 
                type: "string", 
                description: "Extract ALL text content from this OASIS assessment document. Include every field, item code (M0000-M2400), responses, patient information, dates, and any clinical notes."
              }
            },
            required: ["full_content"]
          }
        });

        if (extractedData.status === "error") {
          results.push({
            fileName,
            status: 'error',
            error: extractedData.details || 'Failed to extract text from PDF'
          });
          continue;
        }

        let oasisTextContent = "";
        if (extractedData.output) {
          if (typeof extractedData.output === 'string') {
            oasisTextContent = extractedData.output;
          } else if (extractedData.output.full_content) {
            oasisTextContent = extractedData.output.full_content;
          } else if (typeof extractedData.output === 'object') {
            oasisTextContent = JSON.stringify(extractedData.output, null, 2);
          }
        }

        if (!oasisTextContent || oasisTextContent.trim().length < 20) {
          results.push({
            fileName,
            status: 'error',
            error: 'Could not extract sufficient text from the PDF'
          });
          continue;
        }

        // Analyze with AI
        const analysisResult = await base44.integrations.Core.InvokeLLM({
          prompt: `You are an expert OASIS analyst. Analyze this OASIS assessment document:

OASIS Document Content:
"""
${oasisTextContent.substring(0, 15000)}
"""

Provide comprehensive analysis including accuracy issues, compliance concerns, revenue optimization tips, and audit risks.

Return JSON:
{
  "overall_score": 0-100,
  "accuracy_score": 0-100,
  "compliance_score": 0-100,
  "revenue_optimization_score": 0-100,
  "summary": "Brief summary",
  "accuracy_issues": [{"item": "code", "issue": "description", "severity": "high|medium|low", "recommendation": "fix"}],
  "compliance_concerns": [{"area": "area", "issue": "description", "severity": "high|medium|low", "cms_reference": "ref", "recommendation": "fix"}],
  "revenue_tips": [{"category": "category", "current_documentation": "current", "opportunity": "opportunity", "potential_impact": "high|medium|low", "specific_action": "action"}],
  "audit_risk_areas": [{"area": "area", "risk_level": "high|medium|low", "explanation": "explanation", "mitigation": "mitigation"}],
  "strengths": ["strength1", "strength2"],
  "key_recommendations": ["rec1", "rec2"]
}`,
          response_json_schema: {
            type: "object",
            properties: {
              overall_score: { type: "number" },
              accuracy_score: { type: "number" },
              compliance_score: { type: "number" },
              revenue_optimization_score: { type: "number" },
              summary: { type: "string" },
              accuracy_issues: { type: "array", items: { type: "object" } },
              compliance_concerns: { type: "array", items: { type: "object" } },
              revenue_tips: { type: "array", items: { type: "object" } },
              audit_risk_areas: { type: "array", items: { type: "object" } },
              strengths: { type: "array", items: { type: "string" } },
              key_recommendations: { type: "array", items: { type: "string" } }
            }
          }
        });

        // Generate PDF for this document
        const pdfBytes = generatePDF(analysisResult, fileName);
        
        // Add to ZIP
        const safeName = fileName.replace(/[^a-zA-Z0-9_-]/g, '_').substring(0, 50);
        zip.file(`${safeName}_Analysis.pdf`, pdfBytes);

        results.push({
          fileName,
          status: 'success',
          analysis: analysisResult
        });

      } catch (docError) {
        results.push({
          fileName,
          status: 'error',
          error: docError.message || 'Unknown error processing document'
        });
      }
    }

    // Generate ZIP file
    const zipContent = await zip.generateAsync({ type: 'base64' });

    return Response.json({
      results,
      zipBase64: zipContent,
      successCount: results.filter(r => r.status === 'success').length,
      errorCount: results.filter(r => r.status === 'error').length
    });

  } catch (error) {
    console.error('Batch processing error:', error);
    return Response.json({ error: error.message }, { status: 500 });
  }
});

function generatePDF(analysisResults, documentName) {
  const doc = new jsPDF();
  const pageWidth = doc.internal.pageSize.getWidth();
  const margin = 20;
  const contentWidth = pageWidth - (margin * 2);
  let y = 20;

  const checkNewPage = (neededHeight = 30) => {
    if (y + neededHeight > 270) {
      doc.addPage();
      y = 20;
    }
  };

  // Title
  doc.setFontSize(18);
  doc.setTextColor(30, 58, 138);
  doc.text('OASIS Analysis Report', margin, y);
  y += 8;
  
  doc.setFontSize(12);
  doc.setTextColor(100, 100, 100);
  doc.text(documentName, margin, y);
  y += 6;
  
  doc.setFontSize(10);
  doc.text(`Generated: ${new Date().toLocaleString()}`, margin, y);
  y += 12;

  // Scores
  doc.setFontSize(12);
  doc.setTextColor(0, 0, 0);
  doc.text(`Overall Score: ${analysisResults.overall_score}%`, margin, y);
  y += 6;
  doc.text(`Accuracy: ${analysisResults.accuracy_score}% | Compliance: ${analysisResults.compliance_score}% | Revenue Opt: ${analysisResults.revenue_optimization_score}%`, margin, y);
  y += 10;

  // Summary
  if (analysisResults.summary) {
    doc.setFontSize(10);
    const summaryLines = doc.splitTextToSize(analysisResults.summary, contentWidth);
    summaryLines.forEach(line => {
      checkNewPage(6);
      doc.text(line, margin, y);
      y += 5;
    });
    y += 5;
  }

  // Key Recommendations
  if (analysisResults.key_recommendations?.length > 0) {
    checkNewPage(20);
    doc.setFontSize(12);
    doc.setTextColor(67, 56, 202);
    doc.text('Key Recommendations', margin, y);
    y += 7;
    
    doc.setFontSize(9);
    doc.setTextColor(0, 0, 0);
    analysisResults.key_recommendations.forEach((rec, i) => {
      checkNewPage(10);
      const lines = doc.splitTextToSize(`${i + 1}. ${rec}`, contentWidth - 5);
      lines.forEach(line => {
        doc.text(line, margin + 3, y);
        y += 4;
      });
      y += 2;
    });
    y += 5;
  }

  // Accuracy Issues
  if (analysisResults.accuracy_issues?.length > 0) {
    checkNewPage(20);
    doc.setFontSize(12);
    doc.setTextColor(202, 138, 4);
    doc.text(`Accuracy Issues (${analysisResults.accuracy_issues.length})`, margin, y);
    y += 7;
    
    doc.setFontSize(9);
    analysisResults.accuracy_issues.forEach(issue => {
      checkNewPage(15);
      doc.setTextColor(0, 0, 0);
      doc.text(`• ${issue.item}: ${issue.issue}`, margin + 3, y);
      y += 4;
      doc.setTextColor(22, 163, 74);
      doc.text(`  → ${issue.recommendation}`, margin + 3, y);
      y += 5;
    });
    y += 5;
  }

  // Compliance Concerns
  if (analysisResults.compliance_concerns?.length > 0) {
    checkNewPage(20);
    doc.setFontSize(12);
    doc.setTextColor(220, 38, 38);
    doc.text(`Compliance Concerns (${analysisResults.compliance_concerns.length})`, margin, y);
    y += 7;
    
    doc.setFontSize(9);
    analysisResults.compliance_concerns.forEach(concern => {
      checkNewPage(15);
      doc.setTextColor(0, 0, 0);
      doc.text(`• ${concern.area}: ${concern.issue}`, margin + 3, y);
      y += 4;
      doc.setTextColor(22, 163, 74);
      doc.text(`  → ${concern.recommendation}`, margin + 3, y);
      y += 5;
    });
    y += 5;
  }

  // Revenue Tips
  if (analysisResults.revenue_tips?.length > 0) {
    checkNewPage(20);
    doc.setFontSize(12);
    doc.setTextColor(22, 163, 74);
    doc.text(`Revenue Tips (${analysisResults.revenue_tips.length})`, margin, y);
    y += 7;
    
    doc.setFontSize(9);
    analysisResults.revenue_tips.forEach(tip => {
      checkNewPage(12);
      doc.setTextColor(0, 0, 0);
      doc.text(`• ${tip.category}: ${tip.specific_action}`, margin + 3, y);
      y += 5;
    });
  }

  // Footer
  const pageCount = doc.internal.getNumberOfPages();
  for (let i = 1; i <= pageCount; i++) {
    doc.setPage(i);
    doc.setFontSize(8);
    doc.setTextColor(150, 150, 150);
    doc.text(`Page ${i} of ${pageCount}`, pageWidth / 2, 290, { align: 'center' });
  }

  return doc.output('arraybuffer');
}