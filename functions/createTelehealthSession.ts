import { createClientFromRequest } from 'npm:@base44/sdk@0.8.6';
import Twilio from 'npm:twilio';

Deno.serve(async (req) => {
  try {
    const base44 = createClientFromRequest(req);
    const user = await base44.auth.me();

    if (!user) {
      return Response.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const { visitId, patientId, isPatient } = await req.json();

    if (!visitId || !patientId) {
      return Response.json({ error: 'Visit ID and Patient ID required' }, { status: 400 });
    }

    // Verify visit exists and user has access
    const visit = await base44.entities.Visit.get(visitId);
    if (!visit || visit.patient_id !== patientId) {
      return Response.json({ error: 'Invalid visit' }, { status: 403 });
    }

    const accountSid = Deno.env.get('TWILIO_ACCOUNT_SID');
    const authToken = Deno.env.get('TWILIO_AUTH_TOKEN');
    const apiKeySid = Deno.env.get('TWILIO_API_KEY_SID');
    const apiKeySecret = Deno.env.get('TWILIO_API_KEY_SECRET');

    if (!accountSid || !authToken) {
      console.error('Missing Twilio credentials');
      return Response.json({ error: 'Telehealth not configured' }, { status: 500 });
    }

    const client = Twilio(accountSid, authToken);
    
    // Create unique room name
    const roomName = `visit_${visitId}_${Date.now()}`;
    
    // Create or get video room
    let room;
    try {
      // Check if room already exists for this visit
      const existingRoom = visit.telehealth_room_name;
      if (existingRoom) {
        try {
          room = await client.video.v1.rooms(visit.telehealth_room_id).fetch();
        } catch {
          // Room doesn't exist, create new one
          room = await client.video.v1.rooms.create({
            uniqueName: roomName,
            type: 'group',
            recordParticipantsOnConnect: false,
            maxParticipants: 10
          });
        }
      } else {
        room = await client.video.v1.rooms.create({
          uniqueName: roomName,
          type: 'group',
          recordParticipantsOnConnect: false,
          maxParticipants: 10
        });
      }
    } catch (error) {
      console.error('Error creating room:', error);
      return Response.json({ error: 'Failed to create video room' }, { status: 500 });
    }

    // Generate access token
    const AccessToken = Twilio.jwt.AccessToken;
    const VideoGrant = AccessToken.VideoGrant;

    const identity = isPatient ? `patient_${patientId}` : user.email;

    const token = new AccessToken(
      accountSid,
      apiKeySid || accountSid,
      apiKeySecret || authToken,
      { identity }
    );

    const videoGrant = new VideoGrant({
      room: room.uniqueName || roomName
    });

    token.addGrant(videoGrant);

    // Update visit with telehealth info (only if not already set)
    if (!visit.telehealth_room_id) {
      await base44.asServiceRole.entities.Visit.update(visitId, {
        telehealth_room_id: room.sid,
        telehealth_room_name: room.uniqueName || roomName
      });
    }

    // Log security event
    await base44.entities.SecurityLog.create({
      timestamp: new Date().toISOString(),
      user_email: user.email,
      user_role: user.role,
      action: 'telehealth_session_created',
      details: {
        visitId,
        patientId,
        roomId: room.sid
      }
    });

    return Response.json({
      token: token.toJwt(),
      roomName: room.uniqueName || roomName,
      roomSid: room.sid,
      identity
    });

  } catch (error) {
    console.error('Telehealth session creation error:', error);
    return Response.json({ 
      error: error.message || 'Failed to create telehealth session' 
    }, { status: 500 });
  }
});