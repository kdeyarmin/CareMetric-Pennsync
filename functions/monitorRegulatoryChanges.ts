import { createClientFromRequest } from 'npm:@base44/sdk@0.8.6';
import OpenAI from 'npm:openai@4.28.0';

const openai = new OpenAI({
  apiKey: Deno.env.get('OPENAI_API_KEY'),
});

/**
 * Automated regulatory change monitoring
 * Checks for updates from CMS, HIPAA, and state medical boards
 * Can be called manually or scheduled
 */
Deno.serve(async (req) => {
  try {
    const base44 = createClientFromRequest(req);
    
    // This function can run as service role for scheduled tasks
    // or with user authentication for manual checks
    let user = null;
    try {
      user = await base44.auth.me();
    } catch (e) {
      // Service role execution (scheduled task)
    }

    // If called by user, verify admin role
    if (user && user.role !== 'admin') {
      return Response.json({ error: 'Admin access required' }, { status: 403 });
    }

    console.log('Starting regulatory change monitoring...');

    // Define regulatory sources to monitor
    const regulatorySources = [
      {
        name: 'CMS Medicare Home Health',
        category: 'medicare',
        searchQuery: 'CMS Medicare home health conditions of participation updates 2026'
      },
      {
        name: 'HIPAA Privacy & Security',
        category: 'hipaa',
        searchQuery: 'HIPAA privacy security rule updates healthcare 2026'
      },
      {
        name: 'OASIS Updates',
        category: 'oasis',
        searchQuery: 'OASIS home health assessment updates changes 2026'
      },
      {
        name: 'State Nursing Board Requirements',
        category: 'state_regulation',
        searchQuery: 'state nursing board home health regulations updates 2026'
      }
    ];

    const detectedChanges = [];

    // Monitor each regulatory source
    for (const source of regulatorySources) {
      console.log(`Checking ${source.name}...`);

      const prompt = `Search for recent regulatory changes and updates related to: ${source.searchQuery}

Focus on:
1. New regulations or rule changes
2. Effective dates of changes
3. Impact on home health documentation
4. Compliance requirements
5. Changes to existing standards

Return a structured analysis of any significant changes found in the last 3 months.`;

      const completion = await openai.chat.completions.create({
        model: "gpt-4o",
        messages: [
          {
            role: "system",
            content: "You are a healthcare regulatory compliance expert who monitors changes to healthcare regulations, particularly for home health agencies. Always return valid JSON."
          },
          {
            role: "user",
            content: prompt
          }
        ],
        response_format: { type: "json_object" },
        temperature: 0.2
      });

      const analysis = JSON.parse(completion.choices[0].message.content);

      // Check if significant changes were found
      if (analysis.changes_found && analysis.changes?.length > 0) {
        for (const change of analysis.changes) {
          detectedChanges.push({
            source: source.name,
            category: source.category,
            ...change
          });

          // Create RegulatoryUpdate record
          await base44.asServiceRole.entities.RegulatoryUpdate.create({
            title: change.title || `${source.name} Update`,
            source: source.category === 'medicare' ? 'CMS' : 
                    source.category === 'hipaa' ? 'HIPAA' :
                    source.category === 'oasis' ? 'CMS' : 'State',
            category: mapCategory(source.category),
            effective_date: change.effective_date || new Date().toISOString().split('T')[0],
            summary: change.summary || change.description,
            full_details: change.details || change.summary,
            impact_level: change.impact_level || 'medium',
            affected_areas: change.affected_areas || [source.category],
            required_actions: change.required_actions || [],
            status: 'pending_review',
            reference_url: change.url || null
          });
        }
      }
    }

    // If changes detected, create admin notifications
    if (detectedChanges.length > 0) {
      // Get all admin users
      const adminUsers = await base44.asServiceRole.entities.User.filter({ role: 'admin' });

      for (const admin of adminUsers) {
        await base44.asServiceRole.entities.Task.create({
          title: `Review ${detectedChanges.length} New Regulatory Update(s)`,
          description: `Automated monitoring detected ${detectedChanges.length} regulatory change(s) requiring review:\n\n` +
            detectedChanges.map(c => `- ${c.title} (${c.category})`).join('\n'),
          type: 'document',
          priority: 'high',
          assigned_to: admin.email,
          source: 'ai_generated',
          due_timeframe: '48_hours'
        });
      }
    }

    return Response.json({
      success: true,
      changes_detected: detectedChanges.length,
      changes: detectedChanges,
      message: detectedChanges.length > 0 
        ? `Detected ${detectedChanges.length} regulatory change(s). Admin users have been notified.`
        : 'No significant regulatory changes detected.'
    });

  } catch (error) {
    console.error('Regulatory monitoring error:', error);
    return Response.json({ 
      success: false, 
      error: error.message 
    }, { status: 500 });
  }
});

function mapCategory(sourceCategory) {
  const mapping = {
    'medicare': 'documentation',
    'hipaa': 'hipaa',
    'oasis': 'oasis',
    'state_regulation': 'staffing'
  };
  return mapping[sourceCategory] || 'documentation';
}