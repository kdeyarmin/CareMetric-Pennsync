import { createClientFromRequest } from 'npm:@base44/sdk@0.8.6';

Deno.serve(async (req) => {
  try {
    const base44 = createClientFromRequest(req);
    const user = await base44.auth.me();
    if (!user) {
      return Response.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const body = await req.json();
    const { fax_log_id, analysis_type } = body;

    if (!fax_log_id) {
      return Response.json({ error: 'fax_log_id is required' }, { status: 400 });
    }

    // Fetch fax record
    const faxRecords = await base44.entities.FaxHistory.filter({ id: fax_log_id });
    const fax = faxRecords?.[0];

    if (!fax) {
      return Response.json({ error: 'Fax record not found' }, { status: 404 });
    }

    const ocrText = fax.ocr_text || '';
    const type = analysis_type || 'full';

    if (!ocrText && (!fax.document_urls || fax.document_urls.length === 0)) {
      return Response.json({ error: 'No content available for analysis. Run OCR first.' }, { status: 400 });
    }

    // If no OCR text, try to extract from document
    let contentToAnalyze = ocrText;
    if (!contentToAnalyze && fax.document_urls?.length > 0) {
      try {
        const extractResult = await base44.asServiceRole.integrations.Core.ExtractDataFromUploadedFile({
          file_url: fax.document_urls[0],
          json_schema: {
            type: "object",
            properties: {
              text_content: { type: "string" }
            }
          }
        });
        contentToAnalyze = extractResult?.output?.text_content || '';
      } catch (e) {
        console.warn('[analyzeFaxContent] Extraction fallback failed:', e.message);
      }
    }

    if (!contentToAnalyze) {
      return Response.json({ error: 'Could not extract content for analysis' }, { status: 400 });
    }

    // Fetch address book for contact suggestions
    let addressBookContacts = [];
    try {
      addressBookContacts = await base44.entities.FaxContact.filter(
        { user_email: user.email },
        'name',
        50
      );
    } catch (e) {
      console.warn('[analyzeFaxContent] Address book fetch failed:', e.message);
    }

    let prompt = '';
    const responseSchema = {
      type: "object",
      properties: {}
    };

    if (type === 'full' || type === 'summary') {
      prompt = `Analyze this fax document content comprehensively for a HOME HEALTH AGENCY.

FAX CONTENT:
${contentToAnalyze.substring(0, 8000)}

Provide:
1. A concise summary (topic, key points, required actions)
2. Urgency level (critical/high/medium/low)
3. Document category (medical_records, prescription, appointment, referral, lab_results, imaging, insurance, billing, administrative, other)
4. Key action items for the recipient
5. Any alerts or critical findings

6. SENTIMENT ANALYSIS: Identify the overall tone/sentiment of this fax. Choose from:
   - urgent_demand: Aggressive, time-sensitive demand for action
   - concerned: Worried or anxious tone about patient status
   - informational: Neutral, routine information sharing
   - request: Polite request for information or action
   - follow_up: Follow-up on previous communication
   - escalation: Escalating an issue or complaint
   - positive: Good news, progress reports, approvals
   Also provide a short explanation for the sentiment and a confidence score (0-100).

7. HOME HEALTH AGENCY CATEGORY: Auto-categorize this fax into one of these predefined home health agency workflow categories:
   - patient_care: Direct patient care orders, clinical updates, treatment changes, vitals, wound care
   - referrals_intake: New patient referrals, intake documents, physician face-to-face forms
   - billing_insurance: Insurance authorizations, prior auths, claims, payment notices, EOBs
   - compliance_regulatory: Compliance notices, audit requests, Medicare/Medicaid updates, CMS communications
   - lab_diagnostics: Lab results, imaging reports, pathology, diagnostic orders
   - physician_orders: Physician orders, medication changes, plan of care updates, recertifications
   - discharge_transfer: Discharge summaries, transfer documentation, care transitions
   - supplies_equipment: DME orders, supply requests, equipment authorizations
   - scheduling_coordination: Visit scheduling, care coordination, team communications
   - general_administrative: General admin correspondence, miscellaneous
   Also provide the confidence level and reasoning for the categorization.`;

      responseSchema.properties = {
        summary: {
          type: "object",
          properties: {
            topic: { type: "string" },
            key_points: { type: "array", items: { type: "string" } },
            action_items: { type: "array", items: { type: "string" } }
          }
        },
        urgency: { type: "string", enum: ["critical", "high", "medium", "low"] },
        category: { type: "string" },
        alerts: { type: "array", items: { type: "object", properties: { message: { type: "string" }, severity: { type: "string" } } } },
        sentiment: {
          type: "object",
          properties: {
            tone: { type: "string", enum: ["urgent_demand", "concerned", "informational", "request", "follow_up", "escalation", "positive"] },
            explanation: { type: "string" },
            confidence: { type: "number" }
          }
        },
        agency_category: {
          type: "object",
          properties: {
            category: { type: "string", enum: ["patient_care", "referrals_intake", "billing_insurance", "compliance_regulatory", "lab_diagnostics", "physician_orders", "discharge_transfer", "supplies_equipment", "scheduling_coordination", "general_administrative"] },
            confidence: { type: "number" },
            reasoning: { type: "string" }
          }
        }
      };
    }

    if (type === 'full' || type === 'reply') {
      prompt += `\n\nAlso generate a professional reply draft that could be sent back via fax.`;
      responseSchema.properties.reply_draft = { type: "string" };
    }

    if (type === 'full' || type === 'contacts') {
      const contactNames = addressBookContacts.map(c => `${c.name} (${c.fax_number})`).join(', ');
      prompt += `\n\nBased on the content, suggest which contacts from this address book might be relevant: ${contactNames || 'No contacts in address book'}`;
      responseSchema.properties.suggested_contacts = {
        type: "array",
        items: {
          type: "object",
          properties: {
            name: { type: "string" },
            reason: { type: "string" }
          }
        }
      };
    }

    const aiResult = await base44.asServiceRole.integrations.Core.InvokeLLM({
      prompt,
      response_json_schema: responseSchema
    });

    // Save analysis to fax record
    try {
      await base44.asServiceRole.entities.FaxHistory.update(fax_log_id, {
        ai_analysis: {
          summary: aiResult.summary?.topic || '',
          category: aiResult.category || '',
          urgency: aiResult.urgency || '',
          key_points: aiResult.summary?.key_points || [],
          action_items: aiResult.summary?.action_items || [],
          reply_draft: aiResult.reply_draft || '',
          suggested_contacts: aiResult.suggested_contacts || [],
          sentiment: aiResult.sentiment || null,
          agency_category: aiResult.agency_category || null
        }
      });
    } catch (e) {
      console.warn('[analyzeFaxContent] Failed to save analysis:', e.message);
    }

    return Response.json({
      success: true,
      analysis_type: type,
      ...aiResult
    });

  } catch (error) {
    console.error('[analyzeFaxContent] Error:', error.message, error.stack);
    return Response.json({ error: error.message }, { status: 500 });
  }
});