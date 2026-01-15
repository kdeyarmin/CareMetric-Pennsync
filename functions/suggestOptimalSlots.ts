import { createClientFromRequest } from 'npm:@base44/sdk@0.8.6';
import OpenAI from 'npm:openai';

const openai = new OpenAI({
    apiKey: Deno.env.get("OPENAI_API_KEY"),
});

Deno.serve(async (req) => {
    try {
        const base44 = createClientFromRequest(req);
        const user = await base44.auth.me();

        if (!user) {
            return Response.json({ error: 'Unauthorized' }, { status: 401 });
        }

        const { patient_id, provider_email, appointment_type, preferred_date, duration_minutes = 30 } = await req.json();

        // Get patient info
        const patient = await base44.entities.Patient.filter({ id: patient_id });
        if (!patient || patient.length === 0) {
            return Response.json({ error: 'Patient not found' }, { status: 404 });
        }

        // Get provider availability
        const availability = await base44.asServiceRole.entities.ProviderAvailability.filter({
            provider_email: provider_email || user.email
        });

        // Get existing appointments for the provider
        const existingAppointments = await base44.asServiceRole.entities.Appointment.filter({
            provider_email: provider_email || user.email,
            status: { $in: ['scheduled', 'confirmed'] }
        });

        // Get patient's past appointments for pattern analysis
        const patientHistory = await base44.asServiceRole.entities.Appointment.filter({
            patient_id,
            status: 'completed'
        }, '-appointment_date', 10);

        // Use AI to suggest optimal slots
        const prompt = `You are a healthcare scheduling AI assistant. Analyze the following data and suggest 5 optimal appointment time slots:

Patient Info:
- Name: ${patient[0].first_name} ${patient[0].last_name}
- Past Appointments: ${patientHistory.length} completed visits
- Recent appointment times: ${patientHistory.slice(0, 3).map(a => a.start_time).join(', ')}
- Primary Diagnosis: ${patient[0].primary_diagnosis || 'N/A'}

Provider Availability:
${JSON.stringify(availability, null, 2)}

Existing Appointments (to avoid conflicts):
${existingAppointments.slice(0, 20).map(a => `${a.appointment_date} at ${a.start_time}`).join('\n')}

Request:
- Appointment Type: ${appointment_type}
- Preferred Date: ${preferred_date || 'Any day this week'}
- Duration: ${duration_minutes} minutes

Consider:
1. Patient's past appointment preferences
2. Provider availability windows
3. Avoiding conflicts with existing appointments
4. Optimal time spacing between appointments
5. Patient's condition urgency

Return ONLY a JSON array of 5 suggested slots in this exact format:
[
  {
    "date": "YYYY-MM-DD",
    "start_time": "HH:MM",
    "end_time": "HH:MM",
    "confidence_score": 95,
    "reason": "Matches patient's preferred morning slot pattern and allows adequate preparation time"
  }
]`;

        const response = await openai.chat.completions.create({
            model: "gpt-4o-mini",
            messages: [
                {
                    role: "system",
                    content: "You are a healthcare scheduling optimization AI. Always return valid JSON arrays only."
                },
                {
                    role: "user",
                    content: prompt
                }
            ],
            temperature: 0.7
        });

        const suggestedSlots = JSON.parse(response.choices[0].message.content);

        // Check for conflicts in each suggested slot
        const slotsWithConflicts = suggestedSlots.map(slot => {
            const conflict = existingAppointments.find(apt => 
                apt.appointment_date === slot.date && 
                apt.start_time === slot.start_time
            );
            return {
                ...slot,
                has_conflict: !!conflict,
                conflict_details: conflict ? `Conflicts with ${conflict.patient_id} appointment` : null
            };
        });

        return Response.json({
            suggested_slots: slotsWithConflicts,
            patient_preferences: {
                total_past_appointments: patientHistory.length,
                common_times: patientHistory.map(a => a.start_time)
            },
            provider_availability_summary: availability.length > 0 ? "Available" : "Limited availability"
        });

    } catch (error) {
        console.error('Error:', error);
        return Response.json({ error: error.message }, { status: 500 });
    }
});