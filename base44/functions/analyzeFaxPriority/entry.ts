import { createClientFromRequest } from 'npm:@base44/sdk@0.8.31';

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

    // Require authentication: previously unauthenticated, so anonymous callers
    // could run billable service-role LLM calls and bump FaxPriorityRule counts.
    // Mirrors analyzeFaxContent. Internal callers (sendBatchFax) propagate identity.
    const user = await base44.auth.me().catch(() => null);
    if (!user) {
      return Response.json({ error: 'Unauthorized' }, { status: 401 });
    }
    if (isDeactivatedUser(user)) return DEACTIVATED_USER_RESPONSE();

    const {
      document_name,
      cover_page_details, 
      to_number, 
      from_number,
      to_name,
      from_name 
    } = await req.json();

    if (!document_name && !cover_page_details) {
      return Response.json({ 
        priority: 'normal',
        reason: 'No content to analyze'
      });
    }

    // Fetch active priority rules
    const rules = await base44.asServiceRole.entities.FaxPriorityRule.filter(
      { is_active: true },
      '-created_date',
      100
    );

    // Build analysis text
    let analysisText = `Document: ${document_name || 'Untitled'}\n`;
    if (cover_page_details) {
      analysisText += `Subject: ${cover_page_details.subject || ''}\n`;
      analysisText += `Message: ${cover_page_details.message || ''}\n`;
    }
    analysisText += `To: ${to_name || to_number}\n`;
    analysisText += `From: ${from_name || from_number}\n`;

    // Check user-defined rules first
    let matchedRule = null;
    let ruleScore = 0;

    for (const rule of rules) {
      let matches = false;
      
      if (rule.rule_type === 'keyword' && rule.pattern) {
        const text = analysisText.toLowerCase();
        matches = text.includes(rule.pattern.toLowerCase());
      }

      if (rule.rule_type === 'sender' && rule.pattern) {
        matches = from_number?.includes(rule.pattern) ||
          from_name?.toLowerCase().includes(rule.pattern.toLowerCase());
      }

      if (rule.rule_type === 'recipient' && rule.pattern) {
        matches = to_number?.includes(rule.pattern) ||
          to_name?.toLowerCase().includes(rule.pattern.toLowerCase());
      }

      if (matches) {
        const priorityScores = { urgent: 4, high: 3, normal: 2, low: 1 };
        const score = priorityScores[rule.priority] || 2;
        
        if (score > ruleScore) {
          ruleScore = score;
          matchedRule = rule;
        }
      }
    }

    // If rule matched, use it
    if (matchedRule) {
      // Update match count
      await base44.asServiceRole.entities.FaxPriorityRule.update(matchedRule.id, {
        match_count: (matchedRule.match_count || 0) + 1
      });

      return Response.json({
        priority: matchedRule.priority,
        reason: `Matched rule: ${matchedRule.name}`,
        rule_id: matchedRule.id,
        notify: matchedRule.notify || false,
        notify_users: []
      });
    }

    // Use AI analysis as fallback
    const aiPrompt = `Analyze this fax and determine its priority level (urgent, high, normal, or low).

Fax Details:
${analysisText}

Consider:
- Medical emergencies or critical health information = urgent
- Test results, prescriptions, patient records = high
- Routine correspondence, administrative = normal
- Non-urgent notices = low

Urgent keywords: STAT, emergency, critical, urgent, immediate, code
High keywords: results, prescription, medication, admission, discharge
Normal keywords: appointment, schedule, reminder, follow-up
Low keywords: notice, information, update, newsletter

Respond with JSON: {"priority": "urgent|high|normal|low", "reason": "brief explanation", "confidence": 0-100}`;

    const aiResponse = await base44.asServiceRole.integrations.Core.InvokeLLM({
      model: "automatic",
      prompt: aiPrompt,
      response_json_schema: {
        type: "object",
        properties: {
          priority: { type: "string" },
          reason: { type: "string" },
          confidence: { type: "number" }
        }
      }
    });

    return Response.json({
      priority: aiResponse?.priority || 'normal',
      reason: aiResponse?.reason || 'AI analysis',
      confidence: aiResponse?.confidence || 50,
      notify: aiResponse?.priority === 'urgent',
      notify_users: []
    });

  } catch (error) {
    console.error('Priority analysis error:', error);
    // Generic reason only — the raw exception text stays server-side.
    return Response.json({
      priority: 'normal',
      reason: 'Error in analysis'
    });
  }
});