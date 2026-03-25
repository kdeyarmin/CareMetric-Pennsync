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

    const { patient_id, oasis_data, timing } = await req.json();

    if (!patient_id || !oasis_data) {
      return Response.json({ 
        success: false, 
        error: 'Patient ID and OASIS data required' 
      }, { status: 400 });
    }

    // Fetch patient and agency settings for wage index
    const patient = await base44.entities.Patient.get(patient_id);
    let wageIndex = 1.0;
    let basePaymentRate = 2020.61; // 2024 base rate, update annually

    try {
      const agencySettings = await base44.asServiceRole.entities.AgencySettings.filter({});
      if (agencySettings[0]?.wage_index) {
        wageIndex = agencySettings[0].wage_index;
      }
      if (agencySettings[0]?.pdgm_base_rate) {
        basePaymentRate = agencySettings[0].pdgm_base_rate;
      }
    } catch (err) {
      console.warn('Using default wage index and base rate');
    }

    // AI-powered PDGM analysis
    const prompt = `You are a PDGM case mix calculation expert. Analyze the OASIS data and calculate PDGM case mix.

Patient Diagnoses: ${patient.primary_diagnosis || 'Not specified'}
Secondary Diagnoses: ${patient.secondary_diagnoses?.join(', ') || 'None'}

OASIS Data:
${JSON.stringify(oasis_data, null, 2)}

Timing: ${timing || 'early'}

Determine:
1. **Clinical Grouping**: MMTA, MS-Rehab, Neuro-Rehab, Wounds, Complex, or Behavioral Health
2. **Functional Impairment Level**: low, medium, or high (based on OASIS functional items M1800-M1860)
3. **Comorbidity Adjustment**: none, low, or high (based on secondary diagnoses)
4. **Case Mix Weight**: Calculate the PDGM case mix weight (typical range 0.7-3.5)
5. **LUPA Threshold**: Visits required to avoid Low Utilization Payment Adjustment for this clinical group
6. **Optimization Opportunities**: Identify coding/documentation improvements that could increase reimbursement

Provide JSON:
{
  "clinical_grouping": "string",
  "functional_impairment_level": "low|medium|high",
  "comorbidity_adjustment": "none|low|high",
  "case_mix_weight": number,
  "lupa_threshold_visits": number,
  "primary_diagnosis_code": "ICD-10",
  "secondary_diagnoses": ["ICD-10 codes"],
  "optimization_opportunities": [
    {
      "area": "string",
      "current_value": "string",
      "recommended_value": "string",
      "impact": number ($ impact),
      "rationale": "string"
    }
  ],
  "rationale": "Brief explanation of clinical grouping decision"
}`;

    const completion = await openai.chat.completions.create({
      model: "gpt-4o",
      messages: [
        {
          role: "system",
          content: "You are a PDGM case mix calculation expert with deep knowledge of Medicare home health payment policies."
        },
        {
          role: "user",
          content: prompt
        }
      ],
      response_format: { type: "json_object" },
      temperature: 0.1,
      max_tokens: 2000
    });

    const analysis = JSON.parse(completion.choices[0].message.content);

    // Calculate estimated payment
    const estimatedPayment = basePaymentRate * analysis.case_mix_weight * wageIndex;

    // Calculate optimization score
    const optimizationScore = analysis.optimization_opportunities.length === 0 ? 100 : 
      Math.max(50, 100 - (analysis.optimization_opportunities.length * 10));

    // Store PDGM case mix record
    const pdgmRecord = await base44.asServiceRole.entities.PDGMCaseMix.create({
      patient_id,
      timing: timing || 'early',
      clinical_grouping: analysis.clinical_grouping,
      functional_impairment_level: analysis.functional_impairment_level,
      comorbidity_adjustment: analysis.comorbidity_adjustment,
      case_mix_weight: analysis.case_mix_weight,
      estimated_payment: estimatedPayment,
      wage_index: wageIndex,
      base_payment_rate: basePaymentRate,
      primary_diagnosis_code: analysis.primary_diagnosis_code,
      secondary_diagnoses: analysis.secondary_diagnoses || [],
      lupa_threshold_visits: analysis.lupa_threshold_visits,
      actual_visits: 0,
      is_lupa: false,
      optimization_score: optimizationScore,
      optimization_opportunities: analysis.optimization_opportunities || [],
      period_start_date: new Date().toISOString().split('T')[0],
      calculated_date: new Date().toISOString(),
      calculated_by: user.email
    });

    return Response.json({
      success: true,
      pdgm: pdgmRecord,
      analysis: {
        ...analysis,
        estimated_payment: estimatedPayment,
        wage_index: wageIndex,
        optimization_score: optimizationScore
      }
    });

  } catch (error) {
    console.error('PDGM calculation error:', error);
    return Response.json({ 
      success: false, 
      error: error.message 
    }, { status: 500 });
  }
});