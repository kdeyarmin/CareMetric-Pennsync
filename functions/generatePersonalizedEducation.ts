import { createClientFromRequest } from 'npm:@base44/sdk@0.8.6';

Deno.serve(async (req) => {
  try {
    const base44 = createClientFromRequest(req);
    const user = await base44.auth.me();
    if (!user) {
      return Response.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const body = await req.json();
    const { patient_id, topic, language = 'en', reading_level = 'simple' } = body;

    if (!patient_id || !topic) {
      return Response.json({ error: 'patient_id and topic required' }, { status: 400 });
    }

    console.log(`[Education Generator] Generating material for patient ${patient_id}, topic: ${topic}, language: ${language}`);

    // Get patient context
    const patients = await base44.asServiceRole.entities.Patient.list();
    const patient = patients.find(p => p.id === patient_id);
    if (!patient) {
      return Response.json({ error: 'Patient not found' }, { status: 404 });
    }

    const [carePlans, visits] = await Promise.all([
      base44.asServiceRole.entities.CarePlan.filter({ patient_id, status: 'active' }),
      base44.asServiceRole.entities.Visit.filter({ patient_id }, '-visit_date', 5)
    ]);

    // Build patient context
    const patientContext = `
Patient: ${patient.first_name} ${patient.last_name}
Age: ${calculateAge(patient.date_of_birth)}
Primary Diagnosis: ${patient.primary_diagnosis}
Secondary Diagnoses: ${(patient.secondary_diagnoses || []).join(', ')}
Chronic Conditions: ${(patient.chronic_conditions || []).map(c => c.condition).join(', ')}
Current Medications: ${(patient.current_medications || []).map(m => m.name).join(', ')}
Active Care Plan Problems: ${carePlans.map(cp => cp.problem).join(', ')}
`;

    const languageInstructions = {
      en: 'Write in English using clear, simple language appropriate for patients.',
      es: 'Escribe en español usando lenguaje claro y simple apropiado para pacientes.',
      zh: '使用清晰简单的中文书写，适合患者阅读。',
      ar: 'اكتب باللغة العربية باستخدام لغة واضحة وبسيطة مناسبة للمرضى.',
      fr: 'Écrivez en français en utilisant un langage clair et simple adapté aux patients.',
      de: 'Schreiben Sie auf Deutsch in klarer, einfacher Sprache, die für Patienten geeignet ist.'
    };

    const readingLevelGuide = {
      simple: '6th-8th grade reading level. Use short sentences, common words, avoid medical jargon.',
      intermediate: '9th-12th grade reading level. Can use some medical terms with explanations.',
      advanced: 'College reading level. Can use medical terminology appropriately.'
    };

    const res = await base44.integrations.Core.InvokeLLM({
      prompt: `You are a patient education specialist creating culturally appropriate, easy-to-understand health education materials.

**LANGUAGE:** ${languageInstructions[language] || languageInstructions.en}
**READING LEVEL:** ${readingLevelGuide[reading_level]}

**PATIENT CONTEXT:**
${patientContext}

**TOPIC:** ${topic}

**REQUIREMENTS:**
1. **Personalization:** Reference the patient's specific conditions, medications, and care plan when relevant
2. **Cultural Sensitivity:** Ensure content is culturally appropriate and respectful
3. **Actionable:** Provide specific, practical steps the patient can take
4. **Visual:** Include suggestions for diagrams, illustrations, or videos
5. **Engagement:** Include teach-back questions and self-assessment opportunities
6. **Safety:** Emphasize warning signs and when to seek medical help
7. **Empowerment:** Frame content positively, focusing on what the patient CAN do

**STRUCTURE YOUR RESPONSE:**
- Clear title
- Brief overview (2-3 sentences)
- Detailed sections with headers
- Key takeaways (bullet points)
- Warning signs to watch for
- Action items (what to do today/this week)
- Questions for your healthcare team
- Additional resources

Make it engaging, empowering, and easy to remember.`,
      response_json_schema: {
        type: "object",
        properties: {
          title: { type: "string" },
          overview: { type: "string" },
          content_sections: {
            type: "array",
            items: {
              type: "object",
              properties: {
                section_title: { type: "string" },
                content: { type: "string" },
                visual_suggestions: { type: "array", items: { type: "string" } }
              }
            }
          },
          key_takeaways: { type: "array", items: { type: "string" } },
          warning_signs: { type: "array", items: { type: "string" } },
          action_items: {
            type: "array",
            items: {
              type: "object",
              properties: {
                timeframe: { type: "string" },
                action: { type: "string" }
              }
            }
          },
          teach_back_questions: { type: "array", items: { type: "string" } },
          questions_for_provider: { type: "array", items: { type: "string" } },
          additional_resources: { type: "array", items: { type: "string" } },
          reading_time_minutes: { type: "number" }
        }
      }
    });

    // Create material record
    const material = await base44.asServiceRole.entities.PatientEducationMaterial.create({
      title: res.title,
      topic,
      category: categorizeEducationTopic(topic),
      language,
      reading_level,
      content: JSON.stringify(res),
      content_type: 'structured',
      created_by: user.email,
      patient_specific: true,
      target_patient_id: patient_id,
      key_points: res.key_takeaways || [],
      warning_signs: res.warning_signs || [],
      estimated_reading_time_minutes: res.reading_time_minutes || 5
    });

    console.log(`[Education Generator] Created material ID: ${material.id}`);

    return Response.json({ 
      success: true, 
      material_id: material.id,
      content: res 
    });

  } catch (error) {
    console.error('[Education Generator] Error:', error);
    return Response.json({ error: error.message }, { status: 500 });
  }
});

function calculateAge(dob) {
  if (!dob) return 'Unknown';
  const diff = Date.now() - new Date(dob).getTime();
  return Math.floor(diff / (365.25 * 24 * 60 * 60 * 1000));
}

function categorizeEducationTopic(topic) {
  const categories = {
    diabetes: 'chronic_disease',
    hypertension: 'chronic_disease',
    'heart failure': 'chronic_disease',
    copd: 'chronic_disease',
    medication: 'medication_management',
    fall: 'safety',
    diet: 'nutrition',
    exercise: 'lifestyle',
    wound: 'wound_care',
    pain: 'symptom_management'
  };

  const lower = topic.toLowerCase();
  for (const [keyword, category] of Object.entries(categories)) {
    if (lower.includes(keyword)) return category;
  }
  return 'general';
}