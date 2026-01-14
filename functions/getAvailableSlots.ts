import { createClientFromRequest } from 'npm:@base44/sdk@0.8.6';

Deno.serve(async (req) => {
    try {
        const base44 = createClientFromRequest(req);
        const user = await base44.auth.me();

        if (!user) {
            return Response.json({ error: 'Unauthorized' }, { status: 401 });
        }

        const { providerEmail, date } = await req.json();

        if (!providerEmail || !date) {
            return Response.json({ error: 'Provider email and date required' }, { status: 400 });
        }

        // Get provider availability for the day of week
        const targetDate = new Date(date);
        const dayOfWeek = targetDate.getDay();

        const [availability, appointments] = await Promise.all([
            base44.entities.ProviderAvailability.filter({
                provider_email: providerEmail,
                day_of_week: dayOfWeek,
                is_active: true
            }),
            base44.entities.Appointment.filter({
                provider_email: providerEmail,
                appointment_date: date,
                status: { $ne: 'cancelled' }
            })
        ]);

        if (availability.length === 0) {
            return Response.json({ availableSlots: [], message: 'Provider is not available on this day' });
        }

        const slots = [];
        const availPeriod = availability[0];
        const slotDuration = availPeriod.slot_duration_minutes || 30;

        // Generate all possible slots
        let [startHour, startMin] = availPeriod.start_time.split(':').map(Number);
        const [endHour, endMin] = availPeriod.end_time.split(':').map(Number);

        const endTotalMins = endHour * 60 + endMin;

        while (true) {
            const currentTotalMins = startHour * 60 + startMin;
            if (currentTotalMins >= endTotalMins) break;

            const slotStart = `${String(startHour).padStart(2, '0')}:${String(startMin).padStart(2, '0')}`;
            const slotEndMins = currentTotalMins + slotDuration;
            const slotEndHour = Math.floor(slotEndMins / 60);
            const slotEndMin = slotEndMins % 60;
            const slotEnd = `${String(slotEndHour).padStart(2, '0')}:${String(slotEndMin).padStart(2, '0')}`;

            // Check if slot is available
            const isBooked = appointments.some(apt => {
                const aptStart = parseInt(apt.start_time.replace(':', ''));
                const aptEnd = parseInt(apt.end_time.replace(':', ''));
                const slotStartInt = parseInt(slotStart.replace(':', ''));
                const slotEndInt = parseInt(slotEnd.replace(':', ''));
                return slotStartInt < aptEnd && slotEndInt > aptStart;
            });

            if (!isBooked) {
                slots.push({ startTime: slotStart, endTime: slotEnd });
            }

            startMin += slotDuration;
            if (startMin >= 60) {
                startHour += Math.floor(startMin / 60);
                startMin = startMin % 60;
            }
        }

        return Response.json({ availableSlots: slots });
    } catch (error) {
        return Response.json({ error: error.message }, { status: 500 });
    }
});