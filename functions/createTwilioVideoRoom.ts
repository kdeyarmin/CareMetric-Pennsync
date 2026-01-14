import { createClientFromRequest } from 'npm:@base44/sdk@0.8.6';

Deno.serve(async (req) => {
  try {
    const base44 = createClientFromRequest(req);
    const user = await base44.auth.me();

    if (!user) {
      return Response.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const { patientId, visitId, enableRecording } = await req.json();

    // Validate required fields
    if (!patientId || !visitId) {
      return Response.json({ error: 'Missing patientId or visitId' }, { status: 400 });
    }

    // Get Twilio credentials from environment
    const twilioAccountSid = Deno.env.get('TWILIO_ACCOUNT_SID');
    const twilioAuthToken = Deno.env.get('TWILIO_AUTH_TOKEN');

    if (!twilioAccountSid || !twilioAuthToken) {
      return Response.json({ error: 'Twilio credentials not configured' }, { status: 500 });
    }

    // Generate unique room name
    const roomName = `visit-${visitId}-${Date.now()}`;

    // Create tokens for both provider and patient
    const { connect } = await import('npm:twilio@3.78.0');
    const twilio = connect(twilioAccountSid, twilioAuthToken);

    // Provider token - full permissions
    const { default: jwt } = await import('npm:jsonwebtoken@9.1.0');
    const providerToken = jwt.sign(
      {
        sub: user.id,
        name: user.full_name,
        iss: twilioAccountSid,
        grants: {
          video: {
            room: roomName,
            roomProfiles: ['group'],
            recordParticipantsOnConnect: enableRecording || false
          }
        }
      },
      twilioAuthToken,
      {
        header: { typ: 'JWT', alg: 'HS256' },
        expiresIn: 3600
      }
    );

    // Patient token - with recording limitations
    const patientToken = jwt.sign(
      {
        sub: patientId,
        name: 'Patient',
        iss: twilioAccountSid,
        grants: {
          video: {
            room: roomName,
            roomProfiles: ['group']
          }
        }
      },
      twilioAuthToken,
      {
        header: { typ: 'JWT', alg: 'HS256' },
        expiresIn: 3600
      }
    );

    // Store room metadata for later retrieval
    try {
      await base44.asServiceRole.entities.SystemLog.create({
        timestamp: new Date().toISOString(),
        user_email: user.email,
        action: 'telehealth_room_created',
        details: {
          roomName,
          visitId,
          patientId,
          enableRecording,
          providerEmail: user.email
        }
      });
    } catch (logError) {
      console.error('Failed to log room creation:', logError);
    }

    return Response.json({
      roomName,
      providerToken,
      patientToken,
      patientUrl: `${Deno.env.get('BASE44_APP_URL') || 'https://app.caremetric.ai'}/telehealth?room=${roomName}&token=${patientToken}`,
      recordingEnabled: enableRecording,
      expiresIn: 3600
    });
  } catch (error) {
    console.error('Error creating Twilio video room:', error);
    return Response.json(
      { error: error.message || 'Failed to create video room' },
      { status: 500 }
    );
  }
});