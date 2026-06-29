import { createClientFromRequest } from 'npm:@base44/sdk@0.8.31';

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
      
      if (rule.rule_type === 'keyword' && rule.keywords?.length > 0) {
        const text = analysisText.toLowerCase();
        matches = rule.keywords.some(keyword => 
          text.includes(keyword.toLowerCase())
        );
      }
      
      if (rule.rule_type === 'sender' && rule.sender_patterns?.length > 0) {
        matches = rule.sender_patterns.some(pattern => 
          from_number?.includes(pattern) || 
          from_name?.toLowerCase().includes(pattern.toLowerCase())
        );
      }

      if (rule.rule_type === 'recipient' && rule.sender_patterns?.length > 0) {
        matches = rule.sender_patterns.some(pattern => 
          to_number?.includes(pattern) || 
          to_name?.toLowerCase().includes(pattern.toLowerCase())
        );
      }

      if (matches) {
        const priorityScores = { urgent: 4, high: 3, normal: 2, low: 1 };
        const score = priorityScores[rule.priority_level] || 2;
        
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
        priority: matchedRule.priority_level,
        reason: `Matched rule: ${matchedRule.name}`,
        rule_id: matchedRule.id,
        notify_users: matchedRule.notify_users || []
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
      model: "claude_sonnet_4_6",
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
      priority: aiResponse.priority || 'normal',
      reason: aiResponse.reason || 'AI analysis',
      confidence: aiResponse.confidence || 50,
      notify_users: aiResponse.priority === 'urgent' ? [] : []
    });

  } catch (error) {
    console.error('Priority analysis error:', error);
    return Response.json({ 
      priority: 'normal',
      reason: 'Error in analysis: ' + error.message
    });
  }
});