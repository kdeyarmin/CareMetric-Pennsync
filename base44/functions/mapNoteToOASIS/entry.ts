import { createClientFromRequest } from 'npm:@base44/sdk@0.8.31';

Deno.serve(async (req) => {
  try {
    const base44 = createClientFromRequest(req);
    const user = await base44.auth.me();

    if (!user) {
      return Response.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const { enhancedNote, patientId, visitType, diagnosis, vitalSigns } = await req.json();

    if (!enhancedNote) {
      return Response.json({ error: 'Enhanced note is required' }, { status: 400 });
    }

    // Fetch existing OASIS data if patient ID provided
    let existingOASIS = null;
    if (patientId) {
      // Authorize against the patient before reading their OASIS PHI into the
      // prompt/response (assigned nurse or admin). RLS-independent code check.
      const [oasisPatient] = await base44.asServiceRole.entities.Patient.filter({ id: patientId }, '', 1);
      if (!oasisPatient) return Response.json({ error: 'Patient not found' }, { status: 404 });
      if (user.role !== 'admin' && oasisPatient.created_by !== user.email && !(Array.isArray(oasisPatient.assigned_nurses) && oasisPatient.assigned_nurses.includes(user.email))) {
        return Response.json({ error: 'Forbidden' }, { status: 403 });
      }
      const oasisRecords = await base44.asServiceRole.entities.OASISUpload.filter(
        { patient_id: patientId },
        '-created_date',
        1
      );
      existingOASIS = oasisRecords[0] || null;
    }

    // Comprehensive OASIS items with descriptions and possible values
    const oasisItems = [
      {
        number: "M1021",
        description: "Primary Diagnosis",
        values: "ICD-10 code"
      },
      {
        number: "M1023",
        description: "Other Diagnoses",
        values: "ICD-10 codes"
      },
      {
        number: "M1028",
        description: "Active Diagnoses - Peripheral Vascular Disease",
        values: { "0": "No", "1": "Yes" }
      },
      {
        number: "M1033",
        description: "Risk for Hospitalization",
        values: { "0": "No", "1": "Yes" }
      },
      {
        number: "M1200",
        description: "Vision",
        values: { "0": "Normal", "1": "Partially impaired", "2": "Severely impaired" }
      },
      {
        number: "M1242",
        description: "Frequency of Pain Interfering with Activity",
        values: { "0": "No pain", "1": "Less than daily", "2": "Daily but not constantly", "3": "All the time" }
      },
      {
        number: "M1306",
        description: "Unhealed Pressure Ulcer/Injury Present",
        values: { "0": "No", "1": "Yes" }
      },
      {
        number: "M1311",
        description: "Current Number of Unhealed Pressure Ulcers/Injuries",
        values: { "0": "Zero", "1": "One", "2": "Two", "3": "Three", "4": "Four or more" }
      },
      {
        number: "M1324",
        description: "Stage of Most Problematic Unhealed Pressure Ulcer/Injury",
        values: { "1": "Stage I", "2": "Stage II", "3": "Stage III", "4": "Stage IV", "A1": "Unstageable", "A2": "Deep Tissue Injury" }
      },
      {
        number: "M1330",
        description: "Does this Patient Have a Stasis Ulcer?",
        values: { "0": "No", "1": "Yes" }
      },
      {
        number: "M1340",
        description: "Does this Patient Have a Surgical Wound?",
        values: { "0": "No", "1": "Yes" }
      },
      {
        number: "M1610",
        description: "Urinary Incontinence or Urinary Catheter Present",
        values: { "0": "No incontinence/catheter", "1": "Patient manages own catheter", "2": "Incontinence less than once daily", "3": "Incontinence 2-3 times daily", "4": "Incontinence 4+ times daily", "5": "Catheter present" }
      },
      {
        number: "M1620",
        description: "Bowel Incontinence Frequency",
        values: { "0": "Very rarely or never", "1": "Less than once weekly", "2": "One to three times weekly", "3": "Four to six times weekly", "4": "Daily or more often", "5": "Patient has ostomy" }
      },
      {
        number: "M1710",
        description: "When Confused",
        values: { "0": "Never", "1": "In new situations only", "2": "On awakening or at night", "3": "During day and evening", "4": "Constantly" }
      },
      {
        number: "M1720",
        description: "When Anxious",
        values: { "0": "None of the time", "1": "Less often than daily", "2": "Daily but not constantly", "3": "All the time" }
      },
      {
        number: "M1740",
        description: "Cognitive, Behavioral, Psychiatric Symptoms",
        values: { "0": "No symptoms", "1": "Symptoms present but not disruptive", "2": "Symptoms disruptive but not dangerous", "3": "Symptoms disruptive and dangerous" }
      },
      {
        number: "M1745",
        description: "Frequency of Disruptive Behavior Symptoms",
        values: { "0": "Never", "1": "Less than once a month", "2": "Once a month", "3": "Several times a month", "4": "Several times a week", "5": "At least daily" }
      },
      {
        number: "M1800",
        description: "Grooming",
        values: { "0": "Able to groom self", "1": "Grooming utensils must be placed within reach", "2": "Someone must assist", "3": "Totally dependent" }
      },
      {
        number: "M1810",
        description: "Current Ability to Dress Upper Body",
        values: { "0": "Able to dress upper body", "1": "Able to dress upper body with minimal assistance", "2": "Someone must help", "3": "Totally dependent" }
      },
      {
        number: "M1820",
        description: "Current Ability to Dress Lower Body",
        values: { "0": "Able to dress lower body", "1": "Able to dress lower body with minimal assistance", "2": "Someone must help", "3": "Totally dependent" }
      },
      {
        number: "M1830",
        description: "Bathing",
        values: { "0": "Able to bathe self", "1": "With use of devices", "2": "Able to bathe with some assistance", "3": "Participates in bathing", "4": "Unable to participate", "5": "Totally dependent", "6": "Unable to bathe due to medical restriction" }
      },
      {
        number: "M1840",
        description: "Toilet Transferring",
        values: { "0": "Able to get to and from toilet independently", "1": "When reminded, assisted, or supervised", "2": "Unable to get to and from toilet", "3": "Totally dependent in toileting" }
      },
      {
        number: "M1850",
        description: "Transferring",
        values: { "0": "Able to independently transfer", "1": "Transfers with minimal assistance", "2": "Unable to transfer without assistance", "3": "Bedfast, unable to transfer" }
      },
      {
        number: "M1860",
        description: "Ambulation/Locomotion",
        values: { "0": "Able to walk independently", "1": "Requires use of device", "2": "Able to walk with supervision", "3": "Chairfast, unable to ambulate", "4": "Bedfast, unable to ambulate or be up in chair" }
      },
      {
        number: "M2102",
        description: "Types and Sources of Assistance",
        values: { "0": "No assistance needed", "1": "Non-agency caregiver", "2": "ADH services", "3": "Assistive devices" }
      },
      {
        number: "M2200",
        description: "Therapy Need - Patient requires therapy services",
        values: { "0": "No", "1": "Yes" }
      },
      {
        number: "M2250",
        description: "Plan of Care Synopsis - Intervention Synopsis",
        values: "Free text interventions"
      },
      {
        number: "M1600",
        description: "Treated for UTI in Past 14 Days",
        values: { "0": "No", "1": "Yes" }
      },
      {
        number: "M1870",
        description: "Feeding or Eating",
        values: { "0": "Able to feed self", "1": "Able to feed self with setup", "2": "Unable to feed self", "3": "Totally dependent" }
      },
      {
        number: "M1910",
        description: "Fall Risk Assessment - Has patient had 2+ falls in past year?",
        values: { "0": "No", "1": "Yes" }
      }
    ];

    const prompt = `You are an expert OASIS-E coder with deep knowledge of Medicare home health documentation requirements. Your task is to analyze a clinical nursing note and intelligently map relevant information to specific OASIS assessment items.

CLINICAL NOTE TO ANALYZE:
${enhancedNote}

VISIT CONTEXT:
- Visit Type: ${visitType || 'Not specified'}
- Primary Diagnosis: ${diagnosis || 'Not specified'}
- Vital Signs: ${vitalSigns ? JSON.stringify(vitalSigns) : 'Not provided'}

${existingOASIS ? `EXISTING OASIS DATA (for comparison):
Assessment Date: ${existingOASIS.created_date}
Extracted Data: ${JSON.stringify(existingOASIS.extracted_data || {}, null, 2)}
PDGM Data: ${JSON.stringify(existingOASIS.pdgm_data || {}, null, 2)}
` : 'NO EXISTING OASIS DATA - This is a new assessment'}

OASIS ITEMS TO MAP:
${oasisItems.map(item => `${item.number} - ${item.description}
Possible Values: ${typeof item.values === 'string' ? item.values : JSON.stringify(item.values)}`).join('\n\n')}

TASK:
For EACH OASIS item that can be determined from the clinical note:

1. **Extract Evidence**: Identify EXACT sentences or phrases from the note that relate to this OASIS item
   - Quote the specific text verbatim from the note
   - Include surrounding context if needed for clarity
   - Identify the position in the note (beginning/middle/end section)

2. **Determine Value**: Based on the evidence, suggest the most appropriate OASIS value
   - Use clinical judgment and OASIS-E coding guidelines
   - Consider all available documentation
   - Match to the exact value codes provided

3. **Assign Confidence**: Rate your confidence (0-100%) based on:
   - Explicit documentation: 90-100% (clear, unambiguous statements)
   - Strong inference: 70-89% (multiple supporting data points)
   - Moderate inference: 50-69% (some evidence, needs validation)
   - Weak inference: <50% (insufficient documentation)

4. **Detect Discrepancies**: If existing OASIS data is provided:
   - Compare your suggestion to the current value
   - Identify functional decline/improvement
   - Flag critical changes (wound staging, cognitive status, mobility)
   - Determine severity: critical/high/medium/low

5. **Recommend Action**:
   - "auto_update" = Confidence >85%, clear evidence, no critical discrepancy
   - "review" = Confidence 50-85%, or non-critical discrepancy detected
   - "flag" = Confidence <50%, or CRITICAL discrepancy (functional decline, wound worsening)
   - "no_change" = Current OASIS value matches note documentation

6. **Provide Clinical Rationale**: Explain WHY you assigned this value based on clinical reasoning

CRITICAL ANALYSIS RULES:
- Only suggest values with clear supporting evidence in the note
- Be conservative with confidence - when in doubt, flag for review
- ALWAYS flag functional decline as critical discrepancy
- For ADL items (M1800-M1870): Look for "independent," "requires assist," "needs help," "total care"
- For cognitive items (M1710-M1745): Look for "alert," "oriented," "confused," "forgetful"
- For wounds (M1306-M1340): Look for exact measurements, staging language, wound bed description
- For pain (M1242): Look for frequency descriptors "constant," "daily," "occasional"
- For falls (M1910): Look for "fall history," "multiple falls," "recent fall"
- Quote exact phrases - don't paraphrase or interpret beyond what's written

DISCREPANCY SEVERITY RULES:
- CRITICAL: Functional decline, wound deterioration, new safety risks, cognitive worsening
- HIGH: Moderate changes in status, new symptoms, medication changes
- MEDIUM: Minor documentation inconsistencies, timing differences
- LOW: Phrasing differences with same clinical meaning

Return JSON with detailed mapping results:`;

    const result = await base44.integrations.Core.InvokeLLM({
      model: "claude_opus_4_8",
      prompt,
      response_json_schema: {
        type: "object",
        properties: {
          oasis_suggestions: {
            type: "array",
            items: {
              type: "object",
              properties: {
                item_number: { type: "string" },
                item_description: { type: "string" },
                suggested_value: { type: "string" },
                suggested_value_label: { type: "string" },
                confidence_score: { type: "number" },
                supporting_text: { type: "string" },
                note_location: { type: "string" },
                current_oasis_value: { type: "string" },
                discrepancy_flag: { type: "boolean" },
                discrepancy_reason: { type: "string" },
                discrepancy_severity: { type: "string" },
                action_needed: { type: "string" },
                clinical_rationale: { type: "string" }
              }
            }
          },
          overall_summary: {
            type: "object",
            properties: {
              total_items_mapped: { type: "number" },
              high_confidence_count: { type: "number" },
              discrepancy_count: { type: "number" },
              flagged_for_review_count: { type: "number" },
              auto_update_ready_count: { type: "number" }
            }
          },
          missing_critical_info: {
            type: "array",
            items: {
              type: "object",
              properties: {
                oasis_item: { type: "string" },
                reason: { type: "string" },
                suggestion: { type: "string" }
              }
            }
          }
        }
      }
    });

    // Log the mapping for audit trail
    try {
      await base44.asServiceRole.entities.SystemLog.create({
        job_name: 'OASIS Automation',
        job_type: 'other',
        status: 'success',
        message: `Mapped note to OASIS for patient ${patientId} by ${user.email}`,
        details: {
          patient_id: patientId,
          mapped_by: user.email,
          items_mapped: result.overall_summary?.total_items_mapped || 0,
          discrepancies: result.overall_summary?.discrepancy_count || 0,
          timestamp: new Date().toISOString()
        }
      });
    } catch (logError) {
      console.error('Error logging OASIS automation:', logError);
    }

    return Response.json({
      success: true,
      ...result
    });

  } catch (error) {
    console.error('Error in mapNoteToOASIS:', error);
    return Response.json({ 
      success: false,
      error: error.message 
    }, { status: 500 });
  }
});