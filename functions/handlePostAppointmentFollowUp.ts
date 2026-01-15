import { createClientFromRequest } from 'npm:@base44/sdk@0.8.6';

Deno.serve(async (req) => {
    try {
        const base44 = createClientFromRequest(req);

        const { appointment_id } = await req.json();

        // Get appointment
        const appointment = await base44.asServiceRole.entities.Appointment.filter({ id: appointment_id });
        if (!appointment || appointment.length === 0) {
            return Response.json({ error: 'Appointment not found' }, { status: 404 });
        }

        const apt = appointment[0];

        // Only process completed appointments
        if (apt.status !== 'completed') {
            return Response.json({ message: 'Appointment not completed yet' });
        }

        const results = {
            satisfaction_survey: null,
            followup_analysis: null,
            review_request: null
        };

        // 1. Send satisfaction survey (immediate)
        if (!apt.satisfaction_survey_sent) {
            try {
                results.satisfaction_survey = await base44.asServiceRole.functions.invoke(
                    'sendSatisfactionSurvey',
                    { appointment_id }
                );
            } catch (error) {
                console.error('Survey error:', error);
            }
        }

        // 2. Analyze if follow-up is needed (immediate)
        try {
            results.followup_analysis = await base44.asServiceRole.functions.invoke(
                'analyzeFollowUpNeeds',
                { appointment_id }
            );
        } catch (error) {
            console.error('Follow-up analysis error:', error);
        }

        // 3. Request review (after 2 days delay - would typically use a scheduled task)
        // For now, mark it for later processing
        if (!apt.review_requested) {
            await base44.asServiceRole.entities.Appointment.update(appointment_id, {
                review_request_pending: true,
                review_request_scheduled_for: new Date(Date.now() + 2 * 24 * 60 * 60 * 1000).toISOString()
            });
            results.review_request = { scheduled: true, in_days: 2 };
        }

        return Response.json({
            success: true,
            message: 'Post-appointment follow-up initiated',
            results
        });

    } catch (error) {
        console.error('Error:', error);
        return Response.json({ error: error.message }, { status: 500 });
    }
});