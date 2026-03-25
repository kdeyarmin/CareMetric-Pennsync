import { createClientFromRequest } from 'npm:@base44/sdk@0.8.6';

Deno.serve(async (req) => {
  try {
    const base44 = createClientFromRequest(req);
    const user = await base44.auth.me();
    if (!user) return Response.json({ error: 'Unauthorized' }, { status: 401 });
    if (user.role !== 'admin') return Response.json({ error: 'Admin only' }, { status: 403 });

    const openaiApiKey = Deno.env.get('OPENAI_API_KEY');
    if (!openaiApiKey) throw new Error('OPENAI_API_KEY not configured');

    const { dateRangeDays = 30 } = await req.json();

    // Fetch recent note conversions
    const cutoff = new Date();
    cutoff.setDate(cutoff.getDate() - dateRangeDays);

    const notes = await base44.asServiceRole.entities.NoteConversion.filter(
      {},
      '-created_date',
      200
    );

    const recentNotes = notes.filter(n => n.created_date && new Date(n.created_date) >= cutoff);

    if (recentNotes.length === 0) {
      return Response.json({
        success: true,
        message: 'No notes found in the selected date range.',
        trends: null,
        note_count: 0
      });
    }

    // Build a condensed summary of the notes for analysis
    const notesSummary = recentNotes.map((n, i) => {
      return `Note ${i + 1} [${n.visit_type || 'unknown visit'}] [${n.diagnosis || 'no diagnosis'}] [Compliance: ${n.enhanced_note_compliance || 'N/A'}%] [Quality: ${n.quality_score || 'N/A'}%]: ${(n.enhanced_note || n.rough_note || '').slice(0, 400)}`;
    }).join('\n\n');

    const prompt = `You are a senior clinical quality analyst for a home health agency. Analyze the following ${recentNotes.length} clinical notes from the past ${dateRangeDays} days and produce a comprehensive trend analysis report.

CLINICAL NOTES:
${notesSummary}

Analyze and return JSON with this exact structure:
{
  "summary": "2-3 sentence executive summary of overall clinical patterns",
  "diagnosis_trends": [
    { "diagnosis": string, "count": number, "percentage": number, "trend": "increasing"|"stable"|"decreasing", "clinical_note": string }
  ],
  "treatment_trends": [
    { "treatment_pattern": string, "frequency": "high"|"medium"|"low", "effectiveness_signal": string, "recommendation": string }
  ],
  "outcome_insights": [
    { "finding": string, "impact": "positive"|"negative"|"neutral", "affected_patient_count": number, "detail": string }
  ],
  "protocol_improvement_opportunities": [
    { "area": string, "priority": "critical"|"high"|"medium"|"low", "current_gap": string, "recommended_action": string, "expected_impact": string }
  ],
  "quality_metrics": {
    "avg_compliance_score": number,
    "avg_quality_score": number,
    "documentation_completeness_rate": number,
    "high_risk_documentation_flags": number
  },
  "alerts": [
    { "type": "warning"|"info"|"critical", "message": string }
  ]
}`;

    const gptRes = await fetch('https://api.openai.com/v1/chat/completions', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${openaiApiKey}` },
      body: JSON.stringify({
        model: 'gpt-4o',
        max_tokens: 4096,
        response_format: { type: 'json_object' },
        messages: [{ role: 'user', content: prompt }]
      })
    });

    if (!gptRes.ok) {
      const err = await gptRes.text();
      throw new Error(`GPT-4o error: ${gptRes.status} - ${err}`);
    }

    const gptData = await gptRes.json();
    const trends = JSON.parse(gptData.choices?.[0]?.message?.content || '{}');

    console.log('[analyzeClinicalTrends] Analysis complete for', recentNotes.length, 'notes');

    return Response.json({
      success: true,
      note_count: recentNotes.length,
      date_range_days: dateRangeDays,
      generated_at: new Date().toISOString(),
      trends
    });

  } catch (error) {
    console.error('[analyzeClinicalTrends] Error:', error.message);
    return Response.json({ success: false, error: error.message }, { status: 500 });
  }
});