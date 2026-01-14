import { createClientFromRequest } from 'npm:@base44/sdk@0.8.6';

const TWILIO_ACCOUNT_SID = Deno.env.get('TWILIO_ACCOUNT_SID');
const TWILIO_AUTH_TOKEN = Deno.env.get('TWILIO_AUTH_TOKEN');

Deno.serve(async (req) => {
    try {
        const base44 = createClientFromRequest(req);
        const user = await base44.auth.me();

        if (!user) {
            return Response.json({ error: 'Unauthorized' }, { status: 401 });
        }

        const { visitId, roomSid, callDuration, summary } = await req.json();

        if (!visitId || !roomSid) {
            return Response.json({ error: 'Visit ID and room SID required' }, { status: 400 });
        }

        // Close the Twilio room
        const auth = btoa(`${TWILIO_ACCOUNT_SID}:${TWILIO_AUTH_TOKEN}`);
        await fetch(`https://video.twilio.com/v1/Rooms/${roomSid}`, {
            method: 'POST',
            headers: {
                'Authorization': `Basic ${auth}`,
                'Content-Type': 'application/x-www-form-urlencoded'
            },
            body: new URLSearchParams({
                Status: 'completed'
            })
        });

        // Update visit with session data
        await base44.entities.Visit.update(visitId, {
            telehealth_call_duration: callDuration,
            telehealth_summary: summary,
            status: 'completed'
        });

        return Response.json({
            success: true,
            message: 'Telehealth session ended and visit updated'
        });
    } catch (error) {
        return Response.json({ error: error.message }, { status: 500 });
    }
});