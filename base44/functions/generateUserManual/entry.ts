import { createClientFromRequest } from 'npm:@base44/sdk@0.8.31';
import { jsPDF } from 'npm:jspdf@2.5.2';

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
    let yPos = 20;

    // Brand colors
    const darkBlue = [15, 32, 74]; // #0F204A
    const yellow = [255, 193, 7]; // #FFC107
    const lightGray = [240, 242, 245];
    const textGray = [60, 60, 60];

    // Helper: Add new page if needed
    const checkPageBreak = (spaceNeeded = 20) => {
      if (yPos + spaceNeeded > pageHeight - 20) {
        doc.addPage();
        yPos = 20;
        return true;
      }
      return false;
    };

    // Helper: Draw header on each page
    const drawHeader = () => {
      doc.setFillColor(...darkBlue);
      doc.rect(0, 0, pageWidth, 15, 'F');
      doc.setTextColor(255, 255, 255);
      doc.setFontSize(10);
      doc.text('PennSync User Manual', pageWidth / 2, 10, { align: 'center' });
    };

    // Cover Page
    doc.setFillColor(...darkBlue);
    doc.rect(0, 0, pageWidth, pageHeight, 'F');
    
    // Yellow accent bar
    doc.setFillColor(...yellow);
    doc.rect(0, 80, pageWidth, 8, 'F');
    
    // PennSync Logo (text-based)
    doc.setTextColor(255, 255, 255);
    doc.setFontSize(48);
    doc.setFont('helvetica', 'bold');
    doc.text('PennSync', pageWidth / 2, 60, { align: 'center' });
    
    // Subtitle
    doc.setFontSize(18);
    doc.setFont('helvetica', 'normal');
    doc.setTextColor(...yellow);
    doc.text('Comprehensive User Manual', pageWidth / 2, 100, { align: 'center' });
    
    // Version info
    doc.setFontSize(12);
    doc.setTextColor(200, 200, 200);
    doc.text('Version 1.0 | March 2026', pageWidth / 2, 115, { align: 'center' });
    
    // Introduction box
    doc.setFillColor(255, 255, 255, 0.1);
    doc.roundedRect(30, 140, pageWidth - 60, 80, 3, 3, 'F');
    
    doc.setFontSize(11);
    doc.setTextColor(255, 255, 255);
    const introLines = doc.splitTextToSize(
      'This system was designed and built by Kevin Deyarmin specifically for the Penn Home Health team. ' +
      'PennSync combines cutting-edge AI technology with Medicare-compliant documentation workflows to help you ' +
      'provide the highest quality patient care while reducing administrative burden. Every feature has been ' +
      'thoughtfully crafted to support your clinical excellence.',
      pageWidth - 80
    );
    doc.text(introLines, pageWidth / 2, 155, { align: 'center', maxWidth: pageWidth - 80 });
    
    // Footer
    doc.setFontSize(10);
    doc.setTextColor(150, 150, 150);
    doc.text('Empowering Excellence in Home Health Care', pageWidth / 2, pageHeight - 20, { align: 'center' });

    // TABLE OF CONTENTS
    doc.addPage();
    drawHeader();
    yPos = 30;
    
    doc.setFillColor(...darkBlue);
    doc.rect(0, yPos, pageWidth, 12, 'F');
    doc.setTextColor(255, 255, 255);
    doc.setFontSize(16);
    doc.setFont('helvetica', 'bold');
    doc.text('Table of Contents', 15, yPos + 8);
    yPos += 20;
    
    const sections = [
      { num: '1', title: 'Getting Started', page: 3 },
      { num: '2', title: 'Patient Management', page: 5 },
      { num: '3', title: 'Smart Notes & AI Documentation', page: 10 },
      { num: '4', title: 'Visit Scribe & Voice Documentation', page: 15 },
      { num: '5', title: 'OASIS Assessment Tools', page: 18 },
      { num: '6', title: 'Care Plan Management', page: 22 },
      { num: '7', title: 'Fax Management', page: 25 },
      { num: '8', title: 'Document Management', page: 28 },
      { num: '9', title: 'Clinical Library & Templates', page: 30 },
      { num: '10', title: 'Compliance & Quality Tools', page: 32 },
      { num: '11', title: 'Best Practices & Tips', page: 35 }
    ];
    
    doc.setFont('helvetica', 'normal');
    doc.setTextColor(...textGray);
    doc.setFontSize(11);
    
    sections.forEach(section => {
      checkPageBreak(10);
      doc.setFont('helvetica', 'bold');
      doc.text(`${section.num}.`, 20, yPos);
      doc.setFont('helvetica', 'normal');
      doc.text(section.title, 30, yPos);
      doc.text(`${section.page}`, pageWidth - 20, yPos, { align: 'right' });
      yPos += 8;
    });

    // SECTION 1: GETTING STARTED
    doc.addPage();
    drawHeader();
    yPos = 30;
    
    doc.setFillColor(...darkBlue);
    doc.rect(0, yPos, pageWidth, 12, 'F');
    doc.setTextColor(255, 255, 255);
    doc.setFontSize(16);
    doc.setFont('helvetica', 'bold');
    doc.text('1. Getting Started', 15, yPos + 8);
    yPos += 20;
    
    doc.setTextColor(...textGray);
    doc.setFontSize(11);
    doc.setFont('helvetica', 'normal');
    
    const intro = doc.splitTextToSize(
      'Welcome to PennSync! This manual will guide you through every feature of the system, ' +
      'ensuring you can leverage its full power to provide exceptional patient care.',
      pageWidth - 40
    );
    doc.text(intro, 20, yPos);
    yPos += intro.length * 6 + 10;
    
    // Login & Access
    doc.setFillColor(...yellow);
    doc.rect(20, yPos, 5, 5, 'F');
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(12);
    doc.text('Login & Access', 30, yPos + 4);
    yPos += 12;
    
    doc.setFont('helvetica', 'normal');
    doc.setFontSize(10);
    const loginSteps = [
      '1. Navigate to the PennSync URL provided by your administrator',
      '2. Enter your email address and password',
      '3. If first-time login, you\'ll be prompted to change your temporary password',
      '4. Upon successful login, you\'ll land on your personalized Dashboard'
    ];
    loginSteps.forEach(step => {
      checkPageBreak();
      doc.text(step, 25, yPos);
      yPos += 6;
    });
    yPos += 8;

    // Dashboard Overview
    checkPageBreak(30);
    doc.setFillColor(...yellow);
    doc.rect(20, yPos, 5, 5, 'F');
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(12);
    doc.text('Dashboard Overview', 30, yPos + 4);
    yPos += 12;
    
    doc.setFont('helvetica', 'normal');
    doc.setFontSize(10);
    const dashFeatures = doc.splitTextToSize(
      'Your Dashboard provides real-time insights into your caseload, pending tasks, and important alerts. ' +
      'Key widgets include: Today\'s Visits, Pending Tasks, Patient Alerts, Recent Activity, and Quick Actions. ' +
      'The dashboard automatically refreshes to show the most current information.',
      pageWidth - 50
    );
    doc.text(dashFeatures, 25, yPos);
    yPos += dashFeatures.length * 5 + 10;

    // Navigation
    checkPageBreak(25);
    doc.setFillColor(...yellow);
    doc.rect(20, yPos, 5, 5, 'F');
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(12);
    doc.text('Navigation', 30, yPos + 4);
    yPos += 12;
    
    doc.setFont('helvetica', 'normal');
    doc.setFontSize(10);
    const navItems = [
      'Sidebar (Desktop): Located on the left side of your screen. Click on any',
      '  menu item to navigate between features like Patients, Smart Notes, Fax, etc.',
      '',
      'Bottom Nav (Mobile): On mobile devices, you\'ll see icons at the bottom for',
      '  quick access to Dashboard, Patients, Messages, Smart Notes, and Menu.',
      '',
      'Breadcrumbs: At the top of each page, breadcrumb trail shows where you are',
      '  and allows one-click navigation back to previous sections.',
      '',
      'Search: Global search bar helps you quickly find patients by name or MRN,',
      '  locate documents, or jump to specific features.'
    ];
    
    navItems.forEach(item => {
      checkPageBreak();
      if (item === '') {
        yPos += 4;
      } else {
        const lines = doc.splitTextToSize(item, pageWidth - 50);
        doc.text(lines, 25, yPos);
        yPos += lines.length * 5;
      }
    });
    yPos += 12;

    // SECTION 2: PATIENT MANAGEMENT
    doc.addPage();
    drawHeader();
    yPos = 30;
    
    doc.setFillColor(...darkBlue);
    doc.rect(0, yPos, pageWidth, 12, 'F');
    doc.setTextColor(255, 255, 255);
    doc.setFontSize(16);
    doc.setFont('helvetica', 'bold');
    doc.text('2. Patient Management', 15, yPos + 8);
    yPos += 20;
    
    doc.setTextColor(...textGray);
    
    // Adding New Patients
    doc.setFillColor(...yellow);
    doc.rect(20, yPos, 5, 5, 'F');
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(12);
    doc.text('Adding New Patients', 30, yPos + 4);
    yPos += 12;
    
    doc.setFont('helvetica', 'normal');
    doc.setFontSize(10);
    
    const addPatientSteps = [
      '1. Click "Add Patient" button on the Patients page',
      '2. Fill in required fields: First Name, Last Name, Date of Birth',
      '3. Add contact information: Address, Phone, Emergency Contact',
      '4. Enter clinical information: Primary Diagnosis, Payor, Physician',
      '5. Optional: Add medications, allergies, and medical history',
      '6. Click "Create Patient" to save the record',
      '',
      'BEST PRACTICE: Complete as much demographic information as possible during',
      'initial patient setup. This data feeds into AI analysis tools and ensures',
      'accurate care planning and compliance documentation.'
    ];
    
    addPatientSteps.forEach(step => {
      checkPageBreak();
      if (step === '') {
        yPos += 4;
      } else if (step.startsWith('BEST PRACTICE:')) {
        doc.setFont('helvetica', 'italic');
        doc.setTextColor(100, 100, 100);
        const lines = doc.splitTextToSize(step, pageWidth - 50);
        doc.text(lines, 25, yPos);
        yPos += lines.length * 5 + 4;
        doc.setFont('helvetica', 'normal');
        doc.setTextColor(...textGray);
      } else {
        doc.text(step, 25, yPos);
        yPos += 6;
      }
    });
    yPos += 8;

    // Patient Search & Filtering
    checkPageBreak(30);
    doc.setFillColor(...yellow);
    doc.rect(20, yPos, 5, 5, 'F');
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(12);
    doc.text('Patient Search & Filtering', 30, yPos + 4);
    yPos += 12;
    
    doc.setFont('helvetica', 'normal');
    doc.setFontSize(10);
    const searchInfo = doc.splitTextToSize(
      'The Patients page includes powerful filtering capabilities: Search by name or MRN, filter by care type ' +
      '(Home Health/Hospice), status (Active/Discharged), diagnosis, or assigned nurse. Use the "Favorites" ' +
      'feature (star icon) to pin frequently accessed patients to the top of your lists.',
      pageWidth - 50
    );
    doc.text(searchInfo, 25, yPos);
    yPos += searchInfo.length * 5 + 10;

    // Viewing Patient Details
    checkPageBreak(35);
    doc.setFillColor(...yellow);
    doc.rect(20, yPos, 5, 5, 'F');
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(12);
    doc.text('Viewing Patient Details', 30, yPos + 4);
    yPos += 12;
    
    doc.setFont('helvetica', 'normal');
    doc.setFontSize(10);
    doc.text('Click any patient name to access their comprehensive chart with tabs:', 25, yPos);
    yPos += 8;
    
    const patientTabs = [
      'Overview Tab: Displays AI-generated dashboard summary showing patient status',
      '  at a glance, plus quick action buttons for common tasks.',
      '',
      'Vitals Tab: Interactive trend charts tracking vital signs over time. Hover',
      '  over data points to see specific values. Identifies concerning trends.',
      '',
      'History Tab: Complete medical history including all current medications,',
      '  documented allergies (shown with warning if present), and past conditions.',
      '',
      'Clinical Tab: Contact information section with patient address and phone,',
      '  emergency contact details, and assigned physician information.',
      '',
      'Events Tab: Chronological timeline showing all clinical events, medication',
      '  changes, hospitalizations, and significant status updates.',
      '',
      'AI Tools Tab: Advanced analysis tools including risk prediction, automated',
      '  task generation, deterioration alerts, and care coordination suggestions.',
      '',
      'Care Plans Tab: Shows all active care plans with problem/goal/intervention',
      '  structure. Includes AI-powered gap analysis to identify missing interventions.',
      '',
      'Documents Tab: All uploaded documents organized by category. Includes referral',
      '  PDFs, lab results, imaging reports, and auto-generated discharge summaries.'
    ];

    patientTabs.forEach(tab => {
      checkPageBreak();
      if (tab === '') {
        yPos += 4;
      } else {
        const lines = doc.splitTextToSize(tab, pageWidth - 55);
        doc.text(lines, 30, yPos);
        yPos += lines.length * 5;
      }
    });

    // SECTION 3: SMART NOTES & AI DOCUMENTATION
    doc.addPage();
    drawHeader();
    yPos = 30;
    
    doc.setFillColor(...darkBlue);
    doc.rect(0, yPos, pageWidth, 12, 'F');
    doc.setTextColor(255, 255, 255);
    doc.setFontSize(16);
    doc.setFont('helvetica', 'bold');
    doc.text('3. Smart Notes & AI Documentation', 15, yPos + 8);
    yPos += 20;
    
    doc.setTextColor(...textGray);
    doc.setFont('helvetica', 'normal');
    doc.setFontSize(10);
    
    const smartNoteIntro = doc.splitTextToSize(
      'Smart Notes is PennSync\'s most powerful feature - it transforms brief clinical observations into ' +
      'comprehensive, Medicare-compliant documentation using advanced AI. This section covers the complete workflow.',
      pageWidth - 40
    );
    doc.text(smartNoteIntro, 20, yPos);
    yPos += smartNoteIntro.length * 5 + 12;

    // Creating a Smart Note
    doc.setFillColor(...yellow);
    doc.rect(20, yPos, 5, 5, 'F');
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(12);
    doc.text('Creating a Smart Note - Step by Step', 30, yPos + 4);
    yPos += 12;
    
    doc.setFont('helvetica', 'normal');
    doc.setFontSize(10);
    
    const smartNoteSteps = [
      'STEP 1: Patient Selection',
      '• Navigate to Smart Note Assistant from the main menu',
      '• Select patient from dropdown (use search to find quickly)',
      '• CRITICAL: Always select a patient - this saves data to their file',
      '',
      'STEP 2: Enter Visit Information',
      '• Set visit date and time',
      '• Choose visit type (Skilled Nursing, Admission, Recert, etc.)',
      '• Document vital signs in structured format',
      '  - AI validates ranges and flags abnormal values automatically',
      '',
      'STEP 3: Clinical Observations',
      '• Type your observations in plain language',
      '• Use bullet points or narrative format - AI understands both',
      '• Include: Patient status, interventions performed, patient response',
      '• Mention medications, education provided, safety concerns',
      '',
      'STEP 4: AI Enhancement',
      '• Click "Enhance with AI" button',
      '• AI analyzes your notes and generates Medicare-compliant narrative',
      '• Reviews include: skilled terminology, medical necessity language,',
      '  homebound justification, clinical detail expansion',
      '',
      'STEP 5: Review & Refine',
      '• Review AI-generated note in the preview panel',
      '• Edit directly if adjustments needed',
      '• Use "Regenerate" if you want AI to try again with different phrasing',
      '',
      'STEP 6: Save & Actions',
      '• Click "Save Note" to store in patient chart',
      '• Optionally send family update (auto-generates patient-friendly summary)',
      '• Review AI-generated follow-up tasks and add to task list',
      '• Generate patient education materials based on visit content'
    ];
    
    smartNoteSteps.forEach(step => {
      checkPageBreak();
      if (step === '') {
        yPos += 4;
      } else if (step.startsWith('STEP')) {
        doc.setFont('helvetica', 'bold');
        doc.setFillColor(...lightGray);
        doc.rect(20, yPos - 3, pageWidth - 40, 7, 'F');
        doc.text(step, 25, yPos + 2);
        yPos += 10;
        doc.setFont('helvetica', 'normal');
      } else {
        doc.text(step, 25, yPos);
        yPos += 5;
      }
    });
    
    yPos += 10;
    checkPageBreak(30);
    
    // Best Practices for Smart Notes
    doc.setFillColor(...darkBlue);
    doc.rect(20, yPos, pageWidth - 40, 6, 'F');
    doc.setTextColor(255, 255, 255);
    doc.setFontSize(11);
    doc.setFont('helvetica', 'bold');
    doc.text('BEST PRACTICES FOR SMART NOTES', 25, yPos + 4);
    yPos += 12;
    
    doc.setTextColor(...textGray);
    doc.setFont('helvetica', 'normal');
    doc.setFontSize(9);
    
    const bestPractices = [
      '✓ Be specific about patient response: Instead of "patient doing well", write',
      '  "patient reports pain reduced from 7/10 to 3/10 with current medication regimen"',
      '',
      '✓ Document medical necessity: Include why skilled nursing is required',
      '  Example: "Skilled assessment needed due to complex medication regimen and',
      '  unstable blood sugar requiring daily monitoring and insulin adjustment"',
      '',
      '✓ Include teaching: Note education provided and patient comprehension',
      '  Example: "Instructed on wound care technique, patient demonstrated proper',
      '  technique with 100% accuracy"',
      '',
      '✓ Safety observations: Always document safety concerns and interventions',
      '  Example: "Fall risk noted due to unsteady gait, instructed on walker use"',
      '',
      '✓ Quantify when possible: Use measurements, percentages, pain scales',
      '  AI enhances these objective findings into stronger documentation'
    ];
    
    doc.setFillColor(250, 250, 250);
    doc.rect(20, yPos, pageWidth - 40, bestPractices.length * 5 + 10, 'F');
    
    bestPractices.forEach(line => {
      checkPageBreak();
      if (line === '') {
        yPos += 3;
      } else {
        const wrapped = doc.splitTextToSize(line, pageWidth - 55);
        doc.text(wrapped, 25, yPos);
        yPos += wrapped.length * 4.5;
      }
    });

    // SECTION 4: VISIT SCRIBE
    doc.addPage();
    drawHeader();
    yPos = 30;
    
    doc.setFillColor(...darkBlue);
    doc.rect(0, yPos, pageWidth, 12, 'F');
    doc.setTextColor(255, 255, 255);
    doc.setFontSize(16);
    doc.setFont('helvetica', 'bold');
    doc.text('4. Visit Scribe & Voice Documentation', 15, yPos + 8);
    yPos += 20;
    
    doc.setTextColor(...textGray);
    doc.setFontSize(10);
    doc.setFont('helvetica', 'normal');
    
    const scribeIntro = doc.splitTextToSize(
      'Visit Scribe converts your voice recordings into structured clinical notes automatically. ' +
      'Perfect for documenting visits in real-time or immediately after leaving the patient\'s home.',
      pageWidth - 40
    );
    doc.text(scribeIntro, 20, yPos);
    yPos += scribeIntro.length * 5 + 12;

    // Voice Recording Workflow
    doc.setFillColor(...yellow);
    doc.rect(20, yPos, 5, 5, 'F');
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(12);
    doc.text('Voice Recording Workflow', 30, yPos + 4);
    yPos += 12;
    
    doc.setFont('helvetica', 'normal');
    doc.setFontSize(10);
    
    const scribeSteps = [
      'METHOD 1: Live Recording',
      '• Go to Visit Scribe page',
      '• Click "Start Recording" button',
      '• Speak naturally about the visit (patient status, interventions, findings)',
      '• Click "Stop Recording" when finished',
      '• AI automatically transcribes and generates clinical note',
      '',
      'METHOD 2: Upload Audio File',
      '• Record visit notes on your phone or recording device',
      '• Upload .mp3, .wav, or .m4a file via "Upload Audio" tab',
      '• AI processes the file and generates documentation',
      '',
      'METHOD 3: File Upload (Any Format)',
      '• Upload existing documents, dictations, or notes',
      '• AI extracts clinical information and structures it',
      '',
      'WHAT TO SAY DURING RECORDING:',
      '✓ State patient name and date at beginning',
      '✓ Describe patient appearance and mood',
      '✓ List vital signs clearly (e.g., "Blood pressure 130 over 80")',
      '✓ Describe interventions performed',
      '✓ Note patient response and comprehension',
      '✓ Mention safety concerns or changes in condition',
      '✓ State education provided',
      '',
      'AI PROCESSING:',
      'Once uploaded, the AI:',
      '• Transcribes audio to text',
      '• Extracts vital signs, medications, clinical observations',
      '• Generates Medicare-compliant narrative',
      '• Identifies required follow-up tasks',
      '• Flags potential alerts or safety concerns',
      '',
      'BEST PRACTICE: Record immediately after the visit while details are fresh.',
      'Keep recordings 2-5 minutes for optimal AI processing. Speak clearly and',
      'include all OASIS-relevant observations for complete documentation.'
    ];
    
    scribeSteps.forEach(step => {
      checkPageBreak();
      if (step === '') {
        yPos += 4;
      } else if (step.startsWith('METHOD') || step.startsWith('WHAT TO SAY') || step.startsWith('AI PROCESSING')) {
        doc.setFont('helvetica', 'bold');
        doc.setFillColor(...lightGray);
        doc.rect(20, yPos - 3, pageWidth - 40, 7, 'F');
        doc.text(step, 25, yPos + 2);
        yPos += 10;
        doc.setFont('helvetica', 'normal');
      } else if (step.startsWith('BEST PRACTICE:')) {
        doc.setFont('helvetica', 'italic');
        doc.setTextColor(100, 100, 100);
        const lines = doc.splitTextToSize(step, pageWidth - 50);
        doc.text(lines, 25, yPos);
        yPos += lines.length * 5 + 4;
        doc.setFont('helvetica', 'normal');
        doc.setTextColor(...textGray);
      } else {
        doc.text(step, 25, yPos);
        yPos += 5;
      }
    });

    // SECTION 5: OASIS ASSESSMENT
    doc.addPage();
    drawHeader();
    yPos = 30;
    
    doc.setFillColor(...darkBlue);
    doc.rect(0, yPos, pageWidth, 12, 'F');
    doc.setTextColor(255, 255, 255);
    doc.setFontSize(16);
    doc.setFont('helvetica', 'bold');
    doc.text('5. OASIS Assessment Tools', 15, yPos + 8);
    yPos += 20;
    
    doc.setTextColor(...textGray);
    doc.setFontSize(10);
    doc.setFont('helvetica', 'normal');
    
    const oasisIntro = doc.splitTextToSize(
      'PennSync provides multiple OASIS tools: Smart OASIS Assessment with AI suggestions, ' +
      'PDF upload analyzer, compliance checker, and PDGM analyzer. These tools ensure accurate, ' +
      'compliant assessments while maximizing reimbursement.',
      pageWidth - 40
    );
    doc.text(oasisIntro, 20, yPos);
    yPos += oasisIntro.length * 5 + 12;

    // Smart OASIS Workflow
    doc.setFillColor(...yellow);
    doc.rect(20, yPos, 5, 5, 'F');
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(12);
    doc.text('Smart OASIS Assessment Workflow', 30, yPos + 4);
    yPos += 12;
    
    doc.setFont('helvetica', 'normal');
    doc.setFontSize(10);
    
    const oasisSteps = [
      '1. Select patient from dropdown',
      '2. Choose assessment type (Start of Care, Recert, Discharge, etc.)',
      '3. Begin answering OASIS questions in guided format',
      '4. AI provides real-time suggestions based on:',
      '   • Patient history and previous assessments',
      '   • Recent visit notes and clinical observations',
      '   • Diagnosis-specific best practices',
      '   • CMS compliance requirements',
      '5. Review compliance warnings if any items are flagged',
      '6. Complete all required sections',
      '7. Generate PDGM analysis to see case mix impact',
      '8. Save or export completed assessment',
      '',
      'KEY FEATURES:',
      '• Auto-population from patient chart data',
      '• Real-time compliance checking',
      '• Suggested responses based on clinical context',
      '• PDGM case mix calculator',
      '• Gap identification (missing high-value items)',
      '',
      'BEST PRACTICE: Review AI suggestions but always verify they match your',
      'clinical observations. The AI learns from patient history but you are the',
      'clinical expert. Use the compliance warnings to catch common errors before',
      'submission. Run PDGM analysis before finalizing to optimize reimbursement.'
    ];
    
    oasisSteps.forEach(step => {
      checkPageBreak();
      if (step === '') {
        yPos += 4;
      } else if (step.startsWith('KEY FEATURES:')) {
        doc.setFont('helvetica', 'bold');
        doc.setFillColor(...lightGray);
        doc.rect(20, yPos - 3, pageWidth - 40, 7, 'F');
        doc.text(step, 25, yPos + 2);
        yPos += 10;
        doc.setFont('helvetica', 'normal');
      } else if (step.startsWith('BEST PRACTICE:')) {
        doc.setFont('helvetica', 'italic');
        doc.setTextColor(100, 100, 100);
        const lines = doc.splitTextToSize(step, pageWidth - 50);
        doc.text(lines, 25, yPos);
        yPos += lines.length * 5 + 4;
        doc.setFont('helvetica', 'normal');
        doc.setTextColor(...textGray);
      } else {
        const lines = doc.splitTextToSize(step, pageWidth - 50);
        doc.text(lines, 25, yPos);
        yPos += lines.length * 5;
      }
    });

    // SECTION 6: CARE PLAN MANAGEMENT
    doc.addPage();
    drawHeader();
    yPos = 30;
    
    doc.setFillColor(...darkBlue);
    doc.rect(0, yPos, pageWidth, 12, 'F');
    doc.setTextColor(255, 255, 255);
    doc.setFontSize(16);
    doc.setFont('helvetica', 'bold');
    doc.text('6. Care Plan Management', 15, yPos + 8);
    yPos += 20;
    
    doc.setTextColor(...textGray);
    
    // AI Care Plan Suggestions
    doc.setFillColor(...yellow);
    doc.rect(20, yPos, 5, 5, 'F');
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(12);
    doc.text('AI Care Plan Suggestions', 30, yPos + 4);
    yPos += 12;
    
    doc.setFont('helvetica', 'normal');
    doc.setFontSize(10);
    
    const carePlanInfo = doc.splitTextToSize(
      'PennSync analyzes patient diagnoses, medications, and visit notes to suggest evidence-based care plans. ' +
      'On the Patient Details page, navigate to the Care Plans tab to access AI suggestions. The system ' +
      'recommends problems, goals, and interventions aligned with Medicare guidelines. You can accept, modify, ' +
      'or reject suggestions - AI adapts to your clinical judgment over time.',
      pageWidth - 50
    );
    doc.text(carePlanInfo, 25, yPos);
    yPos += carePlanInfo.length * 5 + 12;

    // Care Plan Builder
    checkPageBreak(30);
    doc.setFillColor(...yellow);
    doc.rect(20, yPos, 5, 5, 'F');
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(12);
    doc.text('Care Plan Builder (Visual Canvas)', 30, yPos + 4);
    yPos += 12;
    
    doc.setFont('helvetica', 'normal');
    doc.setFontSize(10);
    
    const builderSteps = [
      '• Access via Care Plan Management page',
      '• Drag-and-drop interface for creating comprehensive care plans',
      '• Library of evidence-based interventions organized by category',
      '• Link interventions to specific diagnoses',
      '• Set measurable goals with target dates',
      '• Track progress over time with visual timeline',
      '',
      'BEST PRACTICE: Use the Intervention Library to ensure Medicare-compliant',
      'language. Link multiple interventions to each problem for comprehensive coverage.',
      'Set realistic, measurable goals with specific timeframes.'
    ];
    
    builderSteps.forEach(step => {
      checkPageBreak();
      if (step === '') {
        yPos += 4;
      } else if (step.startsWith('BEST PRACTICE:')) {
        doc.setFont('helvetica', 'italic');
        doc.setTextColor(100, 100, 100);
        const lines = doc.splitTextToSize(step, pageWidth - 50);
        doc.text(lines, 25, yPos);
        yPos += lines.length * 5 + 4;
        doc.setFont('helvetica', 'normal');
        doc.setTextColor(...textGray);
      } else {
        doc.text(step, 25, yPos);
        yPos += 5;
      }
    });

    // SECTION 7: FAX MANAGEMENT
    doc.addPage();
    drawHeader();
    yPos = 30;
    
    doc.setFillColor(...darkBlue);
    doc.rect(0, yPos, pageWidth, 12, 'F');
    doc.setTextColor(255, 255, 255);
    doc.setFontSize(16);
    doc.setFont('helvetica', 'bold');
    doc.text('7. Fax Management', 15, yPos + 8);
    yPos += 20;
    
    doc.setTextColor(...textGray);
    
    doc.setFontSize(10);
    doc.setFont('helvetica', 'normal');
    const faxIntro = doc.splitTextToSize(
      'Send faxes directly from PennSync to physicians, hospitals, and other healthcare providers. ' +
      'Supports document uploads, mobile camera capture, and batch sending to multiple recipients. ' +
      'All faxes are tracked with delivery confirmation. Note: PennSync is send-only - receiving ' +
      'faxes is not supported.',
      pageWidth - 40
    );
    doc.text(faxIntro, 20, yPos);
    yPos += faxIntro.length * 5 + 12;

    // Sending a Fax
    doc.setFillColor(...yellow);
    doc.rect(20, yPos, 5, 5, 'F');
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(12);
    doc.text('Sending a Fax - Multiple Methods', 30, yPos + 4);
    yPos += 12;
    
    doc.setFont('helvetica', 'normal');
    doc.setFontSize(10);
    
    const faxMethods = [
      'PHOTO METHOD (Mobile-Friendly):',
      '1. Navigate to Send Fax page',
      '2. Click "Photo" tab',
      '3. Upload image(s) of documents from your phone or computer',
      '4. AI generates professional cover page',
      '5. Enter recipient fax number(s)',
      '6. Click "Send Fax"',
      '',
      'CAMERA METHOD (Instant Capture):',
      '1. Click "Camera" tab',
      '2. Use device camera to capture document pages',
      '3. Review and add multiple pages if needed',
      '4. System compiles into PDF automatically',
      '5. Add recipients and send',
      '',
      'DOCUMENT METHOD (PDF Upload):',
      '1. Click "Documents" tab',
      '2. Upload existing PDF file',
      '3. Optionally add custom cover page',
      '4. Enter recipient details',
      '5. Send immediately or schedule for later',
      '',
      'BATCH METHOD (Multiple Recipients):',
      '1. Click "Batch" tab',
      '2. Upload one document',
      '3. Add multiple recipient fax numbers',
      '4. System sends to all recipients with delivery tracking',
      '',
      'TEMPLATES:',
      'Save frequently used fax configurations as templates for one-click sending.',
      'Access via "Templates" tab.',
      '',
      'BEST PRACTICE: Always review the auto-generated cover page before sending.',
      'Use the Address Book (Fax Contacts page) to save frequent recipients.',
      'For urgent faxes, mark as "Urgent" priority for automatic retry if failed.'
    ];
    
    faxMethods.forEach(step => {
      checkPageBreak();
      if (step === '') {
        yPos += 4;
      } else if (step.includes('METHOD') || step === 'TEMPLATES:') {
        doc.setFont('helvetica', 'bold');
        doc.setFillColor(...lightGray);
        doc.rect(20, yPos - 3, pageWidth - 40, 7, 'F');
        doc.text(step, 25, yPos + 2);
        yPos += 10;
        doc.setFont('helvetica', 'normal');
      } else if (step.startsWith('BEST PRACTICE:')) {
        doc.setFont('helvetica', 'italic');
        doc.setTextColor(100, 100, 100);
        const lines = doc.splitTextToSize(step, pageWidth - 50);
        doc.text(lines, 25, yPos);
        yPos += lines.length * 5 + 4;
        doc.setFont('helvetica', 'normal');
        doc.setTextColor(...textGray);
      } else {
        const lines = doc.splitTextToSize(step, pageWidth - 50);
        doc.text(lines, 25, yPos);
        yPos += lines.length * 5;
      }
    });

    // SECTION 8: DOCUMENT MANAGEMENT
    doc.addPage();
    drawHeader();
    yPos = 30;
    
    doc.setFillColor(...darkBlue);
    doc.rect(0, yPos, pageWidth, 12, 'F');
    doc.setTextColor(255, 255, 255);
    doc.setFontSize(16);
    doc.setFont('helvetica', 'bold');
    doc.text('8. Document Management', 15, yPos + 8);
    yPos += 20;
    
    doc.setTextColor(...textGray);
    
    // Document Upload & AI Analysis
    doc.setFillColor(...yellow);
    doc.rect(20, yPos, 5, 5, 'F');
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(12);
    doc.text('Uploading & Analyzing Documents', 30, yPos + 4);
    yPos += 12;
    
    doc.setFont('helvetica', 'normal');
    doc.setFontSize(10);
    
    const docSteps = [
      '1. From Patient Details page, go to Documents tab',
      '2. Click "Upload Document" button',
      '3. Select document category (Lab Results, Imaging, Consent Forms, etc.)',
      '4. Choose file (PDF, JPG, PNG supported)',
      '5. AI automatically analyzes document and:',
      '   • Extracts key data points (lab values, diagnoses, etc.)',
      '   • Generates summary of contents',
      '   • Flags critical findings requiring immediate attention',
      '   • Suggests appropriate document category if not specified',
      '6. Review AI analysis results',
      '7. Add manual notes or tags if needed',
      '8. Save to patient chart',
      '',
      'AI CRITICAL FINDINGS ALERTS:',
      'If AI detects critical lab values, urgent recommendations, or safety concerns,',
      'it automatically creates high-priority alerts visible on the patient\'s chart',
      'and in the Dashboard alert widget.',
      '',
      'BEST PRACTICE: Upload documents as soon as received. AI analysis helps',
      'identify actionable items immediately. Use document tags for easy retrieval.',
      'Review critical findings flags daily on your Dashboard.'
    ];
    
    docSteps.forEach(step => {
      checkPageBreak();
      if (step === '') {
        yPos += 4;
      } else if (step.includes('ALERTS:')) {
        doc.setFont('helvetica', 'bold');
        doc.setFillColor(...lightGray);
        doc.rect(20, yPos - 3, pageWidth - 40, 7, 'F');
        doc.text(step, 25, yPos + 2);
        yPos += 10;
        doc.setFont('helvetica', 'normal');
      } else if (step.startsWith('BEST PRACTICE:')) {
        doc.setFont('helvetica', 'italic');
        doc.setTextColor(100, 100, 100);
        const lines = doc.splitTextToSize(step, pageWidth - 50);
        doc.text(lines, 25, yPos);
        yPos += lines.length * 5 + 4;
        doc.setFont('helvetica', 'normal');
        doc.setTextColor(...textGray);
      } else {
        const lines = doc.splitTextToSize(step, pageWidth - 50);
        doc.text(lines, 25, yPos);
        yPos += lines.length * 5;
      }
    });

    // SECTION 9: CLINICAL LIBRARY
    doc.addPage();
    drawHeader();
    yPos = 30;
    
    doc.setFillColor(...darkBlue);
    doc.rect(0, yPos, pageWidth, 12, 'F');
    doc.setTextColor(255, 255, 255);
    doc.setFontSize(16);
    doc.setFont('helvetica', 'bold');
    doc.text('9. Clinical Library & Quick Phrases', 15, yPos + 8);
    yPos += 20;
    
    doc.setTextColor(...textGray);
    doc.setFont('helvetica', 'normal');
    doc.setFontSize(10);
    
    const libraryIntro = doc.splitTextToSize(
      'Clinical Library allows you to create reusable phrases that expand into full Medicare-compliant ' +
      'documentation. Type a short trigger phrase like "diabetic education" and AI expands it into ' +
      'complete teaching documentation with patient-specific details.',
      pageWidth - 40
    );
    doc.text(libraryIntro, 20, yPos);
    yPos += libraryIntro.length * 5 + 12;

    // Using Quick Phrases
    doc.setFillColor(...yellow);
    doc.rect(20, yPos, 5, 5, 'F');
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(12);
    doc.text('Creating & Using Quick Phrases', 30, yPos + 4);
    yPos += 12;
    
    doc.setFont('helvetica', 'normal');
    doc.setFontSize(10);
    
    const phraseSteps = [
      'CREATING A TEMPLATE:',
      '1. Go to Clinical Library page',
      '2. Click "Add New Template"',
      '3. Enter trigger phrase (e.g., "wound care provided")',
      '4. Choose template type:',
      '   • Generic: Same text for all patients',
      '   • Patient-Specific: Pulls patient data automatically',
      '5. Write the expanded template text',
      '6. Use variables like {{patient_name}}, {{medications}}, {{diagnosis}}',
      '7. Save template',
      '',
      'USING IN SMART NOTES:',
      '1. While writing a clinical note, type your trigger phrase',
      '2. Press Tab or click suggestion to expand',
      '3. AI fills in patient-specific data automatically',
      '4. Review and adjust as needed',
      '',
      'EXAMPLE TEMPLATES:',
      '• "wound care provided" → Full wound assessment and care documentation',
      '• "diabetic education" → Complete diabetes teaching with teach-back',
      '• "fall risk assessment" → Standardized fall risk evaluation',
      '• "med review" → Medication reconciliation with patient details',
      '',
      'BEST PRACTICE: Create templates for your most common documentation tasks.',
      'Use patient-specific variables to save time while ensuring accuracy.',
      'Organize templates into folders by category (Assessments, Education, etc.)'
    ];
    
    phraseSteps.forEach(step => {
      checkPageBreak();
      if (step === '') {
        yPos += 4;
      } else if (step.includes(':') && step === step.toUpperCase()) {
        doc.setFont('helvetica', 'bold');
        doc.setFillColor(...lightGray);
        doc.rect(20, yPos - 3, pageWidth - 40, 7, 'F');
        doc.text(step, 25, yPos + 2);
        yPos += 10;
        doc.setFont('helvetica', 'normal');
      } else if (step.startsWith('BEST PRACTICE:')) {
        doc.setFont('helvetica', 'italic');
        doc.setTextColor(100, 100, 100);
        const lines = doc.splitTextToSize(step, pageWidth - 50);
        doc.text(lines, 25, yPos);
        yPos += lines.length * 5 + 4;
        doc.setFont('helvetica', 'normal');
        doc.setTextColor(...textGray);
      } else {
        const lines = doc.splitTextToSize(step, pageWidth - 50);
        doc.text(lines, 25, yPos);
        yPos += lines.length * 5;
      }
    });

    // SECTION 10: COMPLIANCE & QUALITY
    doc.addPage();
    drawHeader();
    yPos = 30;
    
    doc.setFillColor(...darkBlue);
    doc.rect(0, yPos, pageWidth, 12, 'F');
    doc.setTextColor(255, 255, 255);
    doc.setFontSize(16);
    doc.setFont('helvetica', 'bold');
    doc.text('10. Compliance & Quality Tools', 15, yPos + 8);
    yPos += 20;
    
    doc.setTextColor(...textGray);
    
    // Medicare Compliance Dashboard
    doc.setFillColor(...yellow);
    doc.rect(20, yPos, 5, 5, 'F');
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(12);
    doc.text('Medicare Compliance Dashboard', 30, yPos + 4);
    yPos += 12;
    
    doc.setFont('helvetica', 'normal');
    doc.setFontSize(10);
    
    const complianceInfo = doc.splitTextToSize(
      'The Compliance Dashboard provides real-time monitoring of your documentation quality and ' +
      'Medicare compliance rates. It analyzes all clinical notes for required elements: skilled language, ' +
      'medical necessity justification, homebound status documentation, patient response, and teaching.',
      pageWidth - 40
    );
    doc.text(complianceInfo, 20, yPos);
    yPos += complianceInfo.length * 5 + 12;
    
    checkPageBreak(40);
    doc.text('HOW IT WORKS:', 20, yPos);
    yPos += 8;
    
    const complianceSteps = [
      'How the AI Scans Your Notes:',
      '  Every saved visit note is analyzed against Medicare requirements looking',
      '  for skilled nursing language, medical necessity justification, homebound',
      '  status documentation, patient response details, and teaching confirmation.',
      '',
      'What You See:',
      '  - Overall compliance percentage displayed at top of dashboard',
      '  - Breakdown showing score for each required element',
      '  - Color-coded indicators (green = compliant, yellow = needs improvement,',
      '    red = high risk for denial)',
      '  - Trend chart showing your compliance rate over past 30/60/90 days',
      '  - List of specific flagged notes with suggested improvements',
      '',
      'Taking Action:',
      '  Click any flagged note to view AI suggestions for strengthening it.',
      '  Common fixes include adding more specific skilled language, clarifying',
      '  medical necessity, or documenting homebound status more explicitly.',
      '',
      'BEST PRACTICE: Check compliance dashboard weekly. Address flagged notes',
      'within 24 hours. Use AI suggestions to strengthen documentation before',
      'submitting claims. Aim for 95%+ compliance rate on all elements.'
    ];
    
    complianceSteps.forEach(step => {
      checkPageBreak();
      if (step === '') {
        yPos += 4;
      } else if (step.endsWith(':') && !step.startsWith(' ')) {
        doc.setFont('helvetica', 'bold');
        doc.text(step, 25, yPos);
        yPos += 8;
        doc.setFont('helvetica', 'normal');
      } else if (step.startsWith('BEST PRACTICE:')) {
        doc.setFont('helvetica', 'italic');
        doc.setTextColor(100, 100, 100);
        const lines = doc.splitTextToSize(step, pageWidth - 50);
        doc.text(lines, 25, yPos);
        yPos += lines.length * 5 + 4;
        doc.setFont('helvetica', 'normal');
        doc.setTextColor(...textGray);
      } else {
        const lines = doc.splitTextToSize(step, pageWidth - 50);
        doc.text(lines, 25, yPos);
        yPos += lines.length * 5;
      }
    });

    // SECTION 11: BEST PRACTICES SUMMARY
    doc.addPage();
    drawHeader();
    yPos = 30;
    
    doc.setFillColor(...darkBlue);
    doc.rect(0, yPos, pageWidth, 12, 'F');
    doc.setTextColor(255, 255, 255);
    doc.setFontSize(16);
    doc.setFont('helvetica', 'bold');
    doc.text('11. Best Practices & Pro Tips', 15, yPos + 8);
    yPos += 20;
    
    doc.setTextColor(...textGray);
    doc.setFontSize(11);
    doc.setFont('helvetica', 'bold');
    doc.text('Daily Workflow Recommendations:', 20, yPos);
    yPos += 10;
    
    doc.setFont('helvetica', 'normal');
    doc.setFontSize(10);
    
    const dailyTips = [
      '1. Start Day: Open Dashboard and review alert notifications, pending tasks,',
      '   and scheduled visits for the day.',
      '',
      '2. Document Visits: Use Visit Scribe voice recording feature immediately',
      '   after each visit while details are fresh in your mind.',
      '',
      '3. Review AI Notes: Check AI-generated notes for accuracy and completeness',
      '   before clicking Save. Edit any details that need refinement.',
      '',
      '4. OASIS Same-Day: Complete OASIS assessments same day as visit using the',
      '   AI assistance tools to ensure all required items are addressed.',
      '',
      '5. End-of-Day Check: Review compliance dashboard to catch any flagged',
      '   notes that need strengthening before submission.',
      '',
      '6. Use Favorites: Click star icon on frequently seen patients to pin them',
      '   to top of your lists for quick access.',
      '',
      'Documentation Excellence:',
      '',
      '  > Always select patient before documenting - this enables AI to pull in',
      '    patient-specific history and personalize suggestions.',
      '',
      '  > Include objective measurements wherever possible: blood pressure readings,',
      '    pain scale numbers, percentage of task completion, wound measurements.',
      '',
      '  > Document patient response to your interventions - did they understand',
      '    teaching? Did symptoms improve? This shows medical necessity.',
      '',
      '  > Use clinical library phrases for consistency across your documentation.',
      '',
      '  > Let AI expand your brief bullet points into full Medicare-compliant',
      '    narratives with proper skilled terminology.',
      '',
      '  > Review AI suggestions carefully, but always trust your clinical judgment',
      '    as the expert who actually assessed the patient.',
      '',
      'Time-Saving Strategies:',
      '',
      '  > Voice Recording: Record visits instead of typing - saves 5-10 minutes',
      '    per visit. AI handles transcription and formatting.',
      '',
      '  > Care Plan Templates: Create templates for common diagnoses (CHF, diabetes,',
      '    wound care) and reuse with one-click adaptation.',
      '',
      '  > Fax Templates: Save frequently used fax configurations (hospitals, PCPs)',
      '    to send documents in seconds without re-entering recipient info.',
      '',
      '  > AI Follow-Up Tasks: Let AI generate task lists from visit notes instead',
      '    of manually creating each task.',
      '',
      '  > Batch Operations: When updating multiple patient records, use bulk',
      '    actions to apply changes across your caseload efficiently.',
      '',
      'Quality Assurance Checklist:',
      '',
      '  > Weekly Compliance Review: Check your compliance scores every Monday.',
      '    Aim for 95%+ on all required Medicare elements.',
      '',
      '  > 24-Hour Flag Response: Address any flagged notes within 24 hours while',
      '    visit details are still fresh.',
      '',
      '  > OASIS Verification: Always verify AI-generated OASIS responses match',
      '    your actual clinical assessment. AI suggests but you decide.',
      '',
      '  > Care Plan Currency: Update care plans whenever visit findings indicate',
      '    new problems or changes in patient status.',
      '',
      '  > Homebound Documentation: Every skilled visit note must clearly document',
      '    why patient is homebound per Medicare requirements.'
    ];
    
    dailyTips.forEach(tip => {
      checkPageBreak();
      if (tip === '') {
        yPos += 4;
      } else if (tip.includes(':') && !tip.startsWith(' ')) {
        doc.setFont('helvetica', 'bold');
        doc.setFontSize(11);
        doc.text(tip, 20, yPos);
        yPos += 10;
        doc.setFont('helvetica', 'normal');
        doc.setFontSize(10);
      } else {
        const lines = doc.splitTextToSize(tip, pageWidth - 45);
        doc.text(lines, 25, yPos);
        yPos += lines.length * 5;
      }
    });

    // Final Page - Support
    doc.addPage();
    drawHeader();
    yPos = 30;
    
    doc.setFillColor(...darkBlue);
    doc.rect(0, yPos, pageWidth, 12, 'F');
    doc.setTextColor(255, 255, 255);
    doc.setFontSize(16);
    doc.setFont('helvetica', 'bold');
    doc.text('Support & Resources', 15, yPos + 8);
    yPos += 20;
    
    doc.setTextColor(...textGray);
    doc.setFontSize(10);
    doc.setFont('helvetica', 'normal');
    
    yPos += 20;
    
    doc.setFillColor(...lightGray);
    doc.roundedRect(20, yPos, pageWidth - 40, 100, 3, 3, 'F');
    
    yPos += 15;
    doc.setFontSize(12);
    doc.setFont('helvetica', 'bold');
    doc.text('Need Help?', pageWidth / 2, yPos, { align: 'center' });
    yPos += 15;
    
    doc.setFont('helvetica', 'normal');
    doc.setFontSize(10);
    doc.text('For technical support, questions, or training:', pageWidth / 2, yPos, { align: 'center' });
    yPos += 10;
    doc.setFont('helvetica', 'bold');
    doc.text('Contact: Kevin Deyarmin', pageWidth / 2, yPos, { align: 'center' });
    yPos += 10;
    
    doc.setFont('helvetica', 'normal');
    doc.text('System updates and new features are announced in-app', pageWidth / 2, yPos, { align: 'center' });
    yPos += 30;
    
    doc.setFontSize(9);
    doc.setTextColor(120, 120, 120);
    doc.text('PennSync - Built with care for the Penn Home Health Team', pageWidth / 2, yPos, { align: 'center' });

    // Add page numbers to all pages except cover
    const totalPages = doc.internal.pages.length - 1;
    for (let i = 2; i <= totalPages; i++) {
      doc.setPage(i);
      doc.setFontSize(9);
      doc.setTextColor(150, 150, 150);
      doc.text(`Page ${i - 1} of ${totalPages - 1}`, pageWidth - 20, pageHeight - 10, { align: 'right' });
    }

    const pdfBytes = doc.output('arraybuffer');
    
    return new Response(pdfBytes, {
      status: 200,
      headers: {
        'Content-Type': 'application/pdf',
        'Content-Disposition': 'attachment; filename="PennSync_User_Manual.pdf"'
      }
    });
  } catch (error) {
    return Response.json({ error: error.message }, { status: 500 });
  }
});