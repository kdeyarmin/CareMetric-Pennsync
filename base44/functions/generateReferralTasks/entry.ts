import { createClientFromRequest } from 'npm:@base44/sdk@0.8.31';

Deno.serve(async (req) => {
    try {
        const base44 = createClientFromRequest(req);
        const user = await base44.auth.me();

        if (!user) {
            return Response.json({ error: 'Unauthorized' }, { status: 401 });
        }

        const { referralData, priorityAnalysis } = await req.json();

        const tasks = await base44.integrations.Core.InvokeLLM({
            model: "claude_opus_4_8",
            prompt: `You are an expert home health intake coordinator. Based on the following referral data and AI priority analysis, generate a comprehensive list of actionable tasks that need to be completed by office staff and clinical staff for this referral.

Prioritize tasks based on the referral's urgency. Ensure tasks are specific, measurable, achievable, relevant, and time-bound (SMART).

REFERRAL DATA:
${JSON.stringify(referralData, null, 2)}

PRIORITY ANALYSIS:
${JSON.stringify(priorityAnalysis, null, 2)}

Generate tasks in the following categories:
1. **Immediate/Critical Actions**: Based on priority level and clinical risks
2. **Patient Intake & Verification**: Demographics, insurance, physician orders
3. **Clinical Assessment & Coordination**: Nurse assignment, visit scheduling, care planning
4. **Administrative Tasks**: Documentation, authorization, billing setup

Each task should have:
- title: Concise task description
- description: Detailed instructions for completion
- type: 'call', 'notify', 'schedule', 'order', 'coordinate', 'document', 'safety', 'followup', 'other'
- priority: Match or derive from referral priority ('urgent', 'high', 'normal', 'low')
- assigned_role: 'intake_coordinator', 'nurse_manager', 'field_nurse', 'billing', 'admin', 'other'
- due_date: YYYY-MM-DD format, calculated based on priority
- ai_reason: Brief explanation why this task was generated

Priority-based timing:
- Urgent: Same day or within 4-6 hours
- High: Within 24 hours
- Normal: Within 2-3 days
- Low: Within 1 week

Use 'critical_actions' from priority analysis for urgent tasks.
Reference missing_information, clinical_risks, and urgency_factors to create targeted tasks.

Return a JSON array of 5-12 tasks ordered by priority and due date.`, 
            response_json_schema: {
                type: "object",
                properties: {
                    tasks: {
                        type: "array",
                        items: {
                            type: "object",
                            properties: {
                                title: { type: "string" },
                                description: { type: "string" },
                                type: { type: "string", enum: ["call", "notify", "schedule", "order", "coordinate", "document", "safety", "followup", "other"] },
                                priority: { type: "string", enum: ["high", "medium", "low"] },
                                assigned_role: { type: "string", enum: ["intake_coordinator", "nurse_manager", "field_nurse", "billing", "admin", "other"] },
                                due_date: { type: "string" },
                                ai_reason: { type: "string" }
                            },
                            required: ["title", "description", "type", "priority", "assigned_role", "due_date", "ai_reason"]
                        }
                    }
                }
            }
        });

        return Response.json({ success: true, tasks: tasks.tasks || [] });

    } catch (error) {
        console.error('Error generating referral tasks:', error);
        return Response.json({ 
            error: error.message,
            success: false
        }, { status: 500 });
    }
});