import { jsPDF } from 'npm:jspdf@2.5.1';
import { createClientFromRequest } from 'npm:@base44/sdk@0.8.6';

const FEATURES_GUIDE = [
  {
    title: "Smart Notes Assistant",
    description: "AI-powered documentation assistant that enhances clinical notes in real-time.",
    howToUse: [
      "1. Open a visit or patient record",
      "2. Begin dictating or typing clinical findings",
      "3. The AI will suggest enhancements and compliance improvements in real-time",
      "4. Review and accept suggestions or edit as needed",
      "5. Generate final note for approval and submission"
    ],
    bestPractices: [
      "Be specific with clinical details for better AI suggestions",
      "Review all AI recommendations before submitting",
      "Use medical terminology for improved accuracy",
      "Provide baseline information for better documentation",
      "Regularly update patient history for context"
    ]
  },
  {
    title: "Medical Scribe",
    description: "Voice-to-text medical scribe that transcribes patient interactions.",
    howToUse: [
      "1. Click the microphone icon to start recording",
      "2. Speak naturally during patient interaction",
      "3. The system transcribes speech to text in real-time",
      "4. Review the transcription for accuracy",
      "5. AI converts transcription to structured clinical note"
    ],
    bestPractices: [
      "Speak clearly and at normal pace",
      "Minimize background noise during recording",
      "Include relevant clinical observations in narrative",
      "Use standard medical terminology",
      "Save transcriptions immediately after recording"
    ]
  },
  {
    title: "Patient Management",
    description: "Centralized database with comprehensive patient health records.",
    howToUse: [
      "1. Navigate to Patients page",
      "2. Use search or filter to find patient",
      "3. Click patient name to view full profile",
      "4. Update patient information as needed",
      "5. Access complete care history and documents"
    ],
    bestPractices: [
      "Keep demographic information current",
      "Document all diagnoses and allergies",
      "Maintain emergency contact information",
      "Regular medication reconciliation",
      "Document care team members involved"
    ]
  },
  {
    title: "Care Plan Management",
    description: "Automated care plan creation and tracking.",
    howToUse: [
      "1. Open patient record and navigate to Care Plans",
      "2. Click 'Create Care Plan' or use AI suggestions",
      "3. Define problems, goals, and interventions",
      "4. Set review dates and assign to team members",
      "5. Track progress and update as patient status changes"
    ],
    bestPractices: [
      "Set measurable and achievable goals",
      "Review care plans at least monthly",
      "Involve patient in goal setting",
      "Collaborate with interdisciplinary team",
      "Document progress at each visit"
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