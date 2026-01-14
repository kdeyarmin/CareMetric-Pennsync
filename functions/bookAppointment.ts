import { createClientFromRequest } from 'npm:@base44/sdk@0.8.6';

Deno.serve(async (req) => {
    try {
        const base44 = createClientFromRequest(req);
        const user = await base44.auth.me();

        if (!user) {
            return Response.json({ error: 'Unauthorized' }, { status: 401 });
        }

        const { patientId, providerEmail, appointmentDate, startTime, endTime, visitType = 'telehealth', title, notes } = await req.json();

        if (!patientId || !providerEmail || !appointmentDate || !startTime || !endTime) {
            return Response.json({ error: 'Missing required fields' }, { status: 400 });
        }

        // Check if slot is available
        const appointments = await base44.entities.Appointment.filter({
            provider_email: providerEmail,
            appointment_date: appointmentDate,
            status: { $ne: 'cancelled' }
        });

        const newStart = parseInt(startTime.replace(':', ''));
        const newEnd = parseInt(endTime.replace(':', ''));

        const conflictExists = appointments.some(apt => {
            const aptStart = parseInt(apt.start_time.replace(':', ''));
            const aptEnd = parseInt(apt.end_time.replace(':', ''));
            return (newStart < aptEnd && newEnd > aptStart);
        });

        if (conflictExists) {
            return Response.json({ error: 'Time slot is no longer available' }, { status: 409 });
        }

        // Create appointment
        const appointment = await base44.entities.Appointment.create({
            patient_id: patientId,
            provider_email: providerEmail,
            appointment_date: appointmentDate,
            start_time: startTime,
            end_time: endTime,
            visit_type: visitType,
            title: title || 'Appointment',
            notes: notes || '',
            status: 'scheduled'
        });

        return Response.json({
            success: true,
            appointmentId: appointment.id,
            message: 'Appointment booked successfully'
        });
    } catch (error) {
        return Response.json({ error: error.message }, { status: 500 });
    }
});