import { createClientFromRequest } from 'npm:@base44/sdk@0.8.6';

/**
 * Scheduled job to automatically sync Medicare guidelines from a predefined list.
 * This job should be triggered weekly via a scheduling service (e.g., cron, GitHub Actions, etc.)
 * 
 * To set up weekly scheduling:
 * 1. Use a cron service to call this endpoint weekly: POST /functions/scheduledGuidelineSync
 * 2. Include service token in Authorization header
 * 3. Or configure via external scheduler (e.g., GitHub Actions with schedule trigger)
 */

// Predefined list of critical Medicare guidelines to sync
const GUIDELINES_TO_SYNC = [
  {
    url: 'https://www.cms.gov/medicare/payment/medicare-fee-for-service-payment/home-health-services/home-health-prospective-payment-system',
    category: 'medicare_cop',
    subcategory: 'Home Health PPS',
    keywords: ['home health', 'prospective payment', 'HHPPS', 'reimbursement']
  },
  {
    url: 'https://www.cms.gov/medicare/quality/home-health-quality-reporting-program/home-health-quality-reporting-program',
    category: 'quality_measures',
    subcategory: 'Home Health Quality Reporting',
    keywords: ['quality measures', 'HHQRP', 'reporting']
  },
  {
    url: 'https://www.cms.gov/medicare/health-safety-standards/quality-safety-oversight-general-information/conditions-participation-cops',
    category: 'medicare_cop',
    subcategory: 'Conditions of Participation',
    keywords: ['conditions of participation', 'CoPs', 'compliance', 'regulations']
  },
  {
    url: 'https://www.cms.gov/medicare/payment/medicare-fee-for-service-payment/home-health-services/home-health-patient-driven-groupings-model',
    category: 'pdgm',
    subcategory: 'Patient-Driven Groupings Model',
    keywords: ['PDGM', 'patient-driven', 'groupings', 'case mix']
  }
];

Deno.serve(async (req) => {
  const startTime = Date.now();
  
  try {
    const base44 = createClientFromRequest(req);
    
    // Create initial log entry
    const logEntry = await base44.asServiceRole.entities.SystemLog.create({
      job_name: 'Medicare Guidelines Weekly Sync',
      job_type: 'medicare_guideline_sync',
      status: 'running',
      message: 'Starting scheduled guideline sync...',
      details: {
        guidelines_count: GUIDELINES_TO_SYNC.length,
        start_time: new Date().toISOString()
      }
    });

    const results = {
      total: GUIDELINES_TO_SYNC.length,
      created: 0,
      updated: 0,
      failed: 0,
      errors: []
    };

    // Process each guideline
    for (const guidelineConfig of GUIDELINES_TO_SYNC) {
      try {
        // Use base44 integration to fetch webpage content directly
        const fetchResult = await base44.integrations.Core.InvokeLLM({
          prompt: `Extract and summarize the content from this URL: ${guidelineConfig.url}\n\nReturn the full extracted content as markdown.`,
          add_context_from_internet: true,
          response_json_schema: {
            type: "object",
            properties: {
              content: { type: "string" }
            }
          }
        });

        const markdownContent = fetchResult.content || '';

        if (!markdownContent || markdownContent.trim().length < 100) {
          throw new Error(`No content extracted from ${guidelineConfig.url}`);
        }

        // Use AI to extract structured info
        const analysisPrompt = `Analyze this Medicare guideline content and extract structured information.

CONTENT:
${markdownContent.substring(0, 4000)}

Extract and return JSON with:
{
  "title": "Clear, concise title of the guideline",
  "summary": "2-3 sentence summary of key requirements and what nurses need to know",
  "extracted_keywords": ["keyword1", "keyword2", ...],
  "related_diagnoses": ["diagnosis1", "diagnosis2", ...],
  "applies_to_visit_types": ["visit_type1", ...],
  "effective_date": "YYYY-MM-DD or null if not found",
  "regulatory_citation": "Official citation if found"
}`;

        const analysis = await base44.integrations.Core.InvokeLLM({
          prompt: analysisPrompt,
          response_json_schema: {
            type: "object",
            properties: {
              title: { type: "string" },
              summary: { type: "string" },
              extracted_keywords: { type: "array", items: { type: "string" } },
              related_diagnoses: { type: "array", items: { type: "string" } },
              applies_to_visit_types: { type: "array", items: { type: "string" } },
              effective_date: { type: ["string", "null"] },
              regulatory_citation: { type: ["string", "null"] }
            }
          }
        });

        // Combine keywords
        const allKeywords = [
          ...(guidelineConfig.keywords || []),
          ...(analysis.extracted_keywords || [])
        ].filter((k, i, arr) => arr.indexOf(k) === i);

        // Check if exists
        const existing = await base44.asServiceRole.entities.MedicareGuideline.filter({ 
          url: guidelineConfig.url 
        });
        
        const guidelineData = {
          title: analysis.title,
          url: guidelineConfig.url,
          content_markdown: markdownContent,
          summary: analysis.summary,
          category: guidelineConfig.category,
          subcategory: guidelineConfig.subcategory || null,
          effective_date: analysis.effective_date || null,
          last_fetched_date: new Date().toISOString(),
          keywords: allKeywords,
          related_diagnoses: analysis.related_diagnoses || [],
          applies_to_visit_types: analysis.applies_to_visit_types || [],
          is_active: true,
          cms_manual_chapter: guidelineConfig.cms_manual_chapter || null,
          regulatory_citation: analysis.regulatory_citation || null
        };

        if (existing && existing.length > 0) {
          await base44.asServiceRole.entities.MedicareGuideline.update(
            existing[0].id,
            guidelineData
          );
          results.updated++;
        } else {
          await base44.asServiceRole.entities.MedicareGuideline.create(guidelineData);
          results.created++;
        }

      } catch (error) {
        results.failed++;
        results.errors.push({
          url: guidelineConfig.url,
          error: error.message
        });
      }
    }

    const duration = Date.now() - startTime;
    const finalStatus = results.failed === 0 ? 'success' : 
                        results.failed < results.total ? 'warning' : 'error';

    // Update log entry with final results
    await base44.asServiceRole.entities.SystemLog.update(logEntry.id, {
      status: finalStatus,
      message: `Sync completed: ${results.created} created, ${results.updated} updated, ${results.failed} failed`,
      details: {
        ...results,
        end_time: new Date().toISOString()
      },
      duration_ms: duration,
      records_processed: results.total,
      records_created: results.created,
      records_updated: results.updated,
      records_failed: results.failed
    });

    return Response.json({
      success: finalStatus !== 'error',
      status: finalStatus,
      results: results,
      duration_ms: duration,
      log_id: logEntry.id
    });

  } catch (error) {
    const duration = Date.now() - startTime;
    
    // Log critical failure
    try {
      const base44 = createClientFromRequest(req);
      await base44.asServiceRole.entities.SystemLog.create({
        job_name: 'Medicare Guidelines Weekly Sync',
        job_type: 'medicare_guideline_sync',
        status: 'error',
        message: 'Critical failure: ' + error.message,
        error_stack: error.stack,
        duration_ms: duration,
        details: {
          error_time: new Date().toISOString()
        }
      });
    } catch (logError) {
      console.error('Failed to log error:', logError);
    }

    return Response.json({ 
      success: false,
      error: error.message,
      details: 'Scheduled guideline sync failed'
    }, { status: 500 });
  }
});