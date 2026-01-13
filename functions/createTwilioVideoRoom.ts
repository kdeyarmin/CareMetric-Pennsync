import { createClientFromRequest } from 'npm:@base44/sdk@0.8.6';

Deno.serve(async (req) => {
  try {
    const base44 = createClientFromRequest(req);
    const user = await base44.auth.me();

    if (!user) {
      return Response.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const { patientId, visitId, enableRecording } = await req.json();

    if (!patientId) {
      return Response.json({ error: 'Patient ID required' }, { status: 400 });
    }

    const accountSid = Deno.env.get('TWILIO_ACCOUNT_SID');
    const authToken = Deno.env.get('TWILIO_AUTH_TOKEN');

    if (!accountSid || !authToken) {
      return Response.json({ error: 'Twilio credentials not configured' }, { status: 500 });
    }

    // Create unique room name
    const roomName = `telehealth-${patientId}-${Date.now()}`;

    // Create Twilio Video room
    const response = await fetch(
      `https://video.twilio.com/v1/Rooms`,
      {
        method: 'POST',
        headers: {
          'Authorization': 'Basic ' + btoa(`${accountSid}:${authToken}`),
          'Content-Type': 'application/x-www-form-urlencoded',
        },
        body: new URLSearchParams({
          UniqueName: roomName,
          Type: 'group', // group room for HIPAA compliance features
          RecordParticipantsOnConnect: enableRecording ? 'true' : 'false',
          MaxParticipants: '2',
          StatusCallback: '', // Optional: webhook for room events
        }),
      }
    );

    if (!response.ok) {
      const error = await response.text();
      return Response.json({ error: `Failed to create room: ${error}` }, { status: 500 });
    }

    const room = await response.json();

    // Generate access tokens for provider and patient
    const jwt = await import('npm:jsonwebtoken@9.0.2');
    const AccessToken = (await import('npm:twilio@5.3.7')).jwt.AccessToken;
    const VideoGrant = AccessToken.VideoGrant;

    // Provider token
    const providerToken = new AccessToken(accountSid, Deno.env.get('TWILIO_API_KEY') || accountSid, authToken, {
      identity: `provider-${user.email}`,
      ttl: 3600, // 1 hour
    });
    providerToken.addGrant(new VideoGrant({ room: roomName }));

    // Patient token (simplified - in production, patient would authenticate)
    const patientToken = new AccessToken(accountSid, Deno.env.get('TWILIO_API_KEY') || accountSid, authToken, {
      identity: `patient-${patientId}`,
      ttl: 3600,
    });
    patientToken.addGrant(new VideoGrant({ room: roomName }));

    // Log telehealth visit initiation
    if (visitId) {
      await base44.entities.Visit.update(visitId, {
        telehealth_room_id: room.sid,
        telehealth_room_name: roomName,
        visit_type: 'telehealth'
      });
    }

    return Response.json({
      roomSid: room.sid,
      roomName: roomName,
      providerToken: providerToken.toJwt(),
      patientToken: patientToken.toJwt(),
      patientUrl: `${req.headers.get('origin')}/telehealth-patient/${roomName}?token=${patientToken.toJwt()}`
    });

  } catch (error) {
    console.error('Error creating video room:', error);
    return Response.json({ error: error.message }, { status: 500 });
  }
});