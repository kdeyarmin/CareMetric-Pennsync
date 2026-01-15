import { createClientFromRequest } from 'npm:@base44/sdk@0.8.6';

Deno.serve(async (req) => {
    try {
        const base44 = createClientFromRequest(req);
        const user = await base44.auth.me();

        if (!user) {
            return Response.json({ error: 'Unauthorized' }, { status: 401 });
        }

        const { patient_id } = await req.json();

        if (!patient_id) {
            return Response.json({ error: 'patient_id is required' }, { status: 400 });
        }

        // Fetch comprehensive patient data
        const [patient, recentVisits, incidents, carePlans, carePlanProgress, existingRisks] = await Promise.all([
            base44.asServiceRole.entities.Patient.get(patient_id),
            base44.asServiceRole.entities.Visit.filter({ patient_id }, '-visit_date', 10),
            base44.asServiceRole.entities.Incident.filter({ patient_id }, '-incident_date', 10),
            base44.asServiceRole.entities.CarePlan.filter({ patient_id, status: 'active' }),
            base44.asServiceRole.entities.CarePlanProgress.filter({ patient_id }, '-progress_date', 5),
            base44.asServiceRole.entities.PatientRiskAssessment.filter({ patient_id, status: 'active' })
        ]);

        if (!patient) {
            return Response.json({ error: 'Patient not found' }, { status: 404 });
        }

        // Build comprehensive prompt
        const riskAnalysisPrompt = `You are an expert clinical risk assessment specialist. Analyze the following patient data to predict potential risks.

**Patient Profile:**
- Name: ${patient.first_name} ${patient.last_name}
- Age: ${patient.date_of_birth ? Math.floor((new Date() - new Date(patient.date_of_birth)) / 31557600000) : 'Unknown'}
- Primary Diagnosis: ${patient.primary_diagnosis || 'Not specified'}
- Secondary Diagnoses: ${patient.secondary_diagnoses?.join(', ') || 'None'}
- Allergies: ${patient.allergies || 'None'}
- Functional Status: ${JSON.stringify(patient.functional_status || {})}

**Current Medications (${patient.current_medications?.length || 0}):**
${patient.current_medications?.map(m => `- ${m.name} ${m.dosage} ${m.frequency}`).join('\n') || 'None listed'}

**Recent Vital Signs Trends:**
${recentVisits.map(v => `
- ${v.visit_date}: BP ${v.vital_signs?.blood_pressure_systolic}/${v.vital_signs?.blood_pressure_diastolic}, HR ${v.vital_signs?.heart_rate}, O2 ${v.vital_signs?.oxygen_saturation}%, Pain ${v.vital_signs?.pain_level}/10
`).join('\n') || 'No recent vitals'}

**Recent Incidents (${incidents.length}):**
${incidents.map(i => `- ${i.incident_type} (${i.severity}): ${i.incident_date}`).join('\n') || 'None'}

**Active Care Plans:**
${carePlans.map(cp => `- Goal: ${cp.goal} | Status: ${cp.status}`).join('\n') || 'None'}

**Recent Progress Notes:**
${carePlanProgress.map(p => `- ${p.progress_date}: ${p.progress_status} - ${p.notes?.substring(0, 100) || ''}`).join('\n') || 'None'}

**Task:**
Predict 2-5 most significant risks for this patient in the next 7-14 days. For each risk:
1. Identify the risk type (fall, readmission, infection, deterioration, medication_complication, pressure_injury, dehydration, non_compliance)
2. Calculate risk level (critical/high/moderate/low) and score (0-100)
3. List specific contributing factors with weight/importance
4. Provide 3-5 specific, evidence-based intervention suggestions prioritized by effectiveness
5. Specify expected timeframe for risk
6. Note key clinical indicators that support this prediction

Be specific and actionable. Focus on risks that are preventable with proper interventions.`;

        const aiResponse = await base44.asServiceRole.integrations.Core.InvokeLLM({
            prompt: riskAnalysisPrompt,
            response_json_schema: {
                type: "object",
                properties: {
                    risk_assessments: {
                        type: "array",
                        items: {
                            type: "object",
                            properties: {
                                risk_type: { 
                                    type: "string",
                                    enum: ["fall", "readmission", "infection", "deterioration", "medication_complication", "pressure_injury", "dehydration", "non_compliance"]
                                },
                                risk_level: { type: "string", enum: ["critical", "high", "moderate", "low"] },
                                risk_score: { type: "number" },
                                contributing_factors: {
                                    type: "array",
                                    items: {
                                        type: "object",
                                        properties: {
                                            factor: { type: "string" },
                                            weight: { type: "number" },
                                            evidence: { type: "string" }
                                        }
                                    }
                                },
                                intervention_suggestions: {
                                    type: "array",
                                    items: {
                                        type: "object",
                                        properties: {
                                            intervention: { type: "string" },
                                            priority: { type: "string" },
                                            evidence_based: { type: "boolean" }
                                        }
                                    }
                                },
                                timeframe: { type: "string" },
                                clinical_indicators: { type: "object" }
                            }
                        }
                    }
                }
            }
        });

        const risks = aiResponse.risk_assessments || [];

        // Create risk assessment records
        const createdRisks = [];
        for (const risk of risks) {
            // Check if similar active risk already exists
            const similarRisk = existingRisks.find(er => 
                er.risk_type === risk.risk_type && 
                er.status === 'active'
            );

            if (!similarRisk) {
                const newRisk = await base44.asServiceRole.entities.PatientRiskAssessment.create({
                    patient_id,
                    risk_type: risk.risk_type,
                    risk_level: risk.risk_level,
                    risk_score: risk.risk_score,
                    contributing_factors: risk.contributing_factors,
                    intervention_suggestions: risk.intervention_suggestions,
                    clinical_indicators: risk.clinical_indicators,
                    prediction_date: new Date().toISOString(),
                    timeframe: risk.timeframe,
                    status: 'active',
                    ai_model_version: 'v1.0'
                });
                createdRisks.push(newRisk);
            }
        }

        return Response.json({ 
            success: true,
            patient_name: `${patient.first_name} ${patient.last_name}`,
            risks_identified: createdRisks.length,
            risks: createdRisks,
            analysis_date: new Date().toISOString()
        });

    } catch (error) {
        return Response.json({ error: error.message }, { status: 500 });
    }
});