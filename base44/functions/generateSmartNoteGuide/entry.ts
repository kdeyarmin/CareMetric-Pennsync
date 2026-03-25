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
    const pageWidth = doc.internal.pageSize.getWidth();
    const pageHeight = doc.internal.pageSize.getHeight();
    const margin = 20;
    const contentWidth = pageWidth - 2 * margin;
    let yPos = margin;

    // Helper to add new page when needed
    const checkNewPage = (requiredSpace = 20) => {
      if (yPos + requiredSpace > pageHeight - margin) {
        doc.addPage();
        return margin;
      }
      return yPos;
    };

    // Header
    doc.setFillColor(66, 133, 244);
    doc.rect(0, 0, pageWidth, 45, 'F');
    
    doc.setFontSize(24);
    doc.setFont('helvetica', 'bold');
    doc.setTextColor(255, 255, 255);
    doc.text('Smart Note Assistant', pageWidth / 2, 20, { align: 'center' });
    
    doc.setFontSize(12);
    doc.setFont('helvetica', 'normal');
    doc.text('Complete User Guide', pageWidth / 2, 32, { align: 'center' });

    yPos = 55;

    // Introduction
    doc.setFontSize(16);
    doc.setFont('helvetica', 'bold');
    doc.setTextColor(66, 133, 244);
    doc.text('Welcome to Smart Note Assistant', margin, yPos);
    yPos += 10;

    doc.setFontSize(11);
    doc.setFont('helvetica', 'normal');
    doc.setTextColor(60, 60, 60);
    const introLines = doc.splitTextToSize(
      'The Smart Note Assistant helps you create Medicare-compliant clinical documentation quickly and efficiently. This guide will walk you through each step of the process.',
      contentWidth
    );
    introLines.forEach(line => {
      yPos = checkNewPage();
      doc.text(line, margin, yPos);
      yPos += 6;
    });
    yPos += 5;

    // Step 1
    yPos = checkNewPage(40);
    doc.setFillColor(240, 248, 255);
    doc.rect(margin, yPos - 3, contentWidth, 12, 'F');
    doc.setFontSize(14);
    doc.setFont('helvetica', 'bold');
    doc.setTextColor(30, 58, 138);
    doc.text('Step 1: Select Patient & Visit Information', margin + 5, yPos + 5);
    yPos += 15;

    doc.setFontSize(11);
    doc.setFont('helvetica', 'normal');
    doc.setTextColor(60, 60, 60);
    
    const step1Items = [
      { label: 'Patient Selection', desc: 'Search and select the patient from the dropdown. The system will auto-populate their primary diagnosis if available.' },
      { label: 'Visit Date', desc: 'Select the date of the visit. Default is today\'s date.' },
      { label: 'Visit Type', desc: 'Choose from Admission, Routine Visit, Recertification, Discharge, or PRN Visit.' },
      { label: 'Diagnosis', desc: 'Select the primary diagnosis from common conditions or enter a custom diagnosis.' }
    ];

    step1Items.forEach(item => {
      yPos = checkNewPage(15);
      doc.setFont('helvetica', 'bold');
      doc.text(`• ${item.label}:`, margin + 3, yPos);
      yPos += 6;
      doc.setFont('helvetica', 'normal');
      const descLines = doc.splitTextToSize(item.desc, contentWidth - 10);
      descLines.forEach(line => {
        doc.text(line, margin + 8, yPos);
        yPos += 5;
      });
      yPos += 2;
    });
    yPos += 5;

    // Step 2
    yPos = checkNewPage(40);
    doc.setFillColor(240, 253, 244);
    doc.rect(margin, yPos - 3, contentWidth, 12, 'F');
    doc.setFontSize(14);
    doc.setFont('helvetica', 'bold');
    doc.setTextColor(22, 101, 52);
    doc.text('Step 2: Enter Vital Signs', margin + 5, yPos + 5);
    yPos += 15;

    doc.setFontSize(11);
    doc.setFont('helvetica', 'normal');
    doc.setTextColor(60, 60, 60);

    const step2Items = [
      { label: 'Blood Pressure', desc: 'Enter as systolic/diastolic (e.g., 120/80)' },
      { label: 'Heart Rate', desc: 'Enter beats per minute' },
      { label: 'Temperature', desc: 'Enter in Fahrenheit' },
      { label: 'Oxygen Saturation', desc: 'Enter percentage. Specify if on room air or supplemental oxygen.' },
      { label: 'Pain Level', desc: 'Rate from 0-10' },
      { label: 'Weight', desc: 'Enter in pounds (optional)' }
    ];

    step2Items.forEach(item => {
      yPos = checkNewPage(12);
      doc.setFont('helvetica', 'bold');
      doc.text(`• ${item.label}:`, margin + 3, yPos);
      yPos += 6;
      doc.setFont('helvetica', 'normal');
      const descLines = doc.splitTextToSize(item.desc, contentWidth - 10);
      descLines.forEach(line => {
        doc.text(line, margin + 8, yPos);
        yPos += 5;
      });
      yPos += 1;
    });
    yPos += 5;

    // Step 3
    yPos = checkNewPage(40);
    doc.setFillColor(250, 245, 255);
    doc.rect(margin, yPos - 3, contentWidth, 12, 'F');
    doc.setFontSize(14);
    doc.setFont('helvetica', 'bold');
    doc.setTextColor(126, 34, 206);
    doc.text('Step 3: Document Your Notes', margin + 5, yPos + 5);
    yPos += 15;

    doc.setFontSize(11);
    doc.setFont('helvetica', 'normal');
    doc.setTextColor(60, 60, 60);

    const step3Lines = doc.splitTextToSize(
      'Enter your clinical observations and assessments. You can type or use voice dictation. The system supports smart auto-complete - start typing trigger words like "lungs", "heart", or "wound" to get quick phrase suggestions.',
      contentWidth
    );
    step3Lines.forEach(line => {
      yPos = checkNewPage();
      doc.text(line, margin + 3, yPos);
      yPos += 6;
    });
    yPos += 5;

    doc.setFont('helvetica', 'bold');
    doc.text('Voice Dictation:', margin + 3, yPos);
    yPos += 6;
    doc.setFont('helvetica', 'normal');
    const voiceLines = doc.splitTextToSize(
      'Click "Start Dictating" to use speech-to-text. The system will transcribe your speech in real-time. Speak naturally and the AI will format your notes appropriately.',
      contentWidth - 6
    );
    voiceLines.forEach(line => {
      doc.text(line, margin + 6, yPos);
      yPos += 5;
    });
    yPos += 5;

    doc.setFont('helvetica', 'bold');
    doc.text('Smart Auto-Complete:', margin + 3, yPos);
    yPos += 6;
    doc.setFont('helvetica', 'normal');
    const autoLines = doc.splitTextToSize(
      'As you type, the system suggests common clinical phrases based on your diagnosis and context. Press Tab or Enter to accept suggestions.',
      contentWidth - 6
    );
    autoLines.forEach(line => {
      doc.text(line, margin + 6, yPos);
      yPos += 5;
    });
    yPos += 5;

    // AI Compliance Checks
    yPos = checkNewPage(40);
    doc.setFillColor(254, 243, 199);
    doc.rect(margin, yPos - 3, contentWidth, 12, 'F');
    doc.setFontSize(14);
    doc.setFont('helvetica', 'bold');
    doc.setTextColor(180, 83, 9);
    doc.text('AI Compliance & Quality Suggestions', margin + 5, yPos + 5);
    yPos += 15;

    doc.setFontSize(11);
    doc.setFont('helvetica', 'normal');
    doc.setTextColor(60, 60, 60);
    const aiLines = doc.splitTextToSize(
      'Once your note reaches 100 characters, the AI will automatically analyze it and provide real-time suggestions in two categories:',
      contentWidth
    );
    aiLines.forEach(line => {
      yPos = checkNewPage();
      doc.text(line, margin + 3, yPos);
      yPos += 6;
    });
    yPos += 5;

    const aiChecks = [
      {
        title: 'Compliance Checks',
        items: [
          'Homebound Status: Verifies documentation of why leaving home is taxing',
          'Skilled Need: Ensures RN-level skills are clearly justified',
          'Patient Response: Checks for documented patient understanding/teach-back',
          'Functional Assessment: Validates ADL/mobility documentation',
          'Safety/Risk Factors: Identifies documented fall risks and safety measures'
        ]
      },
      {
        title: 'Quality Improvements',
        items: [
          'Vague Language: Flags phrases like "doing well" or "stable" that need specificity',
          'Missing Measurements: Identifies where objective data should be added',
          'Grammar & Clarity: Suggests improvements for professional documentation',
          'Clinical Detail: Recommends adding condition-specific details'
        ]
      }
    ];

    aiChecks.forEach(category => {
      yPos = checkNewPage(30);
      doc.setFont('helvetica', 'bold');
      doc.setTextColor(30, 58, 138);
      doc.text(category.title, margin + 3, yPos);
      yPos += 7;
      
      doc.setFont('helvetica', 'normal');
      doc.setTextColor(60, 60, 60);
      category.items.forEach(item => {
        yPos = checkNewPage(10);
        const itemLines = doc.splitTextToSize(`• ${item}`, contentWidth - 10);
        itemLines.forEach(line => {
          doc.text(line, margin + 6, yPos);
          yPos += 5;
        });
        yPos += 1;
      });
      yPos += 5;
    });

    doc.setFont('helvetica', 'bold');
    doc.text('How to Use Suggestions:', margin + 3, yPos);
    yPos += 6;
    doc.setFont('helvetica', 'normal');
    const suggestLines = [
      '1. Review each suggestion in the sidebar',
      '2. Click "Apply" to add compliance text or fix quality issues',
      '3. Click "Apply All" to implement all suggestions at once',
      '4. Suggestions adapt as you make changes to your note'
    ];
    suggestLines.forEach(line => {
      yPos = checkNewPage();
      doc.text(line, margin + 6, yPos);
      yPos += 5;
    });
    yPos += 5;

    // Step 4
    yPos = checkNewPage(40);
    doc.setFillColor(243, 232, 255);
    doc.rect(margin, yPos - 3, contentWidth, 12, 'F');
    doc.setFontSize(14);
    doc.setFont('helvetica', 'bold');
    doc.setTextColor(109, 40, 217);
    doc.text('Step 4: Enhance with AI', margin + 5, yPos + 5);
    yPos += 15;

    doc.setFontSize(11);
    doc.setFont('helvetica', 'normal');
    doc.setTextColor(60, 60, 60);
    const enhanceLines = doc.splitTextToSize(
      'Once your rough notes are complete (minimum 20 characters), click "Enhance with AI" to transform them into Medicare-compliant clinical documentation.',
      contentWidth
    );
    enhanceLines.forEach(line => {
      yPos = checkNewPage();
      doc.text(line, margin + 3, yPos);
      yPos += 6;
    });
    yPos += 5;

    doc.setFont('helvetica', 'bold');
    doc.text('What the AI Does:', margin + 3, yPos);
    yPos += 7;
    doc.setFont('helvetica', 'normal');
    
    const enhanceItems = [
      'Converts informal language to professional clinical terminology',
      'Adds Medicare-required elements (homebound status, skilled need, patient response)',
      'Integrates vital signs and patient history contextually',
      'Structures content in proper narrative format',
      'Ensures diagnosis-specific documentation standards',
      'References active care plans and OASIS data when available',
      'Removes any meta-commentary about documentation itself'
    ];

    enhanceItems.forEach(item => {
      yPos = checkNewPage(10);
      const itemLines = doc.splitTextToSize(`• ${item}`, contentWidth - 10);
      itemLines.forEach(line => {
        doc.text(line, margin + 6, yPos);
        yPos += 5;
      });
      yPos += 1;
    });
    yPos += 5;

    // Step 5
    yPos = checkNewPage(40);
    doc.setFillColor(236, 253, 245);
    doc.rect(margin, yPos - 3, contentWidth, 12, 'F');
    doc.setFontSize(14);
    doc.setFont('helvetica', 'bold');
    doc.setTextColor(6, 95, 70);
    doc.text('Step 5: Review & Finalize', margin + 5, yPos + 5);
    yPos += 15;

    doc.setFontSize(11);
    doc.setFont('helvetica', 'normal');
    doc.setTextColor(60, 60, 60);

    const finalizeItems = [
      { label: 'Review Enhanced Note', desc: 'Read through the AI-enhanced note. Yellow highlights indicate areas that may need your attention or completion.' },
      { label: 'Edit if Needed', desc: 'The enhanced note is fully editable. Make any necessary adjustments to ensure accuracy.' },
      { label: 'Copy to Clipboard', desc: 'Click "Copy to Clipboard" to copy the note for pasting into your EHR system.' },
      { label: 'Save to System', desc: 'Click "Save Note" to store the visit documentation in Penn Sync for future reference.' },
      { label: 'Generate Tasks', desc: 'Optionally generate follow-up tasks based on the visit documentation.' },
      { label: 'Generate Care Plans', desc: 'Create or update care plans based on assessment findings.' }
    ];

    finalizeItems.forEach(item => {
      yPos = checkNewPage(15);
      doc.setFont('helvetica', 'bold');
      doc.text(`• ${item.label}:`, margin + 3, yPos);
      yPos += 6;
      doc.setFont('helvetica', 'normal');
      const descLines = doc.splitTextToSize(item.desc, contentWidth - 10);
      descLines.forEach(line => {
        doc.text(line, margin + 8, yPos);
        yPos += 5;
      });
      yPos += 2;
    });
    yPos += 5;

    // Best Practices
    yPos = checkNewPage(40);
    doc.setFillColor(239, 246, 255);
    doc.rect(margin, yPos - 3, contentWidth, 12, 'F');
    doc.setFontSize(14);
    doc.setFont('helvetica', 'bold');
    doc.setTextColor(29, 78, 216);
    doc.text('Best Practices & Tips', margin + 5, yPos + 5);
    yPos += 15;

    doc.setFontSize(11);
    doc.setFont('helvetica', 'normal');
    doc.setTextColor(60, 60, 60);

    const tips = [
      'Be Specific: Include measurable, objective data rather than vague descriptions',
      'Use Voice Dictation: Speak naturally while examining the patient to capture real-time observations',
      'Apply AI Suggestions: Address compliance suggestions before enhancing for best results',
      'Review Yellow Highlights: These indicate areas where additional detail may improve documentation',
      'Include Patient Quotes: Document patient\'s own words when discussing symptoms or understanding',
      'Reference Previous Visits: The system shows recent visit data to help you document changes',
      'Use Quick Phrases: Type trigger words for instant access to common clinical descriptions',
      'Save Regularly: Use "Save Note" to preserve your work in the system database'
    ];

    tips.forEach(tip => {
      yPos = checkNewPage(12);
      const tipLines = doc.splitTextToSize(`• ${tip}`, contentWidth - 6);
      tipLines.forEach(line => {
        doc.text(line, margin + 3, yPos);
        yPos += 5;
      });
      yPos += 2;
    });
    yPos += 5;

    // Troubleshooting
    yPos = checkNewPage(40);
    doc.setFillColor(254, 242, 242);
    doc.rect(margin, yPos - 3, contentWidth, 12, 'F');
    doc.setFontSize(14);
    doc.setFont('helvetica', 'bold');
    doc.setTextColor(185, 28, 28);
    doc.text('Troubleshooting', margin + 5, yPos + 5);
    yPos += 15;

    doc.setFontSize(11);
    doc.setFont('helvetica', 'normal');
    doc.setTextColor(60, 60, 60);

    const troubleshoot = [
      { issue: 'Voice dictation not working', solution: 'Ensure your browser has microphone permissions enabled. Chrome and Edge work best.' },
      { issue: 'AI suggestions not appearing', solution: 'Make sure your note has at least 100 characters and you\'ve selected a patient and diagnosis.' },
      { issue: 'Enhanced note too generic', solution: 'Add more specific details in your rough notes. Include measurements, patient responses, and observations.' },
      { issue: 'Missing compliance elements', solution: 'Apply the AI compliance suggestions before enhancing. The AI needs context to add required elements.' }
    ];

    troubleshoot.forEach(item => {
      yPos = checkNewPage(20);
      doc.setFont('helvetica', 'bold');
      doc.text(`Issue: ${item.issue}`, margin + 3, yPos);
      yPos += 6;
      doc.setFont('helvetica', 'normal');
      const solLines = doc.splitTextToSize(`Solution: ${item.solution}`, contentWidth - 6);
      solLines.forEach(line => {
        doc.text(line, margin + 3, yPos);
        yPos += 5;
      });
      yPos += 4;
    });

    // Footer on last page
    doc.setFillColor(66, 133, 244);
    doc.rect(0, pageHeight - 25, pageWidth, 25, 'F');
    doc.setFontSize(10);
    doc.setFont('helvetica', 'normal');
    doc.setTextColor(255, 255, 255);
    doc.text('Penn Sync - Smart Note Assistant Guide', pageWidth / 2, pageHeight - 15, { align: 'center' });
    doc.text(`Generated: ${new Date().toLocaleDateString()}`, pageWidth / 2, pageHeight - 8, { align: 'center' });

    // Generate PDF
    const pdfBytes = doc.output('arraybuffer');
    
    // Convert to base64 more safely
    const uint8Array = new Uint8Array(pdfBytes);
    let binary = '';
    const chunkSize = 0x8000; // 32KB chunks
    
    for (let i = 0; i < uint8Array.length; i += chunkSize) {
      const chunk = uint8Array.subarray(i, Math.min(i + chunkSize, uint8Array.length));
      binary += String.fromCharCode(...chunk);
    }
    
    const base64Pdf = btoa(binary);

    return Response.json({
      success: true,
      pdf: base64Pdf,
      filename: 'Smart_Note_Assistant_User_Guide.pdf'
    });

  } catch (error) {
    console.error('Error generating guide:', error);
    return Response.json({ 
      error: error.message,
      stack: error.stack 
    }, { status: 500 });
  }
});