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
    description: "Generate patient education and clinical documents with AI assistance.",
    howToUse: [
      "1. Navigate to Documents page",
      "2. Select document type (education, discharge, referral)",
      "3. Choose or customize template",
      "4. AI populates with patient data",
      "5. Edit, review, and send to patient or provider"
    ],
    bestPractices: [
      "Customize templates for patient education level",
      "Always review generated content for accuracy",
      "Include plain language explanations",
      "Provide clear discharge instructions",
      "Send documents via secure portal when possible"
    ]
  },
  {
    title: "Provider Scheduling",
    description: "Intelligent scheduling that optimizes visit timing and routes.",
    howToUse: [
      "1. Open Schedule page",
      "2. View weekly or daily schedule",
      "3. Add new visits using intelligent suggestions",
      "4. System optimizes route and timing automatically",
      "5. Adjust as needed for patient preferences"
    ],
    bestPractices: [
      "Schedule similar visit types together",
      "Consider patient preferences and availability",
      "Build in travel time between visits",
      "Use AI route optimization suggestions",
      "Confirm visits 24 hours in advance"
    ]
  },
  {
    title: "OASIS & Compliance",
    description: "Automated OASIS validation and Medicare compliance checking.",
    howToUse: [
      "1. Navigate to OASIS page",
      "2. Enter or upload OASIS data",
      "3. System automatically validates against CMS rules",
      "4. Review any flagged items",
      "5. Make corrections and submit with confidence"
    ],
    bestPractices: [
      "Complete OASIS timely in patient care workflow",
      "Cross-reference clinical documentation with OASIS",
      "Use AI suggestions for missing or conflicting data",
      "Have supervisor review before final submission",
      "Document rationale for any override decisions"
    ]
  },
  {
    title: "Analytics Dashboard",
    description: "Real-time performance metrics and clinical outcome analytics.",
    howToUse: [
      "1. Navigate to Analytics Dashboard",
      "2. Review key performance metrics",
      "3. Use filters to drill into specific data",
      "4. Compare your performance to agency benchmarks",
      "5. Export reports for meetings or reviews"
    ],
    bestPractices: [
      "Review metrics weekly for trends",
      "Use data to identify improvement areas",
      "Share successes with team",
      "Address performance gaps proactively",
      "Track improvements over time"
    ]
  },
  {
    title: "Training & Development",
    description: "Personalized training with AI-generated recommendations.",
    howToUse: [
      "1. Navigate to Training page",
      "2. View assigned and recommended modules",
      "3. Complete training modules at your pace",
      "4. Take assessment quizzes to verify learning",
      "5. Earn certifications and track progress"
    ],
    bestPractices: [
      "Complete mandatory training on schedule",
      "Take recommended modules based on your gaps",
      "Review compliance training regularly",
      "Discuss learning with supervisor",
      "Apply new knowledge to daily practice"
    ]
  },
  {
    title: "Task Management",
    description: "Intelligent task creation with automatic reminders.",
    howToUse: [
      "1. Navigate to Tasks page",
      "2. View assigned and pending tasks",
      "3. Prioritize by due date and urgency",
      "4. Update task status as you complete items",
      "5. System sends reminders for overdue tasks"
    ],
    bestPractices: [
      "Check tasks daily",
      "Prioritize critical and high-priority items",
      "Document completion notes",
      "Coordinate with team on shared tasks",
      "Delegate appropriately within role"
    ]
  },
  {
    title: "HIPAA Compliance & Security",
    description: "Enterprise-grade encryption and access controls.",
    howToUse: [
      "1. Use secure login with multi-factor authentication",
      "2. Access only records you need for patient care",
      "3. Log out when stepping away from computer",
      "4. Report any security concerns immediately",
      "5. Follow all data protection policies"
    ],
    bestPractices: [
      "Never share login credentials",
      "Use VPN when accessing remotely",
      "Secure all devices with passwords",
      "Don't discuss PHI in public areas",
      "Report suspected breaches to IT immediately"
    ]
  },
  {
    title: "Patient Risk Alerts",
    description: "AI-powered early warning for at-risk patients.",
    howToUse: [
      "1. View Risk Alerts on Dashboard",
      "2. Review alert severity and recommendations",
      "3. Click alert to see contributing factors",
      "4. Implement recommended interventions",
      "5. Document actions taken in patient record"
    ],
    bestPractices: [
      "Act promptly on critical alerts",
      "Coordinate with care team on interventions",
      "Document clinical reasoning for decisions",
      "Monitor patient closely after intervention",
      "Follow up within recommended timeframe"
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

    // Title
    doc.setFontSize(24);
    doc.setFont(undefined, 'bold');
    doc.text('CareMetric AI', margin, yPosition);
    
    yPosition += 10;
    doc.setFontSize(16);
    doc.text('User Guide', margin, yPosition);

    yPosition += 15;
    doc.setFontSize(10);
    doc.setFont(undefined, 'normal');
    doc.text(`Generated: ${new Date().toLocaleDateString()}`, margin, yPosition);

    yPosition += 20;

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