import { createClientFromRequest } from 'npm:@base44/sdk@0.8.6';

Deno.serve(async (req) => {
  try {
    const base44 = createClientFromRequest(req);
    const user = await base44.auth.me();

    if (!user) {
      return Response.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const { 
      enhanced_note, 
      visit_type, 
      diagnosis, 
      patient_id,
      vital_signs = {},
      patient_context = null,
      care_plans = []
    } = await req.json();

    console.log('Generating care coordination actions...');

    // Build comprehensive prompt for care coordination
    const coordinationPrompt = `You are an expert care coordination specialist. Analyze this clinical note and patient context to identify necessary care coordination actions.

CLINICAL NOTE:
${enhanced_note}

VISIT TYPE: ${visit_type}
PRIMARY DIAGNOSIS: ${diagnosis}

${patient_context ? `PATIENT CONTEXT:
- Age: ${patient_context.age || 'Not specified'}
- Primary Diagnosis: ${patient_context.primary_diagnosis}
${patient_context.secondary_diagnoses?.length > 0 ? `- Comorbidities: ${patient_context.secondary_diagnoses.join(', ')}\n` : ''}${patient_context.allergies ? `- Allergies: ${patient_context.allergies}\n` : ''}${patient_context.current_medications?.length > 0 ? `- Current Medications: ${patient_context.current_medications.map(m => m.name).join(', ')}\n` : ''}` : ''}

${vital_signs && Object.values(vital_signs).some(v => v) ? `VITAL SIGNS:
${vital_signs.temperature ? `Temperature: ${vital_signs.temperature}°F\n` : ''}${vital_signs.heart_rate ? `Heart Rate: ${vital_signs.heart_rate} bpm\n` : ''}${vital_signs.bp_systolic ? `Blood Pressure: ${vital_signs.bp_systolic}/${vital_signs.bp_diastolic}\n` : ''}${vital_signs.oxygen_saturation ? `O2 Sat: ${vital_signs.oxygen_saturation}%\n` : ''}` : ''}

${care_plans?.length > 0 ? `ACTIVE CARE PLANS:
${care_plans.map((cp, i) => `${i + 1}. Problem: ${cp.problem}\n   Goal: ${cp.goal}\n   Current Status: ${cp.status}`).join('\n')}
` : ''}

TASK: Identify all necessary care coordination actions based on the clinical note and patient context.

Analyze the note for:
1. SPECIALIST REFERRALS: Identify needs for PT, OT, ST, SW, dietitian, wound care, or other specialists based on clinical findings
2. DIAGNOSTIC REFERRALS: Lab work, imaging, cardiac testing, or other diagnostic needs mentioned or implied
3. PATIENT EDUCATION: Specific topics patient needs education on based on diagnosis, medications, or care gaps
4. FOLLOW-UP TASKS: Critical nursing tasks, care team coordination, or monitoring needs
5. CARE PLAN UPDATES: Recommendations to update existing care plans based on current assessment

For each action:
- Provide clinical justification from the note
- Include specific details (what specialist, what education topic, what task)
- Assign appropriate priority and timeframe
- Draft the content (referral letter, education material summary, task description)
- Link to specific findings in the note

Be thorough but only suggest clinically necessary actions.`;

    const response = await base44.integrations.Core.InvokeLLM({
      prompt: coordinationPrompt,
      response_json_schema: {
        type: "object",
        properties: {
          specialist_referrals: {
            type: "array",
            items: {
              type: "object",
              properties: {
                specialist_type: { type: "string" },
                reason: { type: "string" },
                clinical_findings: { type: "string" },
                urgency: { type: "string", enum: ["urgent", "routine", "soon"] },
                draft_referral_content: { type: "string" },
                icd10_codes: {
                  type: "array",
                  items: { type: "string" }
                }
              }
            }
          },
          diagnostic_referrals: {
            type: "array",
            items: {
              type: "object",
              properties: {
                test_type: { type: "string" },
                clinical_indication: { type: "string" },
                urgency: { type: "string", enum: ["stat", "urgent", "routine"] },
                ordering_physician: { type: "string" },
                draft_order_note: { type: "string" }
              }
            }
          },
          patient_education_needs: {
            type: "array",
            items: {
              type: "object",
              properties: {
                topic: { type: "string" },
                category: { type: "string" },
                clinical_basis: { type: "string" },
                priority: { type: "string", enum: ["high", "medium", "low"] },
                key_points: {
                  type: "array",
                  items: { type: "string" }
                },
                teach_back_questions: {
                  type: "array",
                  items: { type: "string" }
                }
              }
            }
          },
          follow_up_tasks: {
            type: "array",
            items: {
              type: "object",
              properties: {
                task_title: { type: "string" },
                task_description: { type: "string" },
                assigned_to_role: { type: "string" },
                priority: { type: "string", enum: ["critical", "high", "medium", "low"] },
                due_timeframe: { type: "string" },
                clinical_rationale: { type: "string" },
                related_care_plan_goal: { type: "string" }
              }
            }
          },
          care_plan_updates: {
            type: "array",
            items: {
              type: "object",
              properties: {
                existing_problem: { type: "string" },
                update_type: { type: "string", enum: ["progress_note", "goal_revision", "new_intervention", "escalation"] },
                recommendation: { type: "string" },
                clinical_basis: { type: "string" }
              }
            }
          }
        }
      }
    });

    console.log('Care coordination actions generated successfully');

    return Response.json({
      success: true,
      coordination_actions: response
    });

  } catch (error) {
    console.error('[generateCareCoordinationActions] Error:', error);
    return Response.json({
      success: false,
      error: error.message
    }, { status: 500 });
  }
});