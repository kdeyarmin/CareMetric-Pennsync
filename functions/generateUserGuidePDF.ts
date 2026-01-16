import { jsPDF } from 'npm:jspdf@2.5.1';
import { createClientFromRequest } from 'npm:@base44/sdk@0.8.6';

const FEATURES_GUIDE = [
  {
    title: "Smart Notes Assistant",
    description: "Leverage AI-powered documentation assistance to enhance clinical notes in real-time, ensuring Medicare compliance while reducing administrative burden.",
    howToUse: [
      "1. Open a visit or patient record from your active caseload",
      "2. Begin dictating or typing clinical findings and observations",
      "3. Review AI-generated suggestions for enhancements and compliance improvements as you work",
      "4. Accept recommendations or edit content to match your documentation style",
      "5. Submit final note for supervisory review and approval"
    ],
    bestPractices: [
      "Provide specific clinical details to optimize AI suggestions",
      "Always review AI recommendations for clinical accuracy before submission",
      "Use standardized medical terminology for improved documentation quality",
      "Include baseline assessment information for comprehensive patient context",
      "Maintain current patient history records for better AI contextualization"
    ],
    smartNoteChecks: [
      "Medicare Compliance: Validates skilled nursing documentation requirements and justification for continued home health services",
      "Documentation Completeness: Flags missing critical elements such as patient status, interventions, patient response, and plan of care",
      "Clinical Accuracy: Cross-references clinical findings with patient history to identify inconsistencies or contradictions",
      "ICD-10 Code Suggestions: Recommends appropriate diagnostic codes aligned with documented clinical findings and assessment",
      "Skilled Nursing Documentation: Ensures skilled nursing judgment is clearly articulated and justified for medical necessity",
      "OASIS Alignment: Verifies narrative documentation supports corresponding OASIS assessment responses",
      "Grammar and Medical Terminology: Corrects documentation errors and suggests proper medical terminology usage",
      "Risk Identification: Highlights potential clinical red flags, safety concerns, and adverse events requiring intervention",
      "Patient Functional Status: Ensures documentation of patient functional assessment and activities of daily living status",
      "Care Plan Correlation: Validates that documented care aligns with established care plan goals and interventions"
    ],
    importance: "Reduces note documentation time by 40-50%, improves Medicare compliance audit rates by 30%, and prevents costly claim denials while ensuring comprehensive clinical documentation"
  },
  {
    title: "Visit Scribe",
    description: "Utilize voice-to-text transcription technology to capture patient interactions and automatically convert them to structured clinical documentation.",
    howToUse: [
      "1. Click the microphone icon to initiate voice recording",
      "2. Speak naturally and conversationally during patient interaction",
      "3. The system transcribes speech to text with real-time processing",
      "4. Review transcription accuracy and edit as necessary",
      "5. Allow AI to convert transcription into formally structured clinical note"
    ],
    bestPractices: [
      "Maintain clear, deliberate speech at natural pace",
      "Minimize ambient noise for improved transcription accuracy",
      "Integrate relevant clinical observations into narrative format",
      "Apply standard medical terminology consistently throughout recording",
      "Secure transcriptions immediately following patient interaction"
    ],
    importance: "Saves 1-2 hours per shift in documentation time, increases focus on patient care during visits, reduces documentation workload, and captures real-time observations without post-visit documentation delays"
  },
  {
    title: "Care Plan Management",
    description: "Develop and monitor individualized care plans with measurable outcomes, facilitating interdisciplinary coordination and ensuring alignment with patient goals.",
    howToUse: [
      "1. Access patient record and navigate to Care Plans section",
      "2. Select 'Create Care Plan' option or review AI-generated suggestions",
      "3. Define clinical problems, establish SMART goals, and identify evidence-based interventions",
      "4. Schedule review dates and assign responsibilities to care team members",
      "5. Monitor progress at each visit and revise plan based on patient response"
    ],
    bestPractices: [
      "Establish SMART goals that are Specific, Measurable, Achievable, Relevant, and Time-bound",
      "Conduct systematic care plan reviews at minimum monthly intervals",
      "Actively engage patient and family in collaborative goal setting",
      "Coordinate with all interdisciplinary team members involved in patient care",
      "Document patient progress and clinical response at every care encounter"
    ],
    importance: "Ensures Medicare compliance with individualized care plan requirements, reduces care plan development time through AI suggestions, improves patient outcomes through coordinated interventions, and demonstrates medical necessity for continued skilled care"
  },
  {
    title: "Document Generation",
    description: "Create professional patient education materials and clinical documentation rapidly using intelligent templates, ensuring accuracy and consistency across all communications.",
    howToUse: [
      "1. Navigate to Documents section from main menu",
      "2. Select appropriate document type (patient education, discharge summary, referral letter)",
      "3. Choose pre-designed template or customize for specific clinical needs",
      "4. Allow system to auto-populate fields with relevant patient data",
      "5. Review, edit for clinical accuracy, and transmit via secure channels"
    ],
    bestPractices: [
      "Tailor language and complexity to match patient education level and health literacy",
      "Perform thorough clinical review of all AI-generated content before distribution",
      "Provide clear explanations in plain language with clinical context",
      "Include comprehensive discharge instructions with follow-up contact information",
      "Utilize secure patient portal for document transmission to ensure HIPAA compliance"
    ],
    importance: "Reduces document creation time from hours to minutes, ensures consistency across communications, improves patient understanding and compliance with discharge instructions, and maintains HIPAA-compliant communication standards"
  },
  {
    title: "OASIS & Compliance",
    description: "Ensure Medicare OASIS compliance through automated validation against CMS requirements, reducing audit risk and improving revenue cycle management.",
    howToUse: [
      "1. Navigate to OASIS section from main menu",
      "2. Enter or upload OASIS data in designated fields",
      "3. System automatically validates data against current CMS requirements and rules",
      "4. Review any flagged items with clinical or administrative concerns",
      "5. Make necessary corrections and submit assessment with supervisory approval"
    ],
    bestPractices: [
      "Complete OASIS assessment contemporaneously within care delivery workflow",
      "Cross-reference all OASIS responses with supporting clinical documentation",
      "Leverage AI-provided suggestions to identify missing or conflicting data elements",
      "Obtain supervisory or administrative review prior to final OASIS submission",
      "Document clinical rationale for any manual overrides or exceptional decisions"
    ],
    importance: "Prevents costly compliance violations and audit findings, reduces OASIS submission errors by 80%, ensures accurate PDGM coding for optimal reimbursement, and maintains regulatory compliance with CMS requirements"
  },
  {
    title: "Analytics Dashboard",
    description: "Access real-time performance metrics and clinical outcome analytics to identify trends, benchmark against organizational standards, and drive continuous improvement.",
    howToUse: [
      "1. Access Analytics Dashboard from main menu navigation",
      "2. Review key performance indicators (KPIs) and quality metrics",
      "3. Apply filters to drill down into specific data sets or time periods",
      "4. Evaluate individual performance against agency benchmarks and best practices",
      "5. Generate and export comprehensive reports for quality meetings and reviews"
    ],
    bestPractices: [
      "Conduct systematic metric review on a weekly basis to identify emerging trends",
      "Use analytics data to prioritize areas for individual or organizational improvement",
      "Present performance successes to team to foster collaborative engagement",
      "Address performance gaps through proactive coaching or process improvement",
      "Monitor trends longitudinally to demonstrate sustained improvement and accountability"
    ],
    importance: "Eliminates manual report creation time, enables data-driven decision making, identifies compliance issues proactively, and demonstrates measurable quality improvement outcomes for accreditation and funding"
  },
  {
    title: "Training & Development",
    description: "Complete personalized training modules with AI-identified recommendations based on skill gaps, ensuring compliance with agency requirements and professional development.",
    howToUse: [
      "1. Navigate to Training & Development section",
      "2. Review assigned mandatory training and AI-recommended modules",
      "3. Complete training modules at self-directed pace within assigned timeframes",
      "4. Take comprehensive assessment quizzes to demonstrate learning and competency",
      "5. Obtain certifications and monitor progress through learning dashboard"
    ],
    bestPractices: [
      "Complete all mandatory training within assigned deadline parameters",
      "Prioritize AI-recommended modules that address identified skill gaps",
      "Conduct systematic review of compliance training at designated intervals",
      "Discuss learning outcomes and application strategies with direct supervisor",
      "Integrate new knowledge and techniques into daily clinical practice"
    ],
    importance: "Ensures regulatory compliance with mandatory training requirements, reduces staff turnover through professional development, improves clinical documentation quality through targeted education, and demonstrates competency for accreditation purposes"
  },
  {
    title: "Task Management",
    description: "Centralize task assignment and tracking with intelligent prioritization and automated reminders to ensure timely completion of critical action items.",
    howToUse: [
      "1. Navigate to Task Management section from dashboard",
      "2. View all assigned tasks and pending action items",
      "3. Sort and prioritize tasks by due date, urgency level, and clinical importance",
      "4. Update task status and document completion notes upon task completion",
      "5. Respond promptly to system-generated reminders for overdue or upcoming tasks"
    ],
    bestPractices: [
      "Review task list daily as part of workflow management",
      "Address critical and high-priority items with appropriate urgency",
      "Document detailed completion notes for accountability and continuity",
      "Coordinate with interdisciplinary team members on shared or dependent tasks",
      "Delegate tasks appropriately within scope of practice and role boundaries"
    ],
    importance: "Prevents missed follow-ups and care coordination lapses, reduces administrative task burden, ensures critical clinical actions are completed on time, and improves team communication and accountability"
  },
  {
    title: "Patient Risk Alerts",
    description: "Leverage AI-powered predictive analytics to identify high-risk patients early, enabling proactive interventions to prevent adverse events and readmissions.",
    howToUse: [
      "1. View and prioritize Risk Alerts displayed on main dashboard",
      "2. Review alert severity classification and system-generated recommendations",
      "3. Click on specific alert to examine contributing risk factors and clinical indicators",
      "4. Implement recommended clinical interventions in coordination with care team",
      "5. Document all clinical actions taken and patient response in health record"
    ],
    bestPractices: [
      "Respond with urgency and clinical focus to critical and high-severity alerts",
      "Coordinate evidence-based interventions with interdisciplinary care team members",
      "Document clinical reasoning and clinical decision-making for all alert responses",
      "Implement close monitoring and frequent reassessment following interventions",
      "Conduct timely follow-up within recommended intervals to assess intervention effectiveness"
    ]
  },
  {
    title: "Risk Factors Assessment",
    description: "The system automatically evaluates multiple clinical and demographic risk factors to predict patient deterioration, hospitalization risk, and readmission probability.",
    howToUse: [
      "Review the Risk Factors section within patient alert or dashboard widget",
      "Review vital signs for abnormal trends: blood pressure, heart rate, respiratory rate, oxygen saturation, temperature",
      "Check medication adherence and reconciliation status for completeness",
      "Assess functional and cognitive status changes from baseline",
      "Monitor social determinants: living situation, caregiver support, transportation access"
    ],
    bestPractices: [
      "Conduct comprehensive assessment of vital sign trends over time, not isolated measurements",
      "Document all relevant clinical observations that correlate with identified risk factors",
      "Ensure medication list is current and accurate, including over-the-counter medications",
      "Evaluate patient and caregiver understanding of condition and treatment plan",
      "Identify and address modifiable risk factors through targeted clinical interventions"
    ],
    riskFactorsIncluded: [
      "Vital Sign Changes: Abnormal blood pressure, elevated or low heart rate, respiratory distress, oxygen desaturation, fever",
      "Hospitalization History: Recent hospital admission, multiple admissions in past year, extended length of stay",
      "Fall Risk: History of falls, impaired mobility, balance problems, cognitive impairment, medication effects",
      "Infection Risk: Signs of infection, immunosuppression, wound concerns, urinary symptoms, respiratory symptoms",
      "Readmission Risk: Complex diagnoses, polypharmacy, poor medication adherence, social isolation, caregiver stress",
      "Functional Decline: Decreased ambulation, increased dependency for activities of daily living, cognitive changes",
      "Medication Issues: High-risk medications, drug interactions, non-adherence, side effects",
      "Mental Health: Depression screening positive, anxiety, behavioral changes, suicidal ideation",
      "Chronic Condition Management: Uncontrolled diabetes, heart failure decompensation, COPD exacerbation risk",
      "Social Factors: Living alone, limited caregiver availability, financial constraints, transportation barriers"
    ]
  },
  {
    title: "AI Documentation Assistant",
    description: "Maintain Protected Health Information (PHI) security through enterprise-grade encryption, multi-factor authentication, and strict access controls.",
    howToUse: [
      "1. Access system using secure login with required multi-factor authentication",
      "2. Access only patient records necessary for direct clinical care provision",
      "3. Logout immediately upon completion of work or when stepping away from device",
      "4. Report any suspected security breaches or unauthorized access immediately to IT",
      "5. Adhere strictly to all organizational data protection policies and HIPAA regulations"
    ],
    bestPractices: [
      "Never disclose login credentials or access tokens to any individual",
      "Utilize VPN for all remote access to protected systems",
      "Implement password protection on all devices with access to patient data",
      "Refrain from discussing Protected Health Information in public or unsecured areas",
      "Report all suspected HIPAA violations or potential breaches to Information Security immediately"
    ],
    importance: "Protects patient privacy and prevents costly HIPAA violations and fines, maintains audit compliance and organizational reputation, ensures secure remote access for mobile workforce, and protects sensitive clinical data from unauthorized access"
  },
  {
    title: "AI Documentation Assistant",
    description: "24/7 AI-powered chatbot that provides instant answers to documentation questions, compliance requirements, and regulatory guidance. Available throughout the app for on-demand support.",
    howToUse: [
      "Click the AI chat icon in the bottom-right corner of any page",
      "Ask questions about documentation requirements (e.g., 'What's required for skilled nursing documentation?')",
      "Get compliance guidance (e.g., 'How do I document homebound status?')",
      "Learn about OASIS requirements and Medicare regulations",
      "Receive ICD-10 coding guidance and documentation standards",
      "Get help with CareMetric AI features and troubleshooting"
    ],
    bestPractices: [
      "Ask specific questions for more targeted answers",
      "Use it during documentation to verify compliance requirements in real-time",
      "Reference it when unsure about regulatory requirements",
      "Ask follow-up questions to clarify complex topics",
      "Use it to train new staff on documentation standards"
    ],
    importance: "Provides instant access to documentation expertise and compliance guidance, reducing errors and improving documentation quality."
  },
  {
    title: "ICD-10 Code Suggestions",
    description: "AI-powered clinical decision support that analyzes clinical notes and automatically suggests relevant ICD-10 diagnostic codes with confidence levels, clinical rationale, and billing impact guidance.",
    howToUse: [
      "1. Available in Smart Notes and clinical documentation pages",
      "2. Enter or dictate clinical notes describing patient condition",
      "3. Click 'Suggest ICD-10 Codes' or let AI automatically analyze",
      "4. Review suggested codes with confidence percentages",
      "5. See clinical rationale explaining why each code is recommended",
      "6. View billing impact and specificity requirements",
      "7. Copy codes directly to your documentation or billing system"
    ],
    bestPractices: [
      "Provide detailed clinical notes for more accurate code suggestions",
      "Include specific symptoms, severity, and clinical findings",
      "Review confidence levels - higher confidence indicates stronger match",
      "Read the clinical rationale to ensure code appropriateness",
      "Use suggestions as guidance, not replacement for clinical judgment",
      "Verify codes match patient's actual diagnosis and documentation",
      "Document all conditions that affect treatment or management"
    ],
    importance: "Improves coding accuracy, reduces claim denials, ensures proper reimbursement, and helps maintain compliance with ICD-10 documentation specificity requirements."
  },
  {
    title: "Readmission Risk Prediction",
    description: "AI-powered predictive analytics that analyzes patient clinical and demographic data to calculate readmission probability with a risk score (0-100), identifies key risk factors, and provides evidence-based intervention recommendations to prevent hospital readmissions.",
    howToUse: [
      "Available in patient records and clinical decision support sections",
      "Click 'Assess Readmission Risk' or allow automatic risk calculation",
      "Review the risk score (0-100) with color-coded severity indicators",
      "Examine identified risk factors contributing to high risk",
      "Review recommended interventions specific to patient's risk profile",
      "Document interventions implemented and patient response",
      "Reassess risk periodically or after significant clinical changes"
    ],
    bestPractices: [
      "Run risk assessment at admission and before discharge",
      "Review all identified risk factors for accuracy and completeness",
      "Prioritize interventions based on modifiable risk factors",
      "Coordinate care plan with interdisciplinary team members",
      "Document patient and caregiver education provided",
      "Ensure follow-up appointments are scheduled before discharge",
      "Monitor high-risk patients more frequently"
    ],
    importance: "Reduces hospital readmission rates by 25-30%, prevents Medicare penalties for excess readmissions, improves patient outcomes through proactive intervention, and demonstrates quality of care for value-based reimbursement programs."
  },
  {
    title: "HIPAA Compliance & Security",
    description: "Maintain Protected Health Information (PHI) security through enterprise-grade encryption, multi-factor authentication, and strict access controls.",
    howToUse: [
      "Access system using secure login with required multi-factor authentication",
      "Access only patient records necessary for direct clinical care provision",
      "Logout immediately upon completion of work or when stepping away from device",
      "Report any suspected security breaches or unauthorized access immediately to IT",
      "Adhere strictly to all organizational data protection policies and HIPAA regulations"
    ],
    bestPractices: [
      "Never disclose login credentials or access tokens to any individual",
      "Utilize VPN for all remote access to protected systems",
      "Implement password protection on all devices with access to patient data",
      "Refrain from discussing Protected Health Information in public or unsecured areas",
      "Report all suspected HIPAA violations or potential breaches to Information Security immediately"
    ],
    importance: "Protects patient privacy and prevents costly HIPAA violations and fines, maintains audit compliance and organizational reputation, ensures secure remote access for mobile workforce, and protects sensitive clinical data from unauthorized access"
  }
];

Deno.serve(async (req) => {
  try {
    const base44 = createClientFromRequest(req);
    const user = await base44.auth.me();

    if (!user) {
      return new Response(JSON.stringify({ error: 'Unauthorized' }), {
        status: 401,
        headers: { 'Content-Type': 'application/json' }
      });
    }

    const doc = new jsPDF({
      orientation: 'portrait',
      unit: 'mm',
      format: 'a4'
    });

    const pageWidth = doc.internal.pageSize.getWidth();
    const pageHeight = doc.internal.pageSize.getHeight();
    const margin = 15;
    const contentWidth = pageWidth - 2 * margin;
    let yPosition = margin;

    // Title Page - Add background
    doc.setFillColor(41, 98, 255);
    doc.rect(0, 0, pageWidth, pageHeight, 'F');
    
    // White content area
    doc.setFillColor(255, 255, 255);
    doc.rect(margin - 5, margin, contentWidth + 10, pageHeight - 2 * margin, 'F');

    // Logo area (placeholder - white space for logo)
    doc.setDrawColor(200, 200, 200);
    doc.setLineWidth(0.1);
    doc.rect(margin, margin + 5, 40, 20);
    doc.setFontSize(8);
    doc.setTextColor(150, 150, 150);
    doc.text('CareMetric Logo', margin + 2, margin + 18);

    // Main title
    yPosition = margin + 35;
    doc.setFontSize(36);
    doc.setFont(undefined, 'bold');
    doc.setTextColor(41, 98, 255);
    doc.text('CareMetric AI', margin + 5, yPosition);
    
    // Subtitle
    yPosition += 15;
    doc.setFontSize(20);
    doc.setFont(undefined, 'normal');
    doc.setTextColor(80, 80, 80);
    doc.text('Comprehensive User Guide', margin + 5, yPosition);

    // Tagline
    yPosition += 18;
    doc.setFontSize(11);
    doc.setTextColor(120, 120, 120);
    const taglineLines = doc.splitTextToSize('Streamline Documentation • Enhance Compliance • Improve Patient Outcomes', contentWidth - 10);
    doc.text(taglineLines, margin + 5, yPosition);

    // Divider line
    yPosition += taglineLines.length * 5 + 12;
    doc.setDrawColor(41, 98, 255);
    doc.setLineWidth(0.5);
    doc.line(margin + 5, yPosition, margin + contentWidth - 5, yPosition);

    // Document info
    yPosition += 15;
    doc.setFontSize(10);
    doc.setFont(undefined, 'normal');
    doc.setTextColor(100, 100, 100);
    doc.text(`Generated: ${new Date().toLocaleDateString()}`, margin + 5, yPosition);
    yPosition += 8;
    doc.text('Healthcare Documentation & Compliance Solutions', margin + 5, yPosition);

    // Footer
    yPosition = pageHeight - margin - 20;
    doc.setFontSize(9);
    doc.setTextColor(150, 150, 150);
    const footerText = 'Designed to maximize efficiency, ensure compliance, and improve patient outcomes through intelligent healthcare documentation.';
    const footerLines = doc.splitTextToSize(footerText, contentWidth - 10);
    doc.text(footerLines, margin + 5, yPosition);

    yPosition = pageHeight - margin - 5;
    doc.setFontSize(8);
    doc.text('www.caremetricai.com', margin + 5, yPosition);

    // Add table of contents (optional) - Add feature section heading
    doc.addPage();
    yPosition = margin + 5;
    
    doc.setFontSize(16);
    doc.setFont(undefined, 'bold');
    doc.setTextColor(41, 98, 255);
    doc.text('Features Overview', margin, yPosition);
    
    yPosition += 12;
    doc.setFontSize(9);
    doc.setFont(undefined, 'normal');
    doc.setTextColor(0, 0, 0);
    
    for (let i = 0; i < FEATURES_GUIDE.length; i++) {
      const feature = FEATURES_GUIDE[i];
      doc.text(`${i + 1}. ${feature.title}`, margin + 5, yPosition);
      yPosition += 7;
    }

    // Add each feature section
    for (const feature of FEATURES_GUIDE) {
      // Check if we need a new page
      if (yPosition > pageHeight - 50) {
        doc.addPage();
        yPosition = margin;
      }

      // Add page break before each feature
      doc.addPage();
      yPosition = margin + 5;

      // Feature title with professional styling
      doc.setFillColor(41, 98, 255);
      doc.rect(margin - 3, yPosition - 7, contentWidth + 6, 12, 'F');
      
      doc.setFontSize(16);
      doc.setFont(undefined, 'bold');
      doc.setTextColor(255, 255, 255);
      doc.text(feature.title, margin + 3, yPosition + 1);
      doc.setTextColor(0, 0, 0);
      yPosition += 18;

      // Description
      doc.setFontSize(10);
      doc.setFont(undefined, 'normal');
      const descriptionLines = doc.splitTextToSize(feature.description, contentWidth);
      doc.text(descriptionLines, margin, yPosition);
      yPosition += descriptionLines.length * 5 + 5;

      // How to Use section
      doc.setFont(undefined, 'bold');
      doc.setFontSize(11);
      doc.setTextColor(41, 98, 255);
      doc.text('How to Use:', margin, yPosition);
      doc.setTextColor(0, 0, 0);
      yPosition += 6;

      doc.setFont(undefined, 'normal');
      doc.setFontSize(9.5);
      for (const step of feature.howToUse) {
        if (yPosition > pageHeight - 25) {
          doc.addPage();
          yPosition = margin;
        }
        const stepLines = doc.splitTextToSize('• ' + step, contentWidth - 5);
        doc.text(stepLines, margin + 5, yPosition);
        yPosition += stepLines.length * 4 + 2;
      }

      yPosition += 4;

      // Best Practices section
      if (yPosition > pageHeight - 40) {
        doc.addPage();
        yPosition = margin;
      }

      doc.setFont(undefined, 'bold');
      doc.setFontSize(11);
      doc.setTextColor(41, 98, 255);
      doc.text('Best Practices:', margin, yPosition);
      doc.setTextColor(0, 0, 0);
      yPosition += 6;

      doc.setFont(undefined, 'normal');
      doc.setFontSize(9.5);
      for (const practice of feature.bestPractices) {
        if (yPosition > pageHeight - 20) {
          doc.addPage();
          yPosition = margin;
        }
        const practiceLines = doc.splitTextToSize('• ' + practice, contentWidth - 5);
        doc.text(practiceLines, margin + 5, yPosition);
        yPosition += practiceLines.length * 4 + 2;
      }

      // Smart Note Checks section
      if (feature.smartNoteChecks && feature.smartNoteChecks.length > 0) {
        if (yPosition > pageHeight - 50) {
          doc.addPage();
          yPosition = margin;
        }

        doc.setFont(undefined, 'bold');
        doc.setFontSize(11);
        doc.setTextColor(41, 98, 255);
        doc.text('Documentation Validation Checks:', margin, yPosition);
        doc.setTextColor(0, 0, 0);
        yPosition += 6;

        doc.setFont(undefined, 'normal');
        doc.setFontSize(8.5);
        for (const check of feature.smartNoteChecks) {
          if (yPosition > pageHeight - 15) {
            doc.addPage();
            yPosition = margin;
          }
          const checkLines = doc.splitTextToSize('• ' + check, contentWidth - 8);
          doc.text(checkLines, margin + 5, yPosition);
          yPosition += checkLines.length * 3.5 + 1;
        }
      }

      // Risk Factors section (for Patient Risk Alerts feature only)
      if (feature.riskFactorsIncluded && feature.riskFactorsIncluded.length > 0) {
        if (yPosition > pageHeight - 50) {
          doc.addPage();
          yPosition = margin;
        }

        doc.setFont(undefined, 'bold');
        doc.setFontSize(11);
        doc.setTextColor(41, 98, 255);
        doc.text('Assessed Risk Factors:', margin, yPosition);
        doc.setTextColor(0, 0, 0);
        yPosition += 6;

        doc.setFont(undefined, 'normal');
        doc.setFontSize(9);
        for (const factor of feature.riskFactorsIncluded) {
          if (yPosition > pageHeight - 15) {
            doc.addPage();
            yPosition = margin;
          }
          const factorLines = doc.splitTextToSize('• ' + factor, contentWidth - 8);
          doc.text(factorLines, margin + 5, yPosition);
          yPosition += factorLines.length * 3.5 + 1;
        }
      }

      // Importance section
      if (feature.importance) {
        if (yPosition > pageHeight - 25) {
          doc.addPage();
          yPosition = margin;
        }

        doc.setFont(undefined, 'bold');
        doc.setFontSize(11);
        doc.setTextColor(41, 98, 255);
        doc.text('Why This Matters:', margin, yPosition);
        doc.setTextColor(0, 0, 0);
        yPosition += 6;

        doc.setFont(undefined, 'normal');
        doc.setFontSize(9.5);
        const importanceLines = doc.splitTextToSize(feature.importance, contentWidth - 5);
        doc.text(importanceLines, margin + 5, yPosition);
        yPosition += importanceLines.length * 4 + 5;
      }

      yPosition += 10;
    }

    const pdfBytes = doc.output('arraybuffer');
    
    return new Response(pdfBytes, {
      status: 200,
      headers: {
        'Content-Type': 'application/pdf',
        'Content-Disposition': 'attachment; filename="CareMetric-AI-User-Guide.pdf"'
      }
    });
  } catch (error) {
    console.error('Error generating PDF:', error);
    return new Response(JSON.stringify({ error: error.message }), {
      status: 500,
      headers: { 'Content-Type': 'application/json' }
    });
  }
});