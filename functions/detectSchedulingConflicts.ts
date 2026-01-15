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

        const { appointment_date, start_time, end_time, provider_email, duration_minutes = 30 } = await req.json();

        // Get all appointments for the provider on that date
        const appointments = await base44.asServiceRole.entities.Appointment.filter({
            provider_email: provider_email || user.email,
            appointment_date,
            status: { $in: ['scheduled', 'confirmed'] }
        }, 'start_time');

        // Get provider availability
        const availability = await base44.asServiceRole.entities.ProviderAvailability.filter({
            provider_email: provider_email || user.email
        });

        // Get time blocks (lunch, meetings, etc.)
        const timeBlocks = await base44.asServiceRole.entities.ProviderTimeBlock.filter({
            provider_email: provider_email || user.email,
            block_date: appointment_date
        });

        // Detect conflicts
        const conflicts = [];
        
        // Check appointment overlaps
        for (const apt of appointments) {
            const aptStart = new Date(`2000-01-01 ${apt.start_time}`);
            const aptEnd = new Date(`2000-01-01 ${apt.end_time}`);
            const newStart = new Date(`2000-01-01 ${start_time}`);
            const newEnd = new Date(`2000-01-01 ${end_time}`);

            if ((newStart >= aptStart && newStart < aptEnd) ||
                (newEnd > aptStart && newEnd <= aptEnd) ||
                (newStart <= aptStart && newEnd >= aptEnd)) {
                conflicts.push({
                    type: 'appointment_overlap',
                    severity: 'critical',
                    appointment: apt,
                    message: `Overlaps with existing appointment at ${apt.start_time}`
                });
            }
        }

        // Check blocked time
        for (const block of timeBlocks) {
            const blockStart = new Date(`2000-01-01 ${block.start_time}`);
            const blockEnd = new Date(`2000-01-01 ${block.end_time}`);
            const newStart = new Date(`2000-01-01 ${start_time}`);
            const newEnd = new Date(`2000-01-01 ${end_time}`);

            if ((newStart >= blockStart && newStart < blockEnd) ||
                (newEnd > blockStart && newEnd <= blockEnd)) {
                conflicts.push({
                    type: 'blocked_time',
                    severity: 'high',
                    block,
                    message: `Conflicts with ${block.block_type}: ${block.reason || ''}`
                });
            }
        }

        // Use AI to suggest resolutions if conflicts exist
        let resolutions = [];
        if (conflicts.length > 0) {
            const prompt = `You are a scheduling conflict resolution AI. Given the following conflicts, suggest 3 alternative time slots:

Requested Time: ${start_time} - ${end_time}
Date: ${appointment_date}
Duration: ${duration_minutes} minutes

Conflicts Found:
${conflicts.map(c => `- ${c.message} (${c.severity})`).join('\n')}

Existing Appointments Today:
${appointments.map(a => `${a.start_time} - ${a.end_time}`).join('\n')}

Blocked Times:
${timeBlocks.map(b => `${b.start_time} - ${b.end_time} (${b.block_type})`).join('\n')}

Suggest 3 alternative slots that:
1. Avoid all conflicts
2. Maintain reasonable spacing
3. Consider typical appointment flow

Return ONLY a JSON array:
[
  {
    "start_time": "HH:MM",
    "end_time": "HH:MM",
    "reason": "Brief explanation"
  }
]`;

            const response = await openai.chat.completions.create({
                model: "gpt-4o-mini",
                messages: [
                    {
                        role: "system",
                        content: "You are a scheduling AI. Always return valid JSON arrays only."
                    },
                    {
                        role: "user",
                        content: prompt
                    }
                ],
                temperature: 0.5
            });

            resolutions = JSON.parse(response.choices[0].message.content);
        }

        return Response.json({
            has_conflicts: conflicts.length > 0,
            conflicts,
            suggested_resolutions: resolutions,
            all_appointments_count: appointments.length
        });

    } catch (error) {
        console.error('Error:', error);
        return Response.json({ error: error.message }, { status: 500 });
    }
});