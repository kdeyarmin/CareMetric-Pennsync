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
    ]
  },
  {
    title: "Medical Scribe",
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
    ]
  },
  {
    title: "Patient Management",
    description: "Maintain a comprehensive, centralized patient repository with complete health records, enabling seamless access to historical data and current clinical information.",
    howToUse: [
      "1. Navigate to the Patients section from main dashboard",
      "2. Use advanced search or filtering tools to locate specific patient records",
      "3. Select patient name to access complete demographic and clinical profile",
      "4. Update and maintain current patient information throughout episodes of care",
      "5. Review complete care timeline, visit history, and associated documents"
    ],
    bestPractices: [
      "Ensure demographic data is reviewed and updated at each interaction",
      "Document all active diagnoses, comorbidities, and allergies",
      "Maintain current emergency contact and designee information",
      "Perform systematic medication reconciliation at each care episode",
      "Clearly identify all interdisciplinary care team members and their roles"
    ]
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
    ]
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
    ]
  },
  {
    title: "Provider Scheduling",
    description: "Optimize visit schedules and care routes using intelligent algorithms that maximize efficiency while maintaining clinical continuity and patient accessibility.",
    howToUse: [
      "1. Access Schedule page from dashboard navigation",
      "2. Review current weekly or daily visit schedule",
      "3. Add new visits while leveraging intelligent scheduling suggestions",
      "4. Allow system to optimize geographic routing and visit sequencing automatically",
      "5. Manually adjust schedule to accommodate specific patient or clinical needs"
    ],
    bestPractices: [
      "Cluster similar visit types and geographic locations for operational efficiency",
      "Account for patient preferences, availability, and medical urgency in scheduling",
      "Allocate adequate travel time between visits for remote home health care delivery",
      "Implement AI-generated route optimization recommendations to reduce travel time",
      "Confirm all scheduled visits with patients at least 24 hours prior to appointment"
    ]
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
    ]
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
    ]
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
    ]
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
    ]
  },
  {
    title: "HIPAA Compliance & Security",
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
    ]
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

    // Title Page
    doc.setFontSize(28);
    doc.setFont(undefined, 'bold');
    doc.text('CareMetric AI', margin, yPosition);
    
    yPosition += 15;
    doc.setFontSize(18);
    doc.setFont(undefined, 'normal');
    doc.setTextColor(100, 100, 100);
    doc.text('Comprehensive User Guide', margin, yPosition);

    yPosition += 20;
    doc.setFontSize(11);
    doc.setTextColor(0, 0, 0);
    doc.text('Streamline Documentation • Enhance Compliance • Improve Patient Outcomes', margin, yPosition);

    yPosition += 25;
    doc.setFontSize(10);
    doc.setFont(undefined, 'normal');
    doc.setTextColor(120, 120, 120);
    doc.text(`Document Generated: ${new Date().toLocaleDateString()}`, margin, yPosition);
    doc.text(`For: Healthcare Documentation & Compliance Solutions`, margin, yPosition + 6);

    yPosition += 30;

    // Add each feature section
    for (const feature of FEATURES_GUIDE) {
      // Check if we need a new page
      if (yPosition > pageHeight - 40) {
        doc.addPage();
        yPosition = margin;
      }

      // Feature title
      doc.setFontSize(14);
      doc.setFont(undefined, 'bold');
      doc.text(feature.title, margin, yPosition);
      yPosition += 8;

      // Description
      doc.setFontSize(10);
      doc.setFont(undefined, 'normal');
      const descriptionLines = doc.splitTextToSize(feature.description, contentWidth);
      doc.text(descriptionLines, margin, yPosition);
      yPosition += descriptionLines.length * 5 + 3;

      // How to Use section
      doc.setFont(undefined, 'bold');
      doc.text('How to Use:', margin, yPosition);
      yPosition += 5;

      doc.setFont(undefined, 'normal');
      for (const step of feature.howToUse) {
        if (yPosition > pageHeight - 20) {
          doc.addPage();
          yPosition = margin;
        }
        const stepLines = doc.splitTextToSize(step, contentWidth - 5);
        doc.text(stepLines, margin + 3, yPosition);
        yPosition += stepLines.length * 4 + 1;
      }

      yPosition += 3;

      // Best Practices section
      if (yPosition > pageHeight - 40) {
        doc.addPage();
        yPosition = margin;
      }

      doc.setFont(undefined, 'bold');
      doc.text('Best Practices:', margin, yPosition);
      yPosition += 5;

      doc.setFont(undefined, 'normal');
      for (const practice of feature.bestPractices) {
        if (yPosition > pageHeight - 20) {
          doc.addPage();
          yPosition = margin;
        }
        const practiceLines = doc.splitTextToSize(practice, contentWidth - 5);
        doc.text(practiceLines, margin + 3, yPosition);
        yPosition += practiceLines.length * 4 + 1;
      }

      yPosition += 8;
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