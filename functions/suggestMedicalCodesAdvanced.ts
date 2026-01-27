import { createClientFromRequest } from 'npm:@base44/sdk@0.8.6';

Deno.serve(async (req) => {
  try {
    const base44 = createClientFromRequest(req);
    const user = await base44.auth.me();

    if (!user) {
      return Response.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const { clinical_note, extracted_data, diagnosis, visit_type } = await req.json();

    if (!clinical_note && !extracted_data) {
      return Response.json({ 
        error: 'Clinical note or extracted data is required' 
      }, { status: 400 });
    }

    // Build comprehensive context for AI analysis
    const analysisContext = {
      clinical_note,
      extracted_data,
      primary_diagnosis: diagnosis,
      visit_type,
      provider_type: user.credential_type || user.provider_type
    };

    const prompt = `You are an expert medical coding specialist with deep knowledge of ICD-10-CM, CPT, and clinical documentation guidelines. Analyze the following clinical documentation and provide comprehensive coding recommendations.

CLINICAL DOCUMENTATION:
${clinical_note || 'N/A'}

EXTRACTED STRUCTURED DATA:
${extracted_data ? JSON.stringify(extracted_data, null, 2) : 'N/A'}

PRIMARY DIAGNOSIS: ${diagnosis || 'Not specified'}
VISIT TYPE: ${visit_type || 'Not specified'}
PROVIDER TYPE: ${analysisContext.provider_type || 'Not specified'}

Provide a comprehensive coding analysis with the following:

1. **ICD-10 Diagnosis Codes**: Suggest appropriate ICD-10-CM codes based on the documentation
   - Identify the primary diagnosis code
   - Include relevant secondary diagnosis codes
   - Provide clinical justification for each code based on documented findings

2. **CPT Procedure Codes**: Suggest appropriate CPT codes for services rendered
   - Include evaluation & management (E/M) codes if applicable
   - Note any procedure codes based on documented interventions
   - Specify units if applicable

3. **Compliance Alerts**: Flag potential coding issues
   - Undercoding: Services or conditions documented but not captured in coding
   - Overcoding: Codes suggested without sufficient clinical documentation
   - Specificity issues: Codes that could be more specific based on documentation
   - Medical necessity concerns

4. **Documentation Quality**: Assess the documentation supporting the codes
   - Score from 0-100 based on completeness, specificity, and medical necessity support
   - Identify gaps in documentation that could affect reimbursement or audit risk
   - Provide specific improvement recommendations

Return your analysis in the following JSON structure:
{
  "icd10_codes": [
    {
      "code": "string (ICD-10 code)",
      "description": "string (code description)",
      "is_primary": boolean,
      "justification": "string (clinical justification from the documentation)",
      "specificity_level": "string (high/medium/low)"
    }
  ],
  "cpt_codes": [
    {
      "code": "string (CPT code)",
      "description": "string (procedure/service description)",
      "units": number or null,
      "justification": "string (clinical justification from the documentation)",
      "time_based": boolean
    }
  ],
  "compliance_alerts": [
    {
      "type": "string (Undercoding/Overcoding/Specificity/Medical Necessity)",
      "severity": "string (critical/high/medium/low)",
      "message": "string (detailed explanation)",
      "recommendation": "string (specific action to resolve)"
    }
  ],
  "documentation_quality": {
    "score": number (0-100),
    "summary": "string (brief quality assessment)",
    "improvement_areas": ["string (specific documentation gaps or improvements needed)"]
  }
}`;

    const result = await base44.integrations.Core.InvokeLLM({
      prompt: prompt,
      response_json_schema: {
        type: "object",
        properties: {
          icd10_codes: {
            type: "array",
            items: {
              type: "object",
              properties: {
                code: { type: "string" },
                description: { type: "string" },
                is_primary: { type: "boolean" },
                justification: { type: "string" },
                specificity_level: { type: "string" }
              }
            }
          },
          cpt_codes: {
            type: "array",
            items: {
              type: "object",
              properties: {
                code: { type: "string" },
                description: { type: "string" },
                units: { type: "number" },
                justification: { type: "string" },
                time_based: { type: "boolean" }
              }
            }
          },
          compliance_alerts: {
            type: "array",
            items: {
              type: "object",
              properties: {
                type: { type: "string" },
                severity: { type: "string" },
                message: { type: "string" },
                recommendation: { type: "string" }
              }
            }
          },
          documentation_quality: {
            type: "object",
            properties: {
              score: { type: "number" },
              summary: { type: "string" },
              improvement_areas: {
                type: "array",
                items: { type: "string" }
              }
            }
          }
        }
      }
    });

    return Response.json(result);
  } catch (error) {
    console.error('Error in suggestMedicalCodesAdvanced:', error);
    return Response.json({ 
      error: error.message || 'Failed to analyze medical codes' 
    }, { status: 500 });
  }
});