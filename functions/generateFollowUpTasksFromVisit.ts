import { createClientFromRequest } from 'npm:@base44/sdk@0.8.6';

Deno.serve(async (req) => {
    try {
        const base44 = createClientFromRequest(req);
        const user = await base44.auth.me();

        if (!user) {
            return Response.json({ error: 'Unauthorized' }, { status: 401 });
        }

        const { visit_id, patient_id, visit_notes, vital_signs, auto_create = false } = await req.json();

        if (!patient_id) {
            return Response.json({ error: 'patient_id is required' }, { status: 400 });
        }

        // Fetch comprehensive context
        const [patient, recentVisits, carePlans, incidents] = await Promise.all([
            base44.entities.Patient.get(patient_id),
            base44.entities.Visit.filter({ patient_id }, '-visit_date', 5),
            base44.entities.CarePlan.filter({ patient_id, status: 'active' }),
            base44.entities.Incident.filter({ patient_id }, '-incident_date', 5)
        ]);

        if (!patient) {
            return Response.json({ error: 'Patient not found' }, { status: 404 });
        }

        // Build comprehensive prompt
        const taskGenerationPrompt = `You are an expert clinical care coordinator. Based on the following visit information, generate specific follow-up tasks that need to be completed.

**Patient Information:**
- Name: ${patient.first_name} ${patient.last_name}
- Primary Diagnosis: ${patient.primary_diagnosis || 'Not specified'}
- Current Medications: ${patient.current_medications?.length || 0} medications
- Functional Status: ${JSON.stringify(patient.functional_status || {})}

**Current Visit:**
${visit_notes ? `Notes: ${visit_notes}` : 'No notes provided'}

${vital_signs ? `
**Vital Signs:**
- BP: ${vital_signs.blood_pressure_systolic}/${vital_signs.blood_pressure_diastolic}
- HR: ${vital_signs.heart_rate} bpm
- O2 Sat: ${vital_signs.oxygen_saturation}%
- Temp: ${vital_signs.temperature}°F
- Pain: ${vital_signs.pain_level}/10
` : ''}

**Recent Visit History:**
${recentVisits.slice(0, 3).map(v => `- ${v.visit_date}: ${v.visit_type}`).join('\n') || 'None'}

**Active Care Plans:**
${carePlans.map(cp => `- ${cp.problem} → Goal: ${cp.goal}`).join('\n') || 'None'}

**Recent Incidents:**
${incidents.map(i => `- ${i.incident_type} (${i.severity}) on ${i.incident_date}`).join('\n') || 'None'}

**Task:**
Generate 3-7 specific, actionable follow-up tasks based on:
1. Abnormal vital signs or assessment findings
2. Medication management needs
3. Care plan progress monitoring
4. Safety concerns or incident prevention
5. Required physician notifications
6. Documentation or compliance requirements
7. Patient/caregiver education needs

For each task:
- Provide a clear, specific title
- Detailed description with clinical rationale
- Appropriate task type (call, notify, schedule, order, coordinate, document, safety, followup)
- Priority level (critical/high/medium/low) based on clinical urgency
- Recommended due timeframe (today/24_hours/48_hours/this_week/next_visit)
- AI-generated reason explaining why this task is important

Only generate tasks that are truly needed - don't create unnecessary work.`;

        const aiResponse = await base44.integrations.Core.InvokeLLM({
            prompt: taskGenerationPrompt,
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
                                type: { 
                                    type: "string",
                                    enum: ["call", "notify", "schedule", "order", "coordinate", "document", "safety", "followup", "other"]
                                },
                                priority: { type: "string", enum: ["critical", "high", "medium", "low"] },
                                due_timeframe: { 
                                    type: "string",
                                    enum: ["today", "24_hours", "48_hours", "this_week", "next_visit"]
                                },
                                ai_reason: { type: "string" }
                            }
                        }
                    }
                }
            }
        });

        const suggestedTasks = aiResponse.tasks || [];

        // Auto-create tasks if requested
        const createdTasks = [];
        if (auto_create && suggestedTasks.length > 0) {
            for (const task of suggestedTasks) {
                // Calculate due date based on timeframe
                let dueDate = new Date();
                switch (task.due_timeframe) {
                    case 'today':
                        break;
                    case '24_hours':
                        dueDate.setDate(dueDate.getDate() + 1);
                        break;
                    case '48_hours':
                        dueDate.setDate(dueDate.getDate() + 2);
                        break;
                    case 'this_week':
                        dueDate.setDate(dueDate.getDate() + 7);
                        break;
                    case 'next_visit':
                        dueDate.setDate(dueDate.getDate() + 7);
                        break;
                }

                const createdTask = await base44.entities.Task.create({
                    patient_id,
                    title: task.title,
                    description: task.description,
                    type: task.type,
                    priority: task.priority,
                    due_date: dueDate.toISOString().split('T')[0],
                    due_timeframe: task.due_timeframe,
                    assigned_to: user.email,
                    source: 'ai_generated',
                    ai_reason: task.ai_reason,
                    related_visit_id: visit_id,
                    status: 'pending'
                });
                createdTasks.push(createdTask);
            }
        }

        return Response.json({ 
            success: true,
            suggested_tasks: suggestedTasks,
            created_tasks: createdTasks,
            auto_created: auto_create,
            patient_name: `${patient.first_name} ${patient.last_name}`
        });

    } catch (error) {
        return Response.json({ error: error.message }, { status: 500 });
    }
});