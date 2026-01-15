import { createClientFromRequest } from 'npm:@base44/sdk@0.8.6';

Deno.serve(async (req) => {
    try {
        const base44 = createClientFromRequest(req);
        const user = await base44.auth.me();

        if (!user) {
            return Response.json({ error: 'Unauthorized' }, { status: 401 });
        }

        const { note_content, visit_type, diagnosis, patient_id } = await req.json();

        if (!note_content) {
            return Response.json({ error: 'note_content is required' }, { status: 400 });
        }

        // Get patient context if available
        let patientContext = '';
        if (patient_id) {
            const patient = await base44.entities.Patient.get(patient_id);
            if (patient) {
                patientContext = `Primary Diagnosis: ${patient.primary_diagnosis || 'N/A'}`;
            }
        }

        const qualityAnalysisPrompt = `You are an expert clinical documentation quality reviewer. Analyze this note for clarity, completeness, and best practices.

**Note Content:**
${note_content}

**Visit Type:** ${visit_type || 'Not specified'}
**${patientContext}**

**Task:**
Provide real-time suggestions to improve this documentation. Focus on:

1. **Clarity Issues:** Identify vague, ambiguous, or unclear statements that could be misinterpreted
2. **Completeness Gaps:** Note missing critical information based on visit type and diagnosis
3. **Best Practice Improvements:** Suggest better phrasing, medical terminology, or structure
4. **Alternative Phrasing:** Recommend clearer ways to express clinical findings
5. **Additional Details Needed:** Context-based recommendations for what else should be documented
6. **Ambiguities:** Flag statements that could have multiple interpretations

For each suggestion:
- Identify the specific issue with an excerpt from the note
- Explain why it's a problem
- Provide a specific, actionable recommendation
- Categorize severity (critical/important/minor)

Be constructive and specific. Focus on 5-10 most impactful improvements.`;

        const aiResponse = await base44.integrations.Core.InvokeLLM({
            prompt: qualityAnalysisPrompt,
            response_json_schema: {
                type: "object",
                properties: {
                    overall_quality_score: { type: "number" },
                    clarity_score: { type: "number" },
                    completeness_score: { type: "number" },
                    suggestions: {
                        type: "array",
                        items: {
                            type: "object",
                            properties: {
                                category: { 
                                    type: "string",
                                    enum: ["clarity", "completeness", "best_practice", "alternative_phrasing", "additional_detail", "ambiguity"]
                                },
                                severity: { type: "string", enum: ["critical", "important", "minor"] },
                                excerpt: { type: "string" },
                                issue: { type: "string" },
                                recommendation: { type: "string" },
                                improved_text: { type: "string" }
                            }
                        }
                    },
                    strengths: {
                        type: "array",
                        items: { type: "string" }
                    }
                }
            }
        });

        return Response.json({ 
            success: true,
            quality_analysis: aiResponse,
            analyzed_at: new Date().toISOString()
        });

    } catch (error) {
        return Response.json({ error: error.message }, { status: 500 });
    }
});