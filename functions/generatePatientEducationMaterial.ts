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

    const { patientId, diagnosis, educationLevel = 'general', topic } = await req.json();

    if (!diagnosis || !topic) {
      return Response.json({ error: 'Missing required fields: diagnosis, topic' }, { status: 400 });
    }

    // Fetch patient data for personalization
    const [patientData, educationMaterials] = await Promise.all([
      patientId ? base44.entities.Patient.filter({ id: patientId }) : Promise.resolve([]),
      base44.entities.PatientEducationMaterial.filter({ diagnosis, topic })
    ]);

    const patient = patientData[0] || null;
    const existingMaterial = educationMaterials[0] || null;

    const prompt = `Create personalized patient education material for:
Patient: ${patient ? `${patient.first_name} ${patient.last_name}, Age: ${patient.date_of_birth ? Math.floor((new Date() - new Date(patient.date_of_birth)) / (365.25 * 24 * 60 * 60 * 1000)) : 'Unknown'}` : 'General patient'}
Diagnosis: ${diagnosis}
Topic: ${topic}
Education Level: ${educationLevel}
${patient?.current_medications ? `Current Medications: ${patient.current_medications.slice(0, 5).map(m => m.name).join(', ')}` : ''}

Create comprehensive yet easy-to-understand patient education material including:
1. Overview (2-3 sentences)
2. Key Points (5-7 bullet points)
3. Daily Tips/Actions (3-5 practical steps)
4. Warning Signs (when to call doctor)
5. Resources/Support

Format as structured JSON with sections.`;

    const completion = await openai.chat.completions.create({
      model: 'gpt-4o',
      messages: [
        {
          role: 'system',
          content: 'You are an expert patient educator. Create clear, compassionate education materials for patients.'
        },
        {
          role: 'user',
          content: prompt
        }
      ],
      response_format: { type: 'json_object' },
      temperature: 0.7,
      max_tokens: 2000
    });

    const educationContent = JSON.parse(completion.choices[0].message.content);

    // Save education material
    const savedMaterial = await base44.entities.PatientEducationMaterial.create({
      diagnosis,
      topic,
      content: educationContent,
      education_level: educationLevel,
      created_by: user.email,
      language: 'en'
    });

    // If patient-specific, log the assignment
    if (patientId && patient) {
      await base44.entities.PatientEducationAssignment.create({
        patient_id: patientId,
        material_id: savedMaterial.id,
        assigned_date: new Date().toISOString(),
        status: 'assigned'
      });
    }

    return Response.json({
      success: true,
      material_id: savedMaterial.id,
      content: educationContent,
      patient_specific: !!patient
    });

  } catch (error) {
    console.error('Education material generation error:', error);
    return Response.json({ error: error.message }, { status: 500 });
  }
});