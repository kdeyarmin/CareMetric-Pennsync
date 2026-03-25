import { createClientFromRequest } from 'npm:@base44/sdk@0.8.6';

Deno.serve(async (req) => {
  try {
    const base44 = createClientFromRequest(req);

    // CMS Home Health guidelines URLs
    const guidelineUrls = [
      'https://www.cms.gov/medicare/payment/prospective-payment-systems/home-health',
      'https://www.cms.gov/regulations-and-guidance/guidance/manuals/internet-only-manuals-ioms',
      'https://www.cms.gov/medicare/quality/home-health-quality-reporting-program'
    ];

    const guidelines = [];
    let successCount = 0;
    let errorCount = 0;

    for (const url of guidelineUrls) {
      try {
        // Fetch the webpage content
        const response = await fetch(url);
        const html = await response.text();

        // Extract title from HTML
        const titleMatch = html.match(/<title>(.*?)<\/title>/i);
        const title = titleMatch ? titleMatch[1].replace(' | CMS', '').trim() : 'Medicare Guideline';

        // Extract main content - look for common CMS content patterns
        let content = '';
        
        // Try to extract paragraphs and headings from main content areas
        const mainContentMatch = html.match(/<main[^>]*>([\s\S]*?)<\/main>/i) || 
                                 html.match(/<article[^>]*>([\s\S]*?)<\/article>/i) ||
                                 html.match(/<div[^>]*class="[^"]*content[^"]*"[^>]*>([\s\S]*?)<\/div>/i);
        
        if (mainContentMatch) {
          const mainContent = mainContentMatch[1];
          
          // Extract text from paragraphs and headings
          const textMatches = mainContent.match(/<(h[1-6]|p)[^>]*>(.*?)<\/\1>/gi);
          if (textMatches) {
            content = textMatches
              .map(tag => tag.replace(/<[^>]+>/g, '').trim())
              .filter(text => text.length > 20)
              .join('\n\n');
          }
        }

        // If no content found, use meta description
        if (!content || content.length < 100) {
          const descMatch = html.match(/<meta[^>]*name=["']description["'][^>]*content=["']([^"']+)["']/i);
          content = descMatch ? descMatch[1] : 'Content extraction pending. Please visit the source URL for details.';
        }

        // Clean up content
        content = content
          .replace(/&amp;/g, '&')
          .replace(/&lt;/g, '<')
          .replace(/&gt;/g, '>')
          .replace(/&quot;/g, '"')
          .replace(/&#39;/g, "'")
          .replace(/\s+/g, ' ')
          .trim();

        // Use AI to generate summary and extract key points
        let aiSummary = content.substring(0, 200) + '...';
        let keyPoints = [];
        let keywords = ['CMS', 'Medicare', 'Home Health'];
        
        try {
          const aiResponse = await base44.integrations.Core.InvokeLLM({
            prompt: `Analyze this Medicare/CMS Home Health guideline and provide:
1. A concise 2-3 sentence summary
2. 5-7 key points that nurses need to know
3. 5-8 relevant keywords/tags

Guideline Title: ${title}
Content: ${content.substring(0, 3000)}`,
            response_json_schema: {
              type: "object",
              properties: {
                summary: { type: "string" },
                key_points: { 
                  type: "array", 
                  items: { type: "string" }
                },
                keywords: {
                  type: "array",
                  items: { type: "string" }
                }
              }
            }
          });
          
          if (aiResponse.summary) aiSummary = aiResponse.summary;
          if (aiResponse.key_points) keyPoints = aiResponse.key_points;
          if (aiResponse.keywords) keywords = aiResponse.keywords;
        } catch (error) {
          console.error('AI summary failed, using fallback:', error);
        }

        guidelines.push({
          title,
          url: url,
          source_url: url,
          content_markdown: content.substring(0, 5000),
          summary: aiSummary,
          key_points: keyPoints,
          category: 'clinical_documentation',
          effective_date: new Date().toISOString().split('T')[0],
          last_fetched_date: new Date().toISOString(),
          is_active: true,
          keywords: keywords
        });

        successCount++;
      } catch (error) {
        console.error(`Error fetching ${url}:`, error.message);
        errorCount++;
      }
    }

    // Save guidelines to database using service role
    for (const guideline of guidelines) {
      try {
        // Check if guideline already exists by source URL
        const existing = await base44.asServiceRole.entities.MedicareGuideline.filter({
          source_url: guideline.source_url
        });

        if (existing.length > 0) {
          // Update existing guideline
          await base44.asServiceRole.entities.MedicareGuideline.update(existing[0].id, {
            content_markdown: guideline.content_markdown,
            summary: guideline.summary,
            key_points: guideline.key_points,
            keywords: guideline.keywords,
            last_fetched_date: guideline.last_fetched_date
          });
        } else {
          // Create new guideline
          await base44.asServiceRole.entities.MedicareGuideline.create(guideline);
        }
      } catch (error) {
        console.error('Error saving guideline:', error.message);
        errorCount++;
      }
    }

    return Response.json({
      success: true,
      message: `Fetched ${successCount} guidelines from CMS.gov`,
      details: {
        total_urls: guidelineUrls.length,
        successful: successCount,
        failed: errorCount,
        guidelines_saved: guidelines.length
      }
    });

  } catch (error) {
    console.error('Auto-fetch CMS guidelines error:', error);
    return Response.json(
      { error: 'Failed to fetch CMS guidelines', details: error.message },
      { status: 500 }
    );
  }
});