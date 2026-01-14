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

        const { roomName } = await req.json();

        if (!roomName) {
            return Response.json({ error: 'Room name required' }, { status: 400 });
        }

        // Import JWT library inline
        const jwtHeader = {
            alg: 'HS256',
            typ: 'JWT'
        };

        const now = Math.floor(Date.now() / 1000);
        const jwtPayload = {
            iss: TWILIO_ACCOUNT_SID,
            sub: TWILIO_ACCOUNT_SID,
            aud: 'twilio.com/video',
            exp: now + 3600, // 1 hour expiry
            grants: {
                video: {
                    room: roomName
                }
            }
        };

        // Simple JWT encoding
        const base64url = (str) => {
            return btoa(str).replace(/\+/g, '-').replace(/\//g, '_').replace(/=/g, '');
        };

        const header = base64url(JSON.stringify(jwtHeader));
        const payload = base64url(JSON.stringify(jwtPayload));
        const signature = base64url(
            new TextDecoder().decode(
                await crypto.subtle.sign(
                    'HMAC',
                    await crypto.subtle.importKey(
                        'raw',
                        new TextEncoder().encode(TWILIO_AUTH_TOKEN),
                        { name: 'HMAC', hash: 'SHA-256' },
                        false,
                        ['sign']
                    ),
                    new TextEncoder().encode(`${header}.${payload}`)
                )
            )
        );

        const token = `${header}.${payload}.${signature}`;

        return Response.json({
            success: true,
            token: token,
            roomName: roomName
        });
    } catch (error) {
        return Response.json({ error: error.message }, { status: 500 });
    }
});