import { createClientFromRequest } from 'npm:@base44/sdk@0.8.6';

Deno.serve(async (req) => {
  try {
    const base44 = createClientFromRequest(req);
    const user = await base44.auth.me();
    if (!user) {
      return Response.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const body = await req.json();
    const {
      note_content,
      visit_type = 'routine',
      regulations = ['medicare', 'hipaa', 'clia'],
      patient_demographics = {}
    } = body;

    const anthropicApiKey = Deno.env.get('ANTHROPIC_API_KEY');
    if (!anthropicApiKey) {
      throw new Error('ANTHROPIC_API_KEY not configured');
    }

    const regulationChecks = {
      medicare: {
        name: 'Medicare Compliance (42 CFR 484)',
        requirements: [
          'Skilled nursing services documented',
          'Medical necessity clearly stated',
          'Patient homebound status documented (if applicable)',
          'Frequency and duration of services specified',
          'Functional limitations and rehabilitation potential noted'
        ]
      },
      hipaa: {
        name: 'HIPAA Security & Privacy',
        requirements: [
          'No unnecessary PHI exposed',
          'Patient identifiers minimized',
          'No unauthorized access indicators',
          'Data entry security appropriate',
          'Audit trail maintainable'
        ]
      },
      clia: {
        name: 'CLIA Lab Regulations',
        requirements: [
          'Lab test results properly documented',
          'Chain of custody maintained',
          'QA/QC references included',
          'Provider credentials verified',
          'Test method standards followed'
        ]
      },
      jcaho: {
        name: 'Joint Commission Standards',
        requirements: [
          'Patient safety measures documented',
          'Care plan alignment verified',
          'Interdisciplinary communication noted',
          'Patient/family involvement documented',
          'Quality improvement efforts noted'
        ]
      }
    };

    const regulationText = regulations
      .filter(r => regulationChecks[r])
      .map(r => `${regulationChecks[r].name}:\n- ${regulationChecks[r].requirements.join('\n- ')}`)
      .join('\n\n');

    const compliancePrompt = `Review this clinical note for compliance with multiple healthcare regulations:

CLINICAL NOTE:
${note_content}

VISIT TYPE: ${visit_type}

COMPLIANCE CHECKS REQUIRED:
${regulationText}

Provide:
1. Overall compliance score (0-100)
2. Regulation-by-regulation assessment
3. Critical issues (audit risk)
4. Warnings (attention needed)
5. Recommendations for improvement
6. Specific citations/requirements that apply

Format as structured analysis with actionable fixes.`;

    const claudeResponse = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': anthropicApiKey,
        'anthropic-version': '2023-06-01'
      },
      body: JSON.stringify({
        model: 'claude-3-5-sonnet-20241022',
        max_tokens: 2048,
        messages: [{ role: 'user', content: compliancePrompt }]
      })
    });

    if (!claudeResponse.ok) {
      throw new Error(`Claude API failed: ${claudeResponse.status}`);
    }

    const claudeResult = await claudeResponse.json();
    const analysis = claudeResult.content?.[0]?.text || '';

    return Response.json({
      success: true,
      analysis,
      regulations_checked: regulations,
      timestamp: new Date().toISOString(),
      real_time_feedback: true
    });

  } catch (error) {
    console.error('[multiRegulationComplianceCheck] Error:', error.message);
    return Response.json({
      success: false,
      error: error.message
    }, { status: 500 });
  }
});