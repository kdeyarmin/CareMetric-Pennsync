import { createClientFromRequest } from 'npm:@base44/sdk@0.8.46';

/**
 * Retired compatibility endpoint.
 *
 * The historical action multiplexer mixed two PHI purposes behind one broad
 * input surface. Secure-message v2 uses the separate, purpose-bound
 * summarizeMessageThread and generateMessageSuggestions brokers instead.
 */
const SECURE_MESSAGE_DOMAIN_PAUSED = true;

function json(payload: unknown, status = 200) {
  return Response.json(payload, {
    status,
    headers: { 'Cache-Control': 'no-store' },
  });
}

const secureMessageUnavailable = () => json({
  error: 'Secure messaging is temporarily unavailable',
  code: 'secure_message_tenant_broker_required',
}, 503);

Deno.serve(async (_req) => {
  if (SECURE_MESSAGE_DOMAIN_PAUSED) return secureMessageUnavailable();

  // Intentionally do not create a client or parse the request. This broad
  // endpoint stays retired even after the domain gate is reviewed.
  void createClientFromRequest;
  return json({
    error: 'This endpoint is retired; use a purpose-bound secure-message broker',
    code: 'secure_message_purpose_broker_required',
  }, 410);
});
