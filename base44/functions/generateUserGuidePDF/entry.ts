import { createClientFromRequest } from 'npm:@base44/sdk@0.8.31';
import { jsPDF } from 'npm:jspdf@2.5.1';

Deno.serve(async (req) => {
  try {
    const base44 = createClientFromRequest(req);
    const user = await base44.auth.me();

    if (!user) {
      return Response.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const { guide_type } = await req.json();

    // Define guide prompts
    const guidePrompts = {
      referral_intake: `
REFERRAL INTAKE PROCESS GUIDE

Create detailed instructions for staff entering and uploading referrals:

**INTRODUCTION**
- Purpose of the referral intake system
- Benefits of AI-powered extraction
- Overview of the workflow

**STEP-BY-STEP INSTRUCTIONS**

1. ACCESSING THE REFERRAL INTAKE PAGE
   - Navigation from dashboard
   - What you'll see on the page

2. UPLOADING A REFERRAL DOCUMENT
   - Click "Upload New Referral" button
   - Supported file types (PDF, PNG, JPG, TIFF)
   - File size limits
   - Drag and drop option

3. AI PROCESSING
   - What happens during processing (5 stages)
   - Typical processing time
   - Progress indicators to watch

4. REVIEWING EXTRACTED DATA
   - Patient demographics section
   - Diagnoses and medical history
   - Medications
   - Functional status
   - Insurance information
   - Clinical summary

5. VERIFYING AI-EXTRACTED FIELDS
   - Look for confidence indicators
   - Yellow flags = requires verification
   - How to edit incorrect data
   - Using the confidence score

6. PATIENT MATCHING
   - Automatic patient match detection
   - Reviewing suggested matches
   - Confirming existing patient vs creating new
   - Resolving duplicate warnings

7. COMPLETING THE REFERRAL FORM
   - Required fields (marked with *)
   - Referral source
   - Referral date
   - Priority level
   - Assigning to nurse

8. AI FEATURES AVAILABLE
   - AI-generated admission note
   - OASIS pre-assessment
   - Care plan suggestions
   - How to use each feature

9. GENERATING ADMISSION PACKET
   - Click "Generate Admission Packet" button
   - What's included in the packet
   - Downloading the PDF
   - Saving the processed referral URL

10. TROUBLESHOOTING
    - Poor quality scans
    - Missing information
    - AI confidence issues
    - When to manually enter data

**BEST PRACTICES**
- Quality of source documents
- When to verify AI suggestions
- Communication with nursing staff

**TIPS FOR SUCCESS**
- Use clear, high-resolution scans
- Review all yellow-flagged fields
- Double-check patient matching
- Assign to appropriate nurse based on territory`,
      
      admission_documentation: `

ADMISSION VISIT DOCUMENTATION GUIDE

Create detailed instructions for nurses completing admission visits:

**INTRODUCTION**
- Purpose of admission documentation
- Medicare compliance requirements
- AI assistance overview

**STEP-BY-STEP INSTRUCTIONS**

1. PREPARING FOR THE VISIT
   - Review referral data in patient chart
   - Check pre-populated admission note
   - Review AI-generated care plan suggestions
   - Verify patient demographics

2. ACCESSING SMART NOTE ASSISTANT
   - Navigate to "Smart Notes" or "Quick Note"
   - Select the patient
   - Choose "Admission" as visit type
   - Pre-populated fields you'll see

3. DURING THE PATIENT VISIT
   - Using voice dictation (optional)
   - Recording vital signs
   - Documenting assessment findings
   - Taking photos of wounds (if applicable)

4. COMPLETING THE ASSESSMENT
   - Head-to-toe assessment
   - Functional status evaluation
   - Safety assessment
   - Medication reconciliation
   - Homebound justification

5. USING AI ASSISTANCE
   - Real-time suggestions while typing
   - Compliance checker feedback
   - Missing element alerts
   - OASIS alignment indicators

6. DOCUMENTING IN SOAP FORMAT
   - Subjective: Patient complaints, history
   - Objective: Vital signs, physical exam
   - Assessment: Clinical summary, homebound status
   - Plan: Interventions, frequency, goals

7. REVIEWING AI-GENERATED NOTE
   - Click "Enhance Note" button
   - Review AI-formatted SOAP note
   - Edit as needed for accuracy
   - Use "Review Quality" feature

8. QUALITY REVIEW FEATURES
   - Compliance score (aim for 85%+)
   - Missing elements highlighted
   - Vague language suggestions
   - PDGM optimization tips
   - Quick wins to address

9. ADDRESSING DOCUMENTATION GAPS
   - Copy suggested text
   - Add specific measurements
   - Include homebound justification
   - Document skilled need clearly

10. COMPLETING OASIS ASSESSMENT
    - Use AI OASIS pre-assessment
    - Verify each item against actual findings
    - Review confidence scores
    - Flag items needing clarification

11. FINALIZING CARE PLANS
    - Review AI-suggested care plans
    - Modify based on actual visit
    - Set realistic goals
    - Assign appropriate frequencies

12. SAVING DOCUMENTATION
    - Click "Save to Patient Chart"
    - Verify it's saved under correct visit
    - Send family update if applicable
    - Close any auto-generated tasks

**MEDICARE COMPLIANCE CHECKLIST**
□ Homebound status clearly documented
□ Skilled need justified
□ Specific functional measurements
□ Vital signs documented
□ Safety assessment completed
□ Medication reconciliation done
□ Patient/caregiver teaching documented
□ Goals are SMART (Specific, Measurable, Achievable, Relevant, Time-bound)

**BEST PRACTICES**
- Review referral data before visit
- Use voice dictation during visit
- Be specific with measurements
- Document skilled nursing interventions
- Verify AI suggestions against actual findings
- Use compliance checker before saving

**COMMON PITFALLS TO AVOID**
- Vague language ("appears," "seems")
- Missing homebound justification
- Non-specific functional assessments
- Incomplete vital signs
- Weak skilled need documentation

**TIPS FOR SUCCESS**
- Use AI assistance but verify everything
- Document what YOU observed
- Include patient/caregiver quotes
- Specify assistance levels for ADLs
- Compare to baseline when possible`,

      smart_notes: `SMART NOTES & QUICK NOTE GUIDE

Comprehensive guide for using AI-powered documentation tools:

**SECTIONS:**
1. Introduction to Smart Notes
2. Quick Note for rapid documentation
3. Voice dictation features
4. AI enhancement capabilities
5. Real-time compliance checking
6. SOAP format documentation
7. Clinical event extraction
8. Saving and syncing notes
9. Offline mode capabilities
10. Best practices and tips`,

      oasis_assessment: `OASIS ASSESSMENT GUIDE

Complete guide for OASIS documentation with AI assistance:

**SECTIONS:**
1. OASIS overview and requirements
2. Starting a new OASIS assessment
3. Using AI pre-assessment features
4. Completing OASIS items
5. Confidence scores and validation
6. PDGM case mix optimization
7. Documentation alignment
8. Quality review process
9. Submitting assessments
10. Common errors and solutions`,

      care_plans: `CARE PLAN MANAGEMENT GUIDE

Guide for creating and managing patient care plans:

**SECTIONS:**
1. Creating new care plans
2. AI-generated suggestions
3. Setting SMART goals
4. Documenting interventions
5. Tracking progress
6. Updating care plans
7. Care plan gaps analysis
8. Automatic care plan triggers
9. Interdisciplinary coordination
10. Best practices`,

      patient_management: `PATIENT MANAGEMENT GUIDE

Complete guide for managing patient records:

**SECTIONS:**
1. Adding new patients
2. Searching and filtering patients
3. Patient 360 view
4. Updating demographics
5. Medical history tracking
6. Medication reconciliation
7. Document management
8. Communication with team
9. Patient education materials
10. Discharge planning`,

      training_hub: `TRAINING HUB GUIDE

Guide for completing training and professional development:

**SECTIONS:**
1. Accessing training modules
2. Required vs optional training
3. Interactive quizzes and scenarios
4. Tracking completion
5. Earning certificates
6. Personalized recommendations
7. Skill gap analysis
8. Micro-learning opportunities
9. Practice scenarios
10. Continuing education credits`,

      compliance_quality: `COMPLIANCE & QUALITY GUIDE

Guide for maintaining Medicare compliance and quality standards:

**SECTIONS:**
1. Compliance dashboard overview
2. Real-time compliance alerts
3. Documentation quality scoring
4. Medicare guidelines library
5. Regulatory updates
6. Audit preparation
7. Quality improvement initiatives
8. Performance metrics
9. Best practice alerts
10. Reporting and analytics`,

      messages: `MESSAGING & COMMUNICATION GUIDE

Guide for team communication and coordination:

**SECTIONS:**
1. Accessing messages
2. Creating new messages
3. Threading and replies
4. Patient-specific messages
5. Priority and urgent messages
6. Attaching files
7. Message notifications
8. Team coordination
9. Care handoffs
10. Message organization`,

      patient_alerts: `PATIENT ALERTS & MONITORING GUIDE

Guide for managing patient risk alerts:

**SECTIONS:**
1. Alert dashboard overview
2. Types of alerts
3. Severity levels
4. Reviewing alert details
5. Acknowledging alerts
6. Creating action plans
7. Assigning follow-up
8. Alert resolution
9. Predictive analytics
10. Alert history and trends`,

      all_features: `PENN SYNC - COMPLETE USER GUIDE

Comprehensive guide covering all features of the Penn Sync Healthcare platform:

**CORE MODULES:**

1. DASHBOARD & NAVIGATION
- Home dashboard overview
- Navigation menu
- Quick actions
- Notifications
- Favorites
- User settings

2. REFERRAL INTAKE
- Uploading referrals
- AI data extraction
- Patient matching
- Admission packets
- Task assignment

3. PATIENT MANAGEMENT
- Patient records
- Patient 360 view
- Demographics
- Medical history
- Documents
- Communication

4. DOCUMENTATION
- Smart Notes
- Quick Note
- Voice dictation
- SOAP format
- AI enhancement
- Quality review
- Offline mode

5. OASIS ASSESSMENT
- Creating assessments
- AI pre-assessment
- Item-by-item completion
- Validation
- PDGM optimization
- Submission

6. CARE PLANS
- Creating care plans
- AI suggestions
- SMART goals
- Progress tracking
- Gap analysis
- Updates

7. VISITS & SCHEDULING
- Scheduling visits
- Visit documentation
- Vital signs
- Incident reporting
- Family updates
- Visit history

8. CLINICAL TOOLS
- Patient alerts
- Risk assessment
- Clinical events
- Medication tracking
- Wound management
- Care coordination

9. QUALITY & COMPLIANCE
- Compliance dashboard
- Documentation quality
- Medicare guidelines
- Regulatory updates
- Audit tools
- Performance metrics

10. COMMUNICATION
- Team messaging
- Patient education
- Care team coordination
- Physician communication
- Family updates

11. TRAINING & DEVELOPMENT
- Training modules
- Skill assessments
- Certifications
- Personalized learning
- Practice scenarios
- Performance feedback

12. REPORTING & ANALYTICS
- Dashboard metrics
- Custom reports
- Performance analytics
- Compliance reports
- PDGM analysis
- Quality indicators

13. ADMIN FEATURES (Admin Only)
- User management
- Agency settings
- Training management
- System monitoring
- Audit trail
- Configuration

**GETTING STARTED:**
- Initial login
- Profile setup
- Navigation basics
- Common workflows

**ADVANCED FEATURES:**
- AI capabilities overview
- Workflow optimization
- Integration tips
- Troubleshooting

**BEST PRACTICES:**
- Documentation excellence
- Compliance maintenance
- Time management
- Quality improvement

**SUPPORT & RESOURCES:**
- Help and support
- Training resources
- Contact information
- Feedback submission`
    };

    // Get the appropriate prompt
    const promptText = guidePrompts[guide_type] || guidePrompts.all_features;

    // Generate guide content using AI
    const guideContent = await base44.integrations.Core.InvokeLLM({
      model: "claude_sonnet_4_6",
      prompt: `Generate a comprehensive, step-by-step user guide for healthcare staff.

${promptText}

Format this as a clear, professional user guide with:
- Section headers
- Numbered steps
- Bullet points for details
- Call-out boxes for important notes
- Tips and warnings
- Troubleshooting section

Keep language simple and non-technical. Include specific button names and field labels.`,
      response_json_schema: {
        type: "object",
        properties: {
          title: { type: "string" },
          sections: {
            type: "array",
            items: {
              type: "object",
              properties: {
                heading: { type: "string" },
                content: { type: "string" },
                subsections: {
                  type: "array",
                  items: {
                    type: "object",
                    properties: {
                      subheading: { type: "string" },
                      steps: {
                        type: "array",
                        items: { type: "string" }
                      },
                      notes: {
                        type: "array",
                        items: { type: "string" }
                      }
                    }
                  }
                }
              }
            }
          }
        }
      }
    });

    // Create PDF
    const doc = new jsPDF({
      orientation: 'portrait',
      unit: 'mm',
      format: 'letter'
    });

    let yPosition = 20;
    const pageWidth = doc.internal.pageSize.width;
    const pageHeight = doc.internal.pageSize.height;
    const margin = 15;
    const contentWidth = pageWidth - (margin * 2);

    // Header
    doc.setFillColor(59, 130, 246);
    doc.rect(0, 0, pageWidth, 30, 'F');
    doc.setTextColor(255, 255, 255);
    doc.setFontSize(24);
    doc.setFont(undefined, 'bold');
    doc.text(guideContent.title || 'User Guide', pageWidth / 2, 20, { align: 'center' });

    yPosition = 45;

    // Helper function to check if we need a new page
    const checkNewPage = (neededSpace) => {
      if (yPosition + neededSpace > pageHeight - 20) {
        doc.addPage();
        yPosition = 20;
        return true;
      }
      return false;
    };

    // Helper function to add wrapped text
    const addWrappedText = (text, fontSize, color, isBold = false) => {
      doc.setFontSize(fontSize);
      doc.setTextColor(...color);
      doc.setFont(undefined, isBold ? 'bold' : 'normal');
      const lines = doc.splitTextToSize(text, contentWidth);

      // Page-break per line so a block taller than a page doesn't draw off the
      // bottom edge (the single up-front check couldn't catch that).
      lines.forEach(line => {
        checkNewPage(fontSize * 0.4);
        doc.text(line, margin, yPosition);
        yPosition += fontSize * 0.4;
      });
    };

    // Process sections (guideContent is LLM output — sections may be absent)
    (guideContent.sections || []).forEach((section, sectionIndex) => {
      // Section header with background
      checkNewPage(15);
      doc.setFillColor(243, 244, 246);
      doc.rect(margin - 2, yPosition - 5, contentWidth + 4, 12, 'F');
      addWrappedText(section.heading, 16, [31, 41, 55], true);
      yPosition += 5;

      // Section content
      if (section.content) {
        addWrappedText(section.content, 10, [75, 85, 99]);
        yPosition += 3;
      }

      // Subsections
      section.subsections?.forEach((subsection, subIndex) => {
        checkNewPage(20);
        
        // Subsection heading
        doc.setFillColor(219, 234, 254);
        doc.rect(margin, yPosition - 4, contentWidth, 8, 'F');
        addWrappedText(subsection.subheading, 12, [30, 64, 175], true);
        yPosition += 3;

        // Steps
        subsection.steps?.forEach((step, stepIndex) => {
          checkNewPage(10);
          doc.setFillColor(59, 130, 246);
          doc.circle(margin + 3, yPosition - 1.5, 2, 'F');
          
          doc.setFontSize(10);
          doc.setTextColor(55, 65, 81);
          doc.setFont(undefined, 'normal');
          const stepLines = doc.splitTextToSize(step, contentWidth - 10);
          stepLines.forEach((line, lineIndex) => {
            doc.text(line, margin + 8, yPosition);
            yPosition += 4;
          });
        });

        // Notes (call-out boxes)
        subsection.notes?.forEach((note) => {
          checkNewPage(15);
          doc.setFillColor(254, 243, 199);
          doc.setDrawColor(251, 191, 36);
          const noteLines = doc.splitTextToSize(note, contentWidth - 10);
          const boxHeight = (noteLines.length * 4) + 4;
          doc.rect(margin, yPosition - 2, contentWidth, boxHeight, 'FD');
          
          doc.setFontSize(9);
          doc.setTextColor(146, 64, 14);
          doc.setFont(undefined, 'bold');
          doc.text('💡 TIP:', margin + 3, yPosition + 2);
          
          doc.setFont(undefined, 'normal');
          noteLines.forEach((line, idx) => {
            doc.text(line, margin + 15, yPosition + 2 + (idx * 4));
          });
          yPosition += boxHeight + 3;
        });

        yPosition += 3;
      });

      yPosition += 5;
    });

    // Footer on each page
    const totalPages = doc.internal.pages.length - 1;
    for (let i = 1; i <= totalPages; i++) {
      doc.setPage(i);
      doc.setFontSize(8);
      doc.setTextColor(156, 163, 175);
      doc.text(
        `Penn Sync Healthcare - ${guideContent.title} | Page ${i} of ${totalPages}`,
        pageWidth / 2,
        pageHeight - 10,
        { align: 'center' }
      );
      doc.text(
        `Generated: ${new Date().toLocaleDateString()}`,
        pageWidth - margin,
        pageHeight - 10,
        { align: 'right' }
      );
      
      // Copyright notice
      doc.setFontSize(7);
      doc.text(
        '© Copyright Kevin Deyarmin 2025. All rights reserved.',
        pageWidth / 2,
        pageHeight - 5,
        { align: 'center' }
      );
    }

    const pdfBytes = doc.output('arraybuffer');

    return new Response(pdfBytes, {
      status: 200,
      headers: {
        'Content-Type': 'application/pdf',
        'Content-Disposition': `attachment; filename="${guide_type}_guide.pdf"`
      }
    });

  } catch (error) {
    console.error('Error generating user guide:', error);
    return Response.json({ 
      error: error.message,
    }, { status: 500 });
  }
});