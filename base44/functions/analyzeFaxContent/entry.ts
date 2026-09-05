import { createClientFromRequest } from 'npm:@base44/sdk@0.8.31';

// <<<BEGIN SHARED HELPER: protectedUserAuthz — generated, edit base44/_shared/backendHelpers.mjs>>>
const normalizeProtectedEmail = (value) => String(value || '').trim().toLowerCase();
const isProtectedAdmin = (user) => !!user && user.role === 'admin';
function isProtectedSuperAdmin(user) {
  const configuredEmail = normalizeProtectedEmail(Deno.env.get('SUPER_ADMIN_EMAIL'));
  return !!configuredEmail
    && isProtectedAdmin(user)
    && normalizeProtectedEmail(user.email) === configuredEmail;
}
// <<<END SHARED HELPER: protectedUserAuthz>>>

// <<<BEGIN SHARED HELPER: requireActiveUser — generated, edit base44/_shared/backendHelpers.mjs>>>
const isDeactivatedUser = (u) => !!u && u.is_active === false;
const DEACTIVATED_USER_RESPONSE = () => Response.json(
  { error: 'Unauthorized - account is deactivated' },
  { status: 403 },
);
// <<<END SHARED HELPER: requireActiveUser>>>

Deno.serve(async (req) => {
  try {
    const base44 = createClientFromRequest(req);
    const user = await base44.auth.me();
    if (!user) return Response.json({ error: 'Unauthorized' }, { status: 401 });
    if (isDeactivatedUser(user)) return DEACTIVATED_USER_RESPONSE();
    const callerEmail = normalizeProtectedEmail(user.email);
    if (!callerEmail) return Response.json({ error: 'Forbidden' }, { status: 403 });

    const { fax_log_id, analysis_type = 'full' } = await req.json();

    if (!fax_log_id) {
      return Response.json({ error: 'Missing fax_log_id' }, { status: 400 });
    }

    // Fetch the fax log
    const faxLog = await base44.asServiceRole.entities.FaxLog.filter({ id: fax_log_id }, undefined, 5000);
    if (!faxLog || faxLog.length === 0) {
      return Response.json({ error: 'Fax not found' }, { status: 404 });
    }

    const fax = faxLog[0];
    // Ownership: only the sender (or the configured platform administrator) may
    // analyze a fax's PHI content. account_type and agency_name are mutable User
    // fields, so neither is authorization to cross an ownership boundary.
    // Fail CLOSED on a missing sender: a legacy/system fax with no sent_by must
    // not be readable by a caller who guesses its id. A configured protected
    // super admin remains the sole cross-owner break-glass path.
    const isOwner = normalizeProtectedEmail(fax.sent_by) === callerEmail;
    if (!isOwner && !isProtectedSuperAdmin(user)) {
      return Response.json({ error: 'Forbidden' }, { status: 403 });
    }
    const ocrText = fax.ocr_text || '';

    if (!ocrText) {
      return Response.json({
        error: 'No OCR text available. Please process OCR first.',
        summary: null,
        reply_draft: null,
        suggested_contacts: []
      });
    }

    // Build context for AI
    const context = `
Fax Details:
- From: ${fax.from_number}
- To: ${fax.to_number} (${fax.to_name || 'Unknown'})
- Document: ${fax.document_name || 'Untitled'}
- Date: ${fax.created_date}
- Priority: ${fax.priority || 'normal'}

OCR Content:
${ocrText.substring(0, 4000)}
${ocrText.length > 4000 ? '...(truncated)' : ''}
`;

    let summary = null;
    let replyDraft = null;
    let suggestedContacts = [];
    let alerts = [];

    // Fetch only the caller's address-book rows. FaxContact has no immutable,
    // server-verified agency membership key, so a mutable agency claim must not
    // widen this service-role read. Re-check every returned row in memory in case
    // the backend ever ignores or regresses the filter.
    const contactRows = await base44.asServiceRole.entities.FaxContact.filter(
      { user_email: callerEmail },
      '-created_date',
      500
    );
    const allContacts = (Array.isArray(contactRows) ? contactRows : [])
      .filter((contact) =>
        normalizeProtectedEmail(contact?.user_email) === callerEmail
        && normalizeProtectedEmail(contact?.created_by) === callerEmail
      );

    // Perform analysis based on type
    if (analysis_type === 'full' || analysis_type === 'summary') {
      const summaryPrompt = `Analyze this fax and provide a concise summary.

${context}

Provide:
1. Main topic/purpose (1-2 sentences)
2. Key points (bullet list, 3-5 items)
3. Action items if any
4. Urgency assessment

Return JSON: {
  "topic": "brief topic description",
  "key_points": ["point 1", "point 2", ...],
  "action_items": ["action 1", ...],
  "urgency": "low|medium|high|critical",
  "category": "medical_records|prescription|appointment|administrative|other"
}`;

      const summaryResult = await base44.asServiceRole.integrations.Core.InvokeLLM({
        model: "automatic",
        prompt: summaryPrompt,
        response_json_schema: {
          type: "object",
          properties: {
            topic: { type: "string" },
            key_points: { type: "array", items: { type: "string" } },
            action_items: { type: "array", items: { type: "string" } },
            urgency: { type: "string" },
            category: { type: "string" }
          }
        }
      });

      summary = summaryResult || null;

      // Check for alerts based on urgency
      if (summaryResult?.urgency === 'critical' || summaryResult?.urgency === 'high') {
        alerts.push({
          type: 'urgency',
          severity: summaryResult.urgency,
          message: `High priority fax requires attention: ${summaryResult.topic || 'unspecified topic'}`,
          action_required: Array.isArray(summaryResult.action_items) && summaryResult.action_items.length > 0
        });
      }
    }

    if (analysis_type === 'full' || analysis_type === 'reply') {
      const replyPrompt = `Draft a professional reply to this fax.

${context}

Create a courteous, professional fax reply that:
1. Acknowledges receipt
2. Addresses the main points
3. Provides next steps if needed
4. Maintains a professional tone

Return JSON: {
  "subject": "reply subject line",
  "body": "full reply text with proper formatting and paragraphs",
  "suggested_attachments": ["list any documents that should be attached"]
}`;

      const replyResult = await base44.asServiceRole.integrations.Core.InvokeLLM({
        model: "automatic",
        prompt: replyPrompt,
        response_json_schema: {
          type: "object",
          properties: {
            subject: { type: "string" },
            body: { type: "string" },
            suggested_attachments: { type: "array", items: { type: "string" } }
          }
        }
      });

      replyDraft = replyResult;
    }

    if (analysis_type === 'full' || analysis_type === 'contacts') {
      const contactPrompt = `Based on this fax content, suggest relevant contacts to send it to or follow up with.

${context}

Available contacts:
${allContacts.slice(0, 50).map(c => `- ${c.name} (${c.organization || 'N/A'}) - ${c.fax_number}`).join('\n')}

Identify up to 5 contacts who should receive this fax or be informed. Consider:
- Medical facilities mentioned
- Referring physicians
- Specialists
- Insurance companies
- Administrative departments

Return JSON: {
  "suggested_contacts": [
    {"name": "contact name", "fax_number": "number", "reason": "why they should be contacted"}
  ]
}`;

      const contactResult = await base44.asServiceRole.integrations.Core.InvokeLLM({
        model: "automatic",
        prompt: contactPrompt,
        response_json_schema: {
          type: "object",
          properties: {
            suggested_contacts: {
              type: "array",
              items: {
                type: "object",
                properties: {
                  name: { type: "string" },
                  fax_number: { type: "string" },
                  reason: { type: "string" }
                }
              }
            }
          }
        }
      });

      // Match with actual contacts
      suggestedContacts = (contactResult?.suggested_contacts || []).map(suggested => {
        const match = allContacts.find(c =>
          c.fax_number === suggested.fax_number ||
          c.name?.toLowerCase().includes(suggested.name?.toLowerCase())
        );
        return {
          ...suggested,
          contact_id: match?.id,
          matched: !!match
        };
      });
    }

    // Check for status alerts
    if (fax.status === 'failed') {
      alerts.push({
        type: 'delivery_failed',
        severity: 'high',
        message: `Fax delivery failed: ${fax.failure_reason || 'Unknown error'}`,
        action_required: true
      });
    } else if (fax.retry_count > 0) {
      alerts.push({
        type: 'retry_occurred',
        severity: 'medium',
        message: `Fax required ${fax.retry_count} retry attempt(s)`,
        action_required: false
      });
    }

    return Response.json({
      success: true,
      fax_id: fax_log_id,
      summary,
      reply_draft: replyDraft,
      suggested_contacts: suggestedContacts,
      alerts,
      timestamp: new Date().toISOString()
    });

  } catch (error) {
    console.error('Fax content analysis error:', error);
    return Response.json({ error: 'Internal server error' }, { status: 500 });
  }
});
