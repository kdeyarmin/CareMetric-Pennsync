import { createClientFromRequest } from 'npm:@base44/sdk@0.8.31';
import { jsPDF } from 'npm:jspdf';

Deno.serve(async (req) => {
  try {
    const base44 = createClientFromRequest(req);
    const user = await base44.auth.me();

    if (!user) {
      return Response.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const { assessment } = await req.json();

    if (!assessment) {
      return Response.json({ error: 'Assessment data required' }, { status: 400 });
    }

    const doc = new jsPDF();
    let y = 20;

    // Fetch and add logo
    try {
      const logoUrl = 'https://qtrypzzcjebvfcihiynt.supabase.co/storage/v1/object/public/base44-prod/public/68ee80d98929370f9e8f2932/52cac091f_20170AA9-BB95-4BA4-B4E7-793615312CC4.png';
      const logoResponse = await fetch(logoUrl);
      const logoBlob = await logoResponse.blob();
      const logoArrayBuffer = await logoBlob.arrayBuffer();
      const logoBase64 = btoa(String.fromCharCode(...new Uint8Array(logoArrayBuffer)));
      const logoDataUrl = `data:image/png;base64,${logoBase64}`;
      
      doc.setFillColor(79, 70, 229);
      doc.rect(0, 0, 210, 35, 'F');
      doc.addImage(logoDataUrl, 'PNG', 15, 8, 20, 20);
      
      doc.setTextColor(255, 255, 255);
      doc.setFontSize(24);
      doc.setFont(undefined, 'bold');
      doc.text('Skill Assessment Report', 105, 18, { align: 'center' });
      doc.setFontSize(11);
      doc.setFont(undefined, 'normal');
      doc.text('AI-Powered Documentation Skills Analysis', 105, 27, { align: 'center' });
    } catch (error) {
      doc.setFillColor(79, 70, 229);
      doc.rect(0, 0, 210, 35, 'F');
      doc.setTextColor(255, 255, 255);
      doc.setFontSize(24);
      doc.setFont(undefined, 'bold');
      doc.text('Skill Assessment Report', 105, 18, { align: 'center' });
    }

    doc.setTextColor(0, 0, 0);
    y = 45;

    // User Info
    doc.setFillColor(243, 244, 246);
    doc.rect(10, y, 190, 20, 'F');
    doc.setFontSize(12);
    doc.setFont(undefined, 'bold');
    doc.text(`Nurse: ${user.full_name || 'User'}`, 15, y + 8);
    doc.setFont(undefined, 'normal');
    doc.setFontSize(10);
    doc.text(`Generated: ${new Date().toLocaleDateString()}`, 15, y + 15);
    y += 30;

    // Skill Profile
    if (assessment.skill_profile && assessment.skill_profile.length > 0) {
      doc.setFillColor(99, 102, 241);
      doc.rect(10, y, 190, 8, 'F');
      doc.setTextColor(255, 255, 255);
      doc.setFontSize(14);
      doc.setFont(undefined, 'bold');
      doc.text('Skill Profile', 15, y + 6);
      doc.setTextColor(0, 0, 0);
      y += 12;

      assessment.skill_profile.forEach(skill => {
        if (y > 270) {
          doc.addPage();
          y = 20;
        }
        
        const levelColors = {
          expert: [34, 197, 94],
          proficient: [59, 130, 246],
          developing: [234, 179, 8],
          beginner: [239, 68, 68]
        };
        const color = levelColors[skill.level] || [107, 114, 128];
        
        doc.setFillColor(249, 250, 251);
        doc.roundedRect(10, y, 190, 15, 2, 2, 'F');
        doc.setDrawColor(229, 231, 235);
        doc.roundedRect(10, y, 190, 15, 2, 2, 'S');
        
        doc.setFontSize(11);
        doc.setFont(undefined, 'bold');
        doc.text(skill.skill_name, 15, y + 6);
        
        doc.setFillColor(...color);
        doc.roundedRect(15, y + 9, 30, 4, 1, 1, 'F');
        doc.setTextColor(255, 255, 255);
        doc.setFontSize(8);
        doc.text((skill.level || 'unknown').toUpperCase(), 17, y + 12);
        doc.setTextColor(0, 0, 0);
        
        y += 18;
      });
      y += 5;
    }

    // Strengths
    if (assessment.strengths && assessment.strengths.length > 0) {
      if (y > 250) {
        doc.addPage();
        y = 20;
      }
      
      doc.setFillColor(34, 197, 94);
      doc.rect(10, y, 190, 8, 'F');
      doc.setTextColor(255, 255, 255);
      doc.setFontSize(14);
      doc.setFont(undefined, 'bold');
      doc.text('Key Strengths', 15, y + 6);
      doc.setTextColor(0, 0, 0);
      y += 12;

      assessment.strengths.forEach(strength => {
        if (y > 270) {
          doc.addPage();
          y = 20;
        }
        doc.setFontSize(10);
        doc.setFont(undefined, 'normal');
        const lines = doc.splitTextToSize(`✓ ${strength}`, 180);
        doc.text(lines, 15, y + 4);
        y += lines.length * 5 + 3;
      });
      y += 5;
    }

    // Growth Opportunities
    if (assessment.growth_opportunities && assessment.growth_opportunities.length > 0) {
      if (y > 220) {
        doc.addPage();
        y = 20;
      }
      
      doc.setFillColor(234, 179, 8);
      doc.rect(10, y, 190, 8, 'F');
      doc.setTextColor(255, 255, 255);
      doc.setFontSize(14);
      doc.setFont(undefined, 'bold');
      doc.text('Growth Opportunities', 15, y + 6);
      doc.setTextColor(0, 0, 0);
      y += 12;

      assessment.growth_opportunities.forEach(opp => {
        if (y > 250) {
          doc.addPage();
          y = 20;
        }
        
        doc.setFillColor(254, 252, 232);
        doc.roundedRect(10, y, 190, 20, 2, 2, 'F');
        doc.setDrawColor(250, 204, 21);
        doc.roundedRect(10, y, 190, 20, 2, 2, 'S');
        
        doc.setFontSize(10);
        doc.setFont(undefined, 'bold');
        doc.text(opp.area, 15, y + 6);
        doc.setFont(undefined, 'normal');
        const lines = doc.splitTextToSize(opp.suggestion, 175);
        doc.text(lines, 15, y + 12);
        
        y += 23;
      });
      y += 5;
    }

    // Recommended Pathways
    if (assessment.recommended_pathways && assessment.recommended_pathways.length > 0) {
      if (y > 220) {
        doc.addPage();
        y = 20;
      }
      
      doc.setFillColor(147, 51, 234);
      doc.rect(10, y, 190, 8, 'F');
      doc.setTextColor(255, 255, 255);
      doc.setFontSize(14);
      doc.setFont(undefined, 'bold');
      doc.text('Recommended Training Pathways', 15, y + 6);
      doc.setTextColor(0, 0, 0);
      y += 12;

      assessment.recommended_pathways.forEach(pathway => {
        if (y > 265) {
          doc.addPage();
          y = 20;
        }
        doc.setFontSize(10);
        doc.setFont(undefined, 'bold');
        doc.text(`• ${pathway}`, 15, y + 4);
        y += 7;
      });
    }

    // Footer
    const pageCount = doc.internal.pages.length - 1;
    for (let i = 1; i <= pageCount; i++) {
      doc.setPage(i);
      doc.setFillColor(249, 250, 251);
      doc.rect(0, 282, 210, 15, 'F');
      doc.setTextColor(107, 114, 128);
      doc.setFontSize(8);
      doc.text(`Penn Sync - Skill Assessment Report - Page ${i} of ${pageCount}`, 105, 290, { align: 'center' });
    }

    const pdfBytes = doc.output('arraybuffer');

    return new Response(pdfBytes, {
      status: 200,
      headers: {
        'Content-Type': 'application/pdf',
        'Content-Disposition': `attachment; filename=Skill_Assessment_${(user.full_name || 'User').replace(/\s+/g, '_')}_${new Date().toISOString().split('T')[0]}.pdf`
      }
    });
  } catch (error) {
    console.error('Error generating PDF:', error);
    return Response.json({ error: error.message }, { status: 500 });
  }
});