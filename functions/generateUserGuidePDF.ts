import { createClientFromRequest } from 'npm:@base44/sdk@0.8.6';
import { jsPDF } from 'npm:jspdf@2.5.2';

Deno.serve(async (req) => {
  try {
    const base44 = createClientFromRequest(req);
    const user = await base44.auth.me();
    if (!user) {
      return Response.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const { guide_type } = await req.json().catch(() => ({ guide_type: 'full' }));

    const doc = new jsPDF();
    const pageWidth = doc.internal.pageSize.getWidth();
    const pageHeight = doc.internal.pageSize.getHeight();
    const margin = 20;
    const contentWidth = pageWidth - margin * 2;
    let y = margin;

    const addNewPageIfNeeded = (needed = 30) => {
      if (y + needed > pageHeight - 25) {
        doc.addPage();
        y = margin;
        // Footer
        doc.setFontSize(8);
        doc.setTextColor(150, 150, 150);
        doc.text('CareMetric AI', margin, pageHeight - 10);
        doc.text(`Page ${doc.getNumberOfPages()}`, pageWidth - margin - 20, pageHeight - 10);
        doc.setTextColor(0, 0, 0);
        return true;
      }
      return false;
    };

    const addTitle = (text, size = 22) => {
      addNewPageIfNeeded(40);
      doc.setFontSize(size);
      doc.setFont('helvetica', 'bold');
      doc.setTextColor(30, 64, 175);
      doc.text(text, margin, y);
      y += size * 0.5 + 4;
    };

    const addSubtitle = (text, size = 14) => {
      addNewPageIfNeeded(25);
      doc.setFontSize(size);
      doc.setFont('helvetica', 'bold');
      doc.setTextColor(51, 65, 85);
      doc.text(text, margin, y);
      y += size * 0.45 + 3;
    };

    const addParagraph = (text) => {
      addNewPageIfNeeded(20);
      doc.setFontSize(10);
      doc.setFont('helvetica', 'normal');
      doc.setTextColor(71, 85, 105);
      const lines = doc.splitTextToSize(text, contentWidth);
      for (const line of lines) {
        addNewPageIfNeeded(6);
        doc.text(line, margin, y);
        y += 5;
      }
      y += 3;
    };

    const addBullet = (text) => {
      addNewPageIfNeeded(10);
      doc.setFontSize(10);
      doc.setFont('helvetica', 'normal');
      doc.setTextColor(71, 85, 105);
      const lines = doc.splitTextToSize(text, contentWidth - 10);
      doc.text('•', margin + 2, y);
      for (let i = 0; i < lines.length; i++) {
        addNewPageIfNeeded(6);
        doc.text(lines[i], margin + 10, y);
        y += 5;
      }
      y += 1;
    };

    const addStep = (number, title, description) => {
      addNewPageIfNeeded(20);
      doc.setFontSize(10);
      doc.setFont('helvetica', 'bold');
      doc.setTextColor(30, 64, 175);
      doc.text(`Step ${number}:`, margin + 2, y);
      doc.setTextColor(51, 65, 85);
      doc.text(title, margin + 22, y);
      y += 6;
      if (description) {
        doc.setFont('helvetica', 'normal');
        doc.setTextColor(100, 116, 139);
        const lines = doc.splitTextToSize(description, contentWidth - 10);
        for (const line of lines) {
          addNewPageIfNeeded(6);
          doc.text(line, margin + 10, y);
          y += 5;
        }
      }
      y += 3;
    };

    const addDivider = () => {
      y += 3;
      doc.setDrawColor(200, 210, 230);
      doc.line(margin, y, pageWidth - margin, y);
      y += 6;
    };

    const addTipBox = (text) => {
      addNewPageIfNeeded(25);
      doc.setFillColor(239, 246, 255);
      doc.setDrawColor(147, 197, 253);
      const lines = doc.splitTextToSize(text, contentWidth - 16);
      const boxHeight = lines.length * 5 + 10;
      doc.roundedRect(margin, y - 2, contentWidth, boxHeight, 3, 3, 'FD');
      doc.setFontSize(9);
      doc.setFont('helvetica', 'italic');
      doc.setTextColor(30, 64, 175);
      doc.text('💡 Tip:', margin + 5, y + 5);
      doc.setFont('helvetica', 'normal');
      doc.setTextColor(71, 85, 105);
      for (let i = 0; i < lines.length; i++) {
        doc.text(lines[i], margin + 5, y + 11 + i * 5);
      }
      y += boxHeight + 5;
    };

    // ============ COVER PAGE ============
    doc.setFillColor(30, 64, 175);
    doc.rect(0, 0, pageWidth, 100, 'F');
    doc.setFontSize(28);
    doc.setFont('helvetica', 'bold');
    doc.setTextColor(255, 255, 255);
    doc.text('CareMetric AI', margin, 40);
    doc.setFontSize(18);
    doc.setFont('helvetica', 'normal');
    doc.text(guide_type === 'quick' ? 'Quick Reference Guide' : 'Complete User Guide', margin, 55);
    doc.setFontSize(11);
    doc.text(`Version 2.0 | ${new Date().toLocaleDateString('en-US', { year: 'numeric', month: 'long' })}`, margin, 70);
    doc.text('AI-Powered Clinical Documentation Platform', margin, 82);

    y = 115;
    doc.setTextColor(0, 0, 0);

    if (guide_type === 'quick') {
      // ============ QUICK REFERENCE GUIDE ============
      addTitle('Quick Reference Guide', 18);
      addParagraph('This quick reference card covers the essential workflows you need to get started with CareMetric AI right away.');
      addDivider();

      addSubtitle('1. Getting Started (2 Minutes)');
      addStep(1, 'Sign In & Complete Profile', 'Go to Settings and set your Provider Type (RN, LPN, PT, OT, etc.) and credentials. This helps the AI tailor notes to your discipline.');
      addStep(2, 'Add Your First Patient', 'Click Patients > Add Patient. Only first and last name are required. Add diagnoses and medications for better AI output.');
      addStep(3, 'Create Your First Note', 'Go to Smart Note Assistant, select your patient, choose a visit type and diagnosis, type rough notes, and click Enhance Note.');
      addDivider();

      addSubtitle('2. Smart Note Workflow');
      addStep(1, 'Select Patient + Visit Type + Diagnosis', '');
      addStep(2, 'Enter rough notes (bullet points, shorthand, or full sentences)', '');
      addStep(3, 'Click "Enhance with AI"', 'AI generates a Medicare-compliant note in seconds.');
      addStep(4, 'Review, edit, and save', 'Always review AI output before finalizing.');
      addTipBox('The AI learns your writing style over time. The more you use it, the better it matches your preferences.');
      addDivider();

      addSubtitle('3. Medical Scribe (Voice-to-Note)');
      addStep(1, 'Go to Medical Scribe page', '');
      addStep(2, 'Select patient and visit details', '');
      addStep(3, 'Click Record or Upload Audio', 'Speak naturally about your visit.');
      addStep(4, 'Review transcription, then Generate Note', 'AI converts audio to structured clinical documentation.');
      addDivider();

      addSubtitle('4. Care Plans');
      addBullet('Go to Care Plans page and select a patient');
      addBullet('Click "Generate AI Care Plan" for automatic creation');
      addBullet('Or select from the template library for common conditions');
      addBullet('Track progress with measurable goals and timelines');
      addDivider();

      addSubtitle('5. Key Navigation');
      addBullet('Dashboard — Overview of patients, tasks, alerts, and stats');
      addBullet('Patients — Add, search, and manage patient records');
      addBullet('Tasks — View AI-generated and manual follow-up tasks');
      addBullet('Smart Note — Create AI-enhanced clinical notes');
      addBullet('Medical Scribe — Voice-to-documentation');
      addBullet('Care Plans — Create and track care plans');
      addBullet('OASIS — Upload and analyze OASIS assessments');
      addBullet('Compliance — Monitor documentation compliance scores');
      addBullet('Analytics — Track time saved and performance');
      addBullet('Alerts — View AI-generated patient risk alerts');
      addBullet('Training — Personalized learning modules and quizzes');
      addBullet('Settings — Profile, preferences, and agency setup');
      addDivider();

      addSubtitle('6. Keyboard & Voice Tips');
      addBullet('Use voice dictation in the field for fastest note entry');
      addBullet('Mention vital signs clearly for auto-extraction');
      addBullet('Include patient responses and teaching provided');
      addBullet('Check AI-generated follow-up tasks after each note');
      addDivider();

      addSubtitle('7. Getting Help');
      addBullet('In-app Documentation page — Full feature guides');
      addBullet('Training Hub — Interactive tutorials and quizzes');
      addBullet('Email: support@caremetricai.com');
      addBullet('FAQ page — Common questions answered');

    } else {
      // ============ FULL USER GUIDE ============
      addTitle('Table of Contents', 16);
      const tocItems = [
        '1. Getting Started',
        '2. Dashboard Overview',
        '3. Patient Management',
        '4. Smart Note Assistant',
        '5. Medical Scribe',
        '6. Care Plan Management',
        '7. OASIS Assessment',
        '8. Compliance Dashboard',
        '9. Analytics',
        '10. Patient Alerts',
        '11. Task Management',
        '12. Training Hub',
        '13. Settings & Customization',
        '14. Tips & Best Practices',
        '15. FAQ & Support',
      ];
      for (const item of tocItems) {
        addBullet(item);
      }
      addDivider();

      // Chapter 1
      addTitle('1. Getting Started', 16);
      addParagraph('Welcome to CareMetric AI — the AI-powered clinical documentation platform designed to save home health clinicians 2-3 hours daily on documentation while improving compliance and care quality.');
      addSubtitle('First-Time Setup', 12);
      addStep(1, 'Complete Your Profile', 'Navigate to Settings. Set your provider type (RN, LPN, PT, OT, SLP, MSW, etc.), credentials, and care scope. This enables AI personalization.');
      addStep(2, 'Add Your First Patient', 'Go to Patients > Add Patient. Enter demographics, diagnoses, medications, and allergies. Only first/last name is required.');
      addStep(3, 'Try the Smart Note Assistant', 'Select a patient, choose visit type and diagnosis, enter rough notes, and click Enhance. See AI transform them into compliant documentation.');
      addStep(4, 'Explore the Dashboard', 'Your Dashboard shows patients, tasks, alerts, compliance, and time savings all in one place.');
      addTipBox('Start with Smart Note Assistant — most users save 20-30 minutes on their very first note!');
      addDivider();

      // Chapter 2
      addTitle('2. Dashboard', 16);
      addParagraph('Your command center. The Dashboard provides a real-time snapshot of everything that needs your attention.');
      addBullet('Patient Summary — Total active, new admissions, high-risk cases');
      addBullet('Task Overview — Pending, overdue, and completed tasks');
      addBullet('Compliance Alerts — Open violations needing attention');
      addBullet('Time Saved Widget — AI time savings (today, week, total)');
      addBullet('Quick Actions — One-click access to common workflows');
      addBullet('Announcements — System updates and agency notifications');
      addDivider();

      // Chapter 3
      addTitle('3. Patient Management', 16);
      addParagraph('Centralized hub for all patient records with comprehensive clinical profiles.');
      addSubtitle('Adding Patients', 12);
      addStep(1, 'Click "Add Patient"', 'Button in top-right of Patients page.');
      addStep(2, 'Enter Details', 'Demographics, diagnoses, medications, allergies, contacts, insurance.');
      addStep(3, 'Save', 'Taken to patient detail page for visits, care plans, and documentation.');
      addSubtitle('Key Features', 12);
      addBullet('Search & Filter — Find patients by name, diagnosis, or status');
      addBullet('AI Risk Assessment — Auto-calculated risk scores');
      addBullet('Visit History — Complete timeline of visits and documentation');
      addBullet('Bulk Actions — Update multiple patients at once');
      addBullet('Duplicate Detection — Auto-finds and merges duplicates');
      addDivider();

      // Chapter 4
      addTitle('4. Smart Note Assistant', 16);
      addParagraph('The core feature of CareMetric AI. Transforms rough notes into Medicare-compliant documentation, saving up to 70% of documentation time.');
      addSubtitle('Creating a Smart Note', 12);
      addStep(1, 'Select Patient', 'Choose from dropdown. Clinical context loads automatically.');
      addStep(2, 'Choose Visit Type & Diagnosis', 'Tailors the AI note format and requirements.');
      addStep(3, 'Enter Rough Notes', 'Type or dictate. Shorthand, bullets, or full sentences all work.');
      addStep(4, 'Click "Enhance Note"', 'AI generates compliant narrative with proper structure and terminology.');
      addStep(5, 'Review & Save', 'Compliance checker runs automatically. Edit as needed.');
      addSubtitle('Built-in Tools', 12);
      addBullet('Voice Dictation — Speak your notes');
      addBullet('Real-Time Compliance — Instant feedback on compliance issues');
      addBullet('ICD-10 Code Suggestions — AI-recommended diagnosis codes');
      addBullet('Care Plan Suggestions — Auto-generated from documentation');
      addBullet('Follow-Up Task Generation — Auto-creates tasks from notes');
      addBullet('Patient Education — Generate patient-friendly materials');
      addTipBox('Always review AI-generated notes. While the AI achieves 95%+ accuracy, your clinical judgment guides the final document.');
      addDivider();

      // Chapter 5
      addTitle('5. Medical Scribe', 16);
      addParagraph('Record visits verbally and let AI convert recordings into structured, compliant clinical notes.');
      addStep(1, 'Navigate to Medical Scribe', 'Select patient, visit type, and diagnosis.');
      addStep(2, 'Record or Upload Audio', 'Click Record or upload an audio file. Speak naturally about the visit.');
      addStep(3, 'Review Transcription', 'AI transcribes with speaker diarization and medical term correction.');
      addStep(4, 'Generate Note', 'Converts transcription into formatted clinical documentation.');
      addSubtitle('Advanced Features', 12);
      addBullet('Speaker Diarization — Identifies clinician, patient, and family members');
      addBullet('Medical Term Correction — AI corrects transcription errors in real-time');
      addBullet('Safety Alerts — Flags potentially dangerous medication/dosage errors');
      addBullet('Custom Terminology — Add specialized terms for better accuracy');
      addDivider();

      // Chapter 6
      addTitle('6. Care Plan Management', 16);
      addParagraph('Build, manage, and monitor individualized care plans with AI assistance.');
      addBullet('AI-Generated Plans — Auto-create from diagnoses and clinical data');
      addBullet('Template Library — Pre-built templates for common conditions');
      addBullet('Progress Tracking — Monitor goal achievement with measurable outcomes');
      addBullet('Review Reminders — Automated reminders when plans need reassessment');
      addBullet('Collaboration — Share care plans with your team');
      addBullet('Automatic Triggers — Plans auto-generate based on diagnoses/medications');
      addDivider();

      // Chapter 7
      addTitle('7. OASIS Assessment', 16);
      addParagraph('AI-powered analysis of OASIS assessments for accuracy, compliance, and PDGM optimization.');
      addStep(1, 'Upload OASIS Document', 'PDF or image format.');
      addStep(2, 'AI Analysis', 'Scans for errors, inconsistencies, and optimization opportunities.');
      addStep(3, 'Review Findings', 'Error flags, corrections, PDGM impact, revenue implications.');
      addBullet('PDGM case-mix weight calculation');
      addBullet('Multi-report comparison');
      addBullet('Scenario modeling for what-if analysis');
      addBullet('Automated QA checks');
      addDivider();

      // Chapter 8
      addTitle('8. Compliance Dashboard', 16);
      addParagraph('Comprehensive view of documentation compliance across all patients and visits.');
      addBullet('Medicare Documentation Requirements — All required elements checked');
      addBullet('Homebound Status Justification — Validates documentation');
      addBullet('Skilled Need Documentation — Confirms proper justification');
      addBullet('Care Plan Alignment — Visits match established plans');
      addBullet('Agency-Specific Rules — Custom rules from your administrator');
      addTipBox('Set your compliance target in Settings. CareMetric AI alerts you when notes fall below your target score.');
      addDivider();

      // Chapter 9
      addTitle('9. Analytics', 16);
      addParagraph('Data-driven insights into documentation quality, productivity, and compliance rates.');
      addBullet('Time Savings Analysis — Daily, weekly, monthly AI time savings');
      addBullet('Compliance Trends — Score improvements over time');
      addBullet('Documentation Quality — Average quality scores and improvement areas');
      addBullet('AI Feature Usage — Most-used features and their impact');
      addBullet('Patient Risk Overview — Population-level risk metrics');
      addDivider();

      // Chapter 10
      addTitle('10. Patient Alerts', 16);
      addParagraph('AI continuously analyzes patient data to identify risks before they become emergencies.');
      addBullet('Vital Deterioration — Trending vital sign changes');
      addBullet('Medication Risk — Potential interactions or adherence issues');
      addBullet('Fall Risk — Increased fall risk from assessment data');
      addBullet('Readmission Risk — Hospital readmission risk identification');
      addBullet('Care Gaps — Missing assessments, overdue visits, incomplete documentation');
      addDivider();

      // Chapter 11
      addTitle('11. Task Management', 16);
      addParagraph('Track follow-ups, referrals, orders, and action items. Tasks are created manually or auto-generated by AI.');
      addBullet('AI-Generated Tasks — Auto-created from visit notes');
      addBullet('Priority Levels — Critical, High, Medium, Low');
      addBullet('Due Dates & Reminders — Set deadlines with notifications');
      addBullet('Recurring Tasks — Daily, weekly, or monthly schedules');
      addBullet('Task Assignment — Assign to yourself or team members');
      addDivider();

      // Chapter 12
      addTitle('12. Training Hub', 16);
      addParagraph('Personalized learning modules, compliance training, and skill assessments.');
      addBullet('Interactive Training Modules — Documentation, compliance, clinical skills');
      addBullet('AI Skill Assessment — Identify strengths and improvement areas');
      addBullet('Personalized Recommendations — Based on your actual performance');
      addBullet('Compliance Quizzes — Test Medicare requirement knowledge');
      addBullet('Progress Tracking — Learning journey and certifications');
      addDivider();

      // Chapter 13
      addTitle('13. Settings & Customization', 16);
      addBullet('Provider Type & Credentials — Set professional role for tailored AI');
      addBullet('AI Preferences — Control note length, tone, and complexity');
      addBullet('Notification Preferences — Choose how/when you receive alerts');
      addBullet('Compliance Targets — Set minimum compliance score');
      addBullet('Practice Information — Configure practice details for documents');
      addBullet('Agency Code — Join your agency for shared templates and rules');
      addDivider();

      // Chapter 14
      addTitle('14. Tips & Best Practices', 16);
      addBullet('Be detailed in rough notes — more detail = better AI output');
      addBullet('Always review AI output before finalizing');
      addBullet('Use voice dictation in the field immediately after visits');
      addBullet('Check tasks daily — start each day reviewing your task list');
      addBullet('Use patient education generator for condition-specific handouts');
      addBullet('Set your provider type in Settings for dramatically improved AI quality');
      addDivider();

      // Chapter 15
      addTitle('15. FAQ & Support', 16);
      addSubtitle('Common Questions', 12);
      addBullet('Is data HIPAA compliant? — Yes, fully HIPAA compliant with encryption');
      addBullet('Works on mobile? — Yes, fully responsive on phones and tablets');
      addBullet('AI accuracy? — 95%+ compliance accuracy, always review output');
      addBullet('Offline support? — Yes, draft notes offline and sync when connected');
      addBullet('Support? — Email support@caremetricai.com or use in-app help');
      y += 5;
      addSubtitle('Contact Us', 12);
      addBullet('Email: support@caremetricai.com');
      addBullet('In-app: Documentation page and Training Hub');
      addBullet('Website: www.caremetricai.com');
    }

    // Final footer on all pages
    const totalPages = doc.getNumberOfPages();
    for (let i = 1; i <= totalPages; i++) {
      doc.setPage(i);
      doc.setFontSize(8);
      doc.setTextColor(150, 150, 150);
      doc.text('CareMetric AI — AI-Powered Clinical Documentation', margin, pageHeight - 8);
      doc.text(`Page ${i} of ${totalPages}`, pageWidth - margin - 25, pageHeight - 8);
    }

    const pdfBytes = doc.output('arraybuffer');

    // Upload to file storage
    const fileName = guide_type === 'quick' ? 'CareMetric-AI-Quick-Reference-Guide.pdf' : 'CareMetric-AI-User-Guide.pdf';
    const blob = new Blob([pdfBytes], { type: 'application/pdf' });
    const file = new File([blob], fileName, { type: 'application/pdf' });
    
    const uploadResult = await base44.asServiceRole.integrations.Core.UploadFile({ file });

    return Response.json({
      success: true,
      file_url: uploadResult.file_url,
      file_name: fileName,
      guide_type
    });

  } catch (error) {
    console.error('Error generating guide PDF:', error);
    return Response.json({ error: error.message }, { status: 500 });
  }
});