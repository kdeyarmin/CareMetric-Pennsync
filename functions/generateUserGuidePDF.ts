import { createClientFromRequest } from 'npm:@base44/sdk@0.8.6';
import { jsPDF } from 'npm:jspdf@2.5.2';

Deno.serve(async (req) => {
  try {
    const base44 = createClientFromRequest(req);
    const user = await base44.auth.me();

    if (!user) {
      return Response.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const doc = new jsPDF();
    let yPos = 20;
    const pageHeight = doc.internal.pageSize.height;
    const marginBottom = 20;

    const addNewPage = () => {
      doc.addPage();
      yPos = 20;
    };

    const checkPageBreak = (requiredSpace = 20) => {
      if (yPos + requiredSpace > pageHeight - marginBottom) {
        addNewPage();
      }
    };

    // Title Page
    doc.setFontSize(24);
    doc.setFont(undefined, 'bold');
    doc.text('CareMetric AI', 105, yPos, { align: 'center' });
    
    yPos += 15;
    doc.setFontSize(18);
    doc.text('User Guide', 105, yPos, { align: 'center' });
    
    yPos += 10;
    doc.setFontSize(12);
    doc.setFont(undefined, 'normal');
    doc.text('Comprehensive Feature Guide by Provider Type', 105, yPos, { align: 'center' });
    
    yPos += 20;
    doc.setFontSize(10);
    doc.text(`Generated: ${new Date().toLocaleDateString()}`, 105, yPos, { align: 'center' });

    const providerGuides = {
      'Registered Nurse (RN)': {
        features: [
          {
            category: 'Smart Documentation',
            items: [
              {
                title: 'Smart Notes Assistant',
                description: 'AI-powered clinical documentation with real-time Medicare compliance scoring',
                steps: [
                  'Navigate to Smart Notes from the main menu',
                  'Select your patient from the search',
                  'Choose visit type and enter vital signs',
                  'Dictate or type your clinical note',
                  'Review AI suggestions for compliance',
                  'Use one-click fixes for missing requirements'
                ]
              },
              {
                title: 'Medical Scribe',
                description: 'Voice-to-text transcription with automatic clinical formatting',
                steps: [
                  'Open Medical Scribe feature',
                  'Click microphone icon to start recording',
                  'Speak naturally about your visit',
                  'AI automatically formats into SOAP format',
                  'Review and edit generated note'
                ]
              },
              {
                title: 'Real-Time Compliance Scoring',
                description: 'Live 0-100 compliance score as you document',
                steps: [
                  'Open any documentation screen',
                  'Watch the compliance score update in real-time',
                  'Click on red/yellow items to see what\'s missing',
                  'Use Quick Fix buttons to add required elements',
                  'Aim for 90+ score before finalizing'
                ]
              }
            ]
          },
          {
            category: 'Clinical Decision Support',
            items: [
              {
                title: 'Differential Diagnosis Suggester',
                description: 'AI analyzes symptoms and suggests possible diagnoses',
                steps: [
                  'Enter patient symptoms and assessment',
                  'Click Analyze to get differential diagnoses',
                  'Review suggested diagnoses with evidence',
                  'Select applicable diagnoses for documentation'
                ]
              },
              {
                title: 'Medication Cross-Checker',
                description: 'Automatic drug interaction and allergy checking',
                steps: [
                  'Enter patient medications',
                  'System automatically checks for interactions',
                  'Review warnings and contraindications',
                  'Document medication reconciliation'
                ]
              },
              {
                title: 'Medicare Coverage Determination',
                description: 'Analyzes if visit meets Medicare coverage criteria',
                steps: [
                  'Complete visit documentation',
                  'Click Analyze Coverage',
                  'Review coverage determination',
                  'View denial risk assessment',
                  'Use auto-generated skilled need justification'
                ]
              }
            ]
          },
          {
            category: 'Telehealth',
            items: [
              {
                title: 'Telehealth Visits',
                description: 'HIPAA-compliant video visits with AI support',
                steps: [
                  'Schedule appointment from Telehealth Dashboard',
                  'Send invitation link to patient',
                  'Start video call at appointment time',
                  'Use AI transcription during call',
                  'Auto-generate visit summary after call'
                ]
              }
            ]
          }
        ]
      },
      'Physical Therapist (PT)': {
        features: [
          {
            category: 'Assessment & Documentation',
            items: [
              {
                title: 'Functional Assessment',
                description: 'Comprehensive mobility and ADL assessment',
                steps: [
                  'Navigate to PT Assessment',
                  'Complete functional status evaluation',
                  'Document baseline measurements',
                  'Set functional goals with patient',
                  'Generate treatment plan'
                ]
              }
            ]
          }
        ]
      },
      'Medical Social Worker (MSW)': {
        features: [
          {
            category: 'Psychosocial Assessment',
            items: [
              {
                title: 'Social Assessment',
                description: 'Comprehensive psychosocial evaluation',
                steps: [
                  'Navigate to Social Work Assessment',
                  'Evaluate living situation and support system',
                  'Screen for depression and anxiety',
                  'Identify resource needs',
                  'Connect to community resources'
                ]
              }
            ]
          }
        ]
      }
    };

    // Generate content for each provider type
    for (const [providerType, guide] of Object.entries(providerGuides)) {
      addNewPage();
      
      // Provider Type Header
      doc.setFontSize(18);
      doc.setFont(undefined, 'bold');
      doc.text(providerType, 20, yPos);
      yPos += 10;
      
      doc.setFontSize(10);
      doc.setFont(undefined, 'normal');
      
      for (const category of guide.features) {
        checkPageBreak(30);
        
        // Category Header
        doc.setFontSize(14);
        doc.setFont(undefined, 'bold');
        doc.text(category.category, 20, yPos);
        yPos += 8;
        
        for (const item of category.items) {
          checkPageBreak(40);
          
          // Feature Title
          doc.setFontSize(12);
          doc.setFont(undefined, 'bold');
          doc.text(item.title, 25, yPos);
          yPos += 6;
          
          // Description
          doc.setFontSize(10);
          doc.setFont(undefined, 'italic');
          const descLines = doc.splitTextToSize(item.description, 160);
          doc.text(descLines, 25, yPos);
          yPos += descLines.length * 5 + 3;
          
          // How to use steps
          doc.setFont(undefined, 'normal');
          doc.text('How to use:', 25, yPos);
          yPos += 5;
          
          item.steps.forEach((step, idx) => {
            checkPageBreak(10);
            const stepLines = doc.splitTextToSize(`${idx + 1}. ${step}`, 155);
            doc.text(stepLines, 30, yPos);
            yPos += stepLines.length * 5;
          });
          
          yPos += 5;
        }
        
        yPos += 5;
      }
    }

    // Footer on last page
    checkPageBreak(30);
    yPos = pageHeight - 30;
    doc.setFontSize(9);
    doc.setFont(undefined, 'italic');
    doc.text('For support and questions, contact support@caremetric.ai', 105, yPos, { align: 'center' });

    const pdfBytes = doc.output('arraybuffer');

    return new Response(pdfBytes, {
      status: 200,
      headers: {
        'Content-Type': 'application/pdf',
        'Content-Disposition': 'attachment; filename=CareMetric-AI-User-Guide.pdf'
      }
    });

  } catch (error) {
    console.error('Error generating user guide PDF:', error);
    return Response.json({ 
      error: error.message,
      success: false 
    }, { status: 500 });
  }
});