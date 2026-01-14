import { createClientFromRequest } from 'npm:@base44/sdk@0.8.6';
import OpenAI from 'npm:openai@4.28.0';

const openai = new OpenAI({
  apiKey: Deno.env.get('OPENAI_API_KEY'),
});

Deno.serve(async (req) => {
  try {
    const base44 = createClientFromRequest(req);
    const user = await base44.auth.me();

    if (!user) {
      return Response.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const { patientId } = await req.json();

    if (!patientId) {
      return Response.json({ error: 'Missing required field: patientId' }, { status: 400 });
    }

    // Parallel fetch: patient, care plans, visits, incidents
    const [patientData, carePlans, visits, incidents] = await Promise.all([
      base44.entities.Patient.filter({ id: patientId }),
      base44.entities.CarePlan.filter({ patient_id: patientId }),
      base44.entities.Visit.filter({ patient_id: patientId }, '-visit_date', 10),
      base44.entities.Incident.filter({ patient_id: patientId }, '-incident_date', 5)
    ]);

    const patient = patientData[0];
    if (!patient) {
      return Response.json({ error: 'Patient not found' }, { status: 404 });
    }

    // Build optimization context
    const optimizationPrompt = `Analyze this patient's care plan and suggest optimizations:

PATIENT:
- Name: ${patient.first_name} ${patient.last_name}
- Diagnosis: ${patient.primary_diagnosis}
- Care Type: ${patient.care_type}
- Status: ${patient.status}

CURRENT CARE PLANS (${carePlans.length} active):
${carePlans.map(cp => `- Problem: ${cp.problem}, Goal: ${cp.goal}, Status: ${cp.status}`).join('\n')}

RECENT VISITS (${visits.length} in last 60 days):
${visits.slice(0, 5).map(v => `- ${v.visit_date}: ${v.visit_type}`).join('\n')}

RECENT INCIDENTS (${incidents.length}):
${incidents.slice(0, 3).map(i => `- ${i.incident_date}: ${i.incident_type}`).join('\n')}

VITAL TRENDS:
${visits.slice(0, 3).map(v => v.vital_signs ? `- BP: ${v.vital_signs.blood_pressure_systolic}/${v.vital_signs.blood_pressure_diastolic}, HR: ${v.vital_signs.heart_rate}` : '').join('\n')}

Provide optimization suggestions including:
1. Care Plan Adjustments (add/modify/remove goals)
2. Intervention Changes (evidence-based recommendations)
3. Monitoring Frequency Updates
4. Risk Mitigation Strategies
5. Expected Outcomes

Return as JSON with structured recommendations.`;

    const completion = await openai.chat.completions.create({
      model: 'gpt-4o',
      messages: [
        {
          role: 'system',
          content: 'You are an expert clinical care planner. Provide evidence-based care plan optimization suggestions.'
        },
        {
          role: 'user',
          content: optimizationPrompt
        }
      ],
      response_format: { type: 'json_object' },
      temperature: 0.5,
      max_tokens: 2500
    });

    const recommendations = JSON.parse(completion.choices[0].message.content);

    // Save optimization analysis
    const analysis = await base44.entities.RiskAnalysis.create({
      patient_id: patientId,
      analysis_type: 'care_plan_optimization',
      analysis_date: new Date().toISOString(),
      findings: recommendations,
      analyst_email: user.email,
      status: 'pending_review'
    });

    return Response.json({
      success: true,
      analysis_id: analysis.id,
      patient_id: patientId,
      recommendations,
      current_plan_count: carePlans.length,
      recent_incidents: incidents.length
    });

  } catch (error) {
    console.error('Care plan optimization error:', error);
    return Response.json({ error: error.message }, { status: 500 });
  }
});