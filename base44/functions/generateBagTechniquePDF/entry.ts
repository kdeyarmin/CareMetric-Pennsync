import { createClientFromRequest } from 'npm:@base44/sdk@0.8.4';
import { jsPDF } from 'npm:jspdf@2.5.1';

Deno.serve(async (req) => {
  try {
    const base44 = createClientFromRequest(req);
    const user = await base44.auth.me();

    if (!user) {
      return Response.json({ error: 'Unauthorized' }, { status: 401 });
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
      
      // Header with background
      doc.setFillColor(79, 70, 229); // Indigo
      doc.rect(0, 0, 210, 35, 'F');
      
      // Add logo
      doc.addImage(logoDataUrl, 'PNG', 15, 8, 20, 20);
      
      doc.setTextColor(255, 255, 255);
      doc.setFontSize(24);
      doc.setFont(undefined, 'bold');
      doc.text('Bag Technique Checklist', 105, 18, { align: 'center' });
      
      doc.setFontSize(11);
      doc.setFont(undefined, 'normal');
      doc.text('State Survey Preparation - Infection Control Procedure', 105, 27, { align: 'center' });
    } catch (error) {
      // Fallback if logo fetch fails
      doc.setFillColor(79, 70, 229);
      doc.rect(0, 0, 210, 35, 'F');
      doc.setTextColor(255, 255, 255);
      doc.setFontSize(24);
      doc.setFont(undefined, 'bold');
      doc.text('Bag Technique Checklist', 105, 18, { align: 'center' });
      doc.setFontSize(11);
      doc.setFont(undefined, 'normal');
      doc.text('State Survey Preparation - Infection Control Procedure', 105, 27, { align: 'center' });
    }
    
    doc.setTextColor(0, 0, 0);
    y = 45;

    // Helper function to draw section
    const drawSection = (title, items, color) => {
      // Section header with colored background
      doc.setFillColor(...color);
      doc.rect(15, y - 5, 180, 10, 'F');
      doc.setTextColor(255, 255, 255);
      doc.setFontSize(12);
      doc.setFont(undefined, 'bold');
      doc.text(title, 20, y + 1);
      y += 10;
      
      // Section content box
      const startY = y;
      doc.setTextColor(0, 0, 0);
      doc.setFontSize(10);
      doc.setFont(undefined, 'normal');
      
      items.forEach(item => {
        // Checkbox
        doc.setLineWidth(0.5);
        doc.rect(20, y - 3, 4, 4);
        
        // Text with wrapping
        const lines = doc.splitTextToSize(item, 160);
        doc.text(lines, 27, y);
        y += lines.length * 5;
      });
      
      // Border around section
      doc.setDrawColor(200, 200, 200);
      doc.setLineWidth(0.5);
      doc.rect(15, startY - 5, 180, y - startY + 5);
      y += 8;
    };

    // Before You Begin
    drawSection('Before You Begin', [
      'Review the plan of care and provider\'s orders',
      'Introduce yourself and ask patient how they\'d like to be addressed',
      'Confirm patient understanding of procedure and gain informed consent',
      'Locate a hard surface near patient (table) and trash receptacle',
      'Follow organization\'s infection control policies'
    ], [139, 92, 246]); // Purple

    // Step 1
    drawSection('Step 1: Prepare the Bag', [
      'Perform hand hygiene',
      'Remove cleansing wipes from outside pocket',
      'Clean the selected hard surface and let it dry',
      'Remove clean barrier from outside pocket and lay on dry surface',
      'Place bag on top of barrier',
      'Perform hand hygiene and open the bag',
      'Place down two barriers (clean area and dirty area)',
      'Obtain all necessary supplies and place on clean barrier',
      'Close the bag'
    ], [59, 130, 246]); // Blue

    // Step 2
    if (y > 220) {
      doc.addPage();
      y = 20;
    }
    
    drawSection('Step 2: Perform Patient Care', [
      'Perform hand hygiene and don gloves if indicated',
      'Perform patient care, placing used equipment on dirty barrier',
      'Dispose of waste in trash according to organizational policies',
      'If item forgotten: perform hand hygiene before retrieving from bag',
      'After care completion: discard all remaining disposable supplies',
      'Perform hand hygiene'
    ], [16, 185, 129]); // Green

    // New page if needed
    if (y > 200) {
      doc.addPage();
      y = 20;
    }

    // Step 3
    drawSection('Step 3: Clean Reusable Equipment', [
      'Don clean gloves',
      'Use sanitizing wipes/disinfectant per organizational policies',
      'Clean all equipment used or removed from clean barrier',
      'Follow manufacturer\'s contact time for disinfection',
      'Place cleaned equipment back on clean barrier to dry'
    ], [249, 115, 22]); // Orange

    // Step 4
    if (y > 220) {
      doc.addPage();
      y = 20;
    }
    
    drawSection('Step 4: Return Equipment to Bag', [
      'Doff used gloves using Aseptic Non Touch Technique',
      'Dispose of gloves in trash',
      'Perform hand hygiene',
      'Return cleaned items to the bag',
      'Close the bag',
      'Discard the barriers into the trash',
      'Perform hand hygiene'
    ], [99, 102, 241]); // Indigo

    // Step 5
    if (y > 220) {
      doc.addPage();
      y = 20;
    }
    
    drawSection('Step 5: Complete Procedure and Clean Up', [
      'Assess patient for tolerance of performed treatments',
      'Confirm understanding with teach-back as appropriate',
      'Document the procedure',
      'Follow up with provider on noted abnormalities as indicated'
    ], [20, 184, 166]); // Teal

    // Footer on last page
    const pageCount = doc.getNumberOfPages();
    for (let i = 1; i <= pageCount; i++) {
      doc.setPage(i);
      doc.setFillColor(245, 245, 245);
      doc.rect(0, 285, 210, 12, 'F');
      doc.setTextColor(100, 100, 100);
      doc.setFontSize(8);
      doc.setFont(undefined, 'normal');
      doc.text('Penn Sync - Bag Technique Checklist', 20, 291);
      doc.text(`Generated: ${new Date().toLocaleDateString()}`, 105, 291, { align: 'center' });
      doc.text(`Page ${i} of ${pageCount}`, 190, 291, { align: 'right' });
    }

    const pdfBytes = doc.output('arraybuffer');

    return new Response(pdfBytes, {
      status: 200,
      headers: {
        'Content-Type': 'application/pdf',
        'Content-Disposition': 'attachment; filename="Bag_Technique_Checklist.pdf"'
      }
    });
  } catch (error) {
    return Response.json({ error: error.message }, { status: 500 });
  }
});