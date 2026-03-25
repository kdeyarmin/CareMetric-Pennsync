import { createClientFromRequest } from 'npm:@base44/sdk@0.8.6';

Deno.serve(async (req) => {
  try {
    const base44 = createClientFromRequest(req);
    const { note_content, diagnosis, procedures, patient_age, visit_type } = await req.json();

    if (!note_content || !diagnosis) {
      return Response.json({ error: 'Missing required fields' }, { status: 400 });
    }

    const response = await base44.asServiceRole.integrations.Core.InvokeLLM({
      prompt: `You are an expert medical coder specializing in ICD-10 and CPT coding.

Analyze this clinical documentation and suggest relevant codes:

Patient Age: ${patient_age || 'Unknown'}
Visit Type: ${visit_type || 'Unknown'}
Primary Diagnosis: ${diagnosis}
${procedures ? `Procedures: ${procedures}` : ''}

Clinical Note:
${note_content}

Generate BOTH ICD-10 and CPT code suggestions based on the documentation.

For ICD-10 codes:
- Include primary and secondary diagnoses
- Include comorbidities mentioned or implied
- Include complications if mentioned
- Ensure specificity to the 5th character where applicable

For CPT codes:
- Include evaluation and management codes (99xxx range)
- Include procedure codes if procedures are documented
- Include modifier recommendations where applicable

For each code, provide:
- Code: The actual code (e.g., E11.9 for ICD-10 or 99213 for CPT)
- Description: Clear description of what this code represents
- Category: Type of code (diagnosis, procedure, E&M, etc.)
- Explanation: Why this code is relevant based on the clinical note
- Specificity: How confident you are (high/medium/low)
- Billable: Whether this is billable (yes/no)
- Reimbursement: Approximate relative value unit if applicable

IMPORTANT: Only suggest codes that are clearly supported by the documentation. Be conservative and accurate.`,
      response_json_schema: {
        type: 'object',
        properties: {
          icd10_codes: {
            type: 'array',
            items: {
              type: 'object',
              properties: {
                code: { type: 'string' },
                description: { type: 'string' },
                category: { type: 'string' },
                explanation: { type: 'string' },
                specificity: { type: 'string', enum: ['high', 'medium', 'low'] },
                billable: { type: 'boolean' }
              }
            }
          },
          cpt_codes: {
            type: 'array',
            items: {
              type: 'object',
              properties: {
                code: { type: 'string' },
                description: { type: 'string' },
                category: { type: 'string' },
                explanation: { type: 'string' },
                specificity: { type: 'string', enum: ['high', 'medium', 'low'] },
                billable: { type: 'boolean' },
                rvu: { type: 'number' },
                modifiers: {
                  type: 'array',
                  items: { type: 'string' }
                }
              }
            }
          },
          coding_summary: { type: 'string' },
          clinical_rationale: { type: 'string' }
        }
      }
    });

    return Response.json({
      success: true,
      icd10_codes: response.icd10_codes || [],
      cpt_codes: response.cpt_codes || [],
      coding_summary: response.coding_summary || '',
      clinical_rationale: response.clinical_rationale || '',
      timestamp: new Date().toISOString()
    });
  } catch (error) {
    console.error('Error in suggestMedicalCodesComprehensive:', error);
    return Response.json({ 
      error: error.message,
      success: false,
      icd10_codes: [],
      cpt_codes: []
    }, { status: 500 });
  }
});