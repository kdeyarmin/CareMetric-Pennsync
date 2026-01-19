import { createClientFromRequest } from 'npm:@base44/sdk@0.8.6';

Deno.serve(async (req) => {
  try {
    const base44 = createClientFromRequest(req);
    const user = await base44.auth.me();

    if (!user) {
      return Response.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const { 
      clinical_note,
      clinical_question,
      patient_id,
      specialty,
      authority_level = 'high', // high, medium, low
      year_range_start = 2020,
      year_range_end = new Date().getFullYear(),
      article_types = ['practice_guidelines', 'meta_analyses', 'randomized_controlled_trials'],
      selected_journals = [],
      include_drug_info = true,
      include_community_insights = false
    } = await req.json();

    if (!clinical_note && !clinical_question) {
      return Response.json({ error: 'Either clinical_note or clinical_question is required' }, { status: 400 });
    }

    // Fetch patient context if available
    let patientContext = '';
    if (patient_id) {
      try {
        const patient = await base44.entities.Patient.get(patient_id);
        const age = patient.date_of_birth ? Math.floor((Date.now() - new Date(patient.date_of_birth)) / 31557600000) : 'Unknown';
        patientContext = `
Patient Context:
- Age: ${age}
- Gender: ${patient.gender || 'Unknown'}
- Primary Diagnosis: ${patient.primary_diagnosis || 'N/A'}
- Secondary Diagnoses: ${patient.secondary_diagnoses?.join(', ') || 'None'}
- Allergies: ${patient.allergies || 'None'}
- Current Medications: ${patient.current_medications?.map(m => `${m.name} ${m.dosage}`).join(', ') || 'None'}
- Past Medical History: ${patient.past_medical_history?.join(', ') || 'None'}
`;
      } catch (e) {
        console.log('Could not fetch patient:', e.message);
      }
    }

    const journalGuidance = {
      high: 'Focus on top-tier journals: New England Journal of Medicine, JAMA, Lancet, BMJ, Annals of Internal Medicine, PLOS Medicine, Cochrane Reviews',
      medium: 'Include respected specialty journals and national medical journals',
      low: 'Include all peer-reviewed medical journals'
    }[authority_level];

    const articleTypeMapping = {
      practice_guidelines: 'Clinical practice guidelines from professional societies',
      meta_analyses: 'Meta-analyses and systematic reviews',
      randomized_controlled_trials: 'Randomized controlled trials (RCTs)',
      cohort_studies: 'Prospective and retrospective cohort studies',
      case_control_studies: 'Case-control studies',
      case_series: 'Case series and case reports',
      review_articles: 'Review articles and narrative reviews'
    };

    const selectedArticleTypes = article_types.map(t => articleTypeMapping[t] || t).join(', ');

    const prompt = `You are an expert clinical reasoning AI assistant with access to current medical literature, clinical guidelines, and evidence-based medicine databases.

${patientContext}

Clinical Input:
${clinical_note ? `SOAP Note:\n${clinical_note}` : ''}
${clinical_question ? `Clinical Question:\n${clinical_question}` : ''}

Evidence Retrieval Parameters:
- Specialty Focus: ${specialty || 'General Medicine'}
- Journal Authority Level: ${authority_level.toUpperCase()} (${journalGuidance})
${selected_journals.length > 0 ? `- Preferred Journals: ${selected_journals.join(', ')}` : ''}
- Year Range: ${year_range_start}-${year_range_end}
- Article Types: ${selectedArticleTypes}

Generate a comprehensive evidence-based clinical reasoning report with:

1. **Executive Summary**: Brief clinical synopsis and key recommendations
2. **Differential Diagnoses**: Top differential diagnoses with likelihood ratings and key distinguishing features
3. **Evidence-Based Treatment Options**: Treatment approaches with supporting evidence quality scores
4. **Clinical Guidelines**: Relevant practice guidelines from professional societies
5. **Recent Evidence**: Recent high-quality studies (${year_range_start}-${year_range_end}) with citations
${include_drug_info ? '6. **Drug Information**: Medication options with FDA-approved indications, dosing, warnings, and adverse effects' : ''}
${include_community_insights ? '7. **Clinical Pearls**: Real-world clinical insights and practical considerations' : ''}

For each piece of evidence, provide:
- Quality Score (1-10) based on study design, journal impact, and recency
- Study Type (RCT, Meta-analysis, Cohort, etc.)
- Year published
- Key findings
- Clinical applicability

Search current medical databases, PubMed, clinical practice guidelines, and FDA resources for the most recent and relevant evidence.`;

    const response = await base44.integrations.Core.InvokeLLM({
      prompt,
      add_context_from_internet: true, // Critical for accessing current medical literature
      response_json_schema: {
        type: "object",
        properties: {
          executive_summary: { type: "string" },
          clinical_scenario: { type: "string" },
          differential_diagnoses: {
            type: "array",
            items: {
              type: "object",
              properties: {
                diagnosis: { type: "string" },
                likelihood: { type: "string", enum: ["high", "moderate", "low"] },
                key_features: { type: "array", items: { type: "string" } },
                distinguishing_factors: { type: "string" },
                supporting_evidence_score: { type: "number" }
              }
            }
          },
          treatment_options: {
            type: "array",
            items: {
              type: "object",
              properties: {
                treatment: { type: "string" },
                category: { type: "string" },
                evidence_quality_score: { type: "number" },
                recommendation_strength: { type: "string", enum: ["strong", "moderate", "weak"] },
                supporting_studies: {
                  type: "array",
                  items: {
                    type: "object",
                    properties: {
                      title: { type: "string" },
                      journal: { type: "string" },
                      year: { type: "number" },
                      study_type: { type: "string" },
                      quality_score: { type: "number" },
                      key_findings: { type: "string" },
                      citation: { type: "string" }
                    }
                  }
                },
                contraindications: { type: "array", items: { type: "string" } },
                monitoring_required: { type: "array", items: { type: "string" } }
              }
            }
          },
          clinical_guidelines: {
            type: "array",
            items: {
              type: "object",
              properties: {
                organization: { type: "string" },
                guideline_title: { type: "string" },
                year: { type: "number" },
                key_recommendations: { type: "array", items: { type: "string" } },
                strength_of_recommendation: { type: "string" },
                url: { type: "string" }
              }
            }
          },
          drug_information: {
            type: "array",
            items: {
              type: "object",
              properties: {
                drug_name: { type: "string" },
                generic_name: { type: "string" },
                class: { type: "string" },
                fda_approved_indications: { type: "array", items: { type: "string" } },
                typical_dosing: { type: "string" },
                black_box_warnings: { type: "array", items: { type: "string" } },
                common_adverse_effects: { type: "array", items: { type: "string" } },
                significant_interactions: { type: "array", items: { type: "string" } },
                pregnancy_category: { type: "string" },
                renal_dosing_required: { type: "boolean" }
              }
            }
          },
          clinical_pearls: {
            type: "array",
            items: {
              type: "object",
              properties: {
                pearl: { type: "string" },
                source_type: { type: "string", enum: ["clinical_practice", "expert_opinion", "systematic_review"] },
                practical_application: { type: "string" }
              }
            }
          },
          red_flags: {
            type: "array",
            items: {
              type: "object",
              properties: {
                warning: { type: "string" },
                severity: { type: "string", enum: ["critical", "high", "moderate"] },
                action_required: { type: "string" }
              }
            }
          },
          follow_up_recommendations: {
            type: "array",
            items: { type: "string" }
          },
          overall_evidence_quality: { type: "string" },
          limitations: { type: "array", items: { type: "string" } }
        }
      }
    });

    // Save the report if patient_id provided
    if (patient_id) {
      try {
        await base44.entities.PatientRecommendation.create({
          patient_id,
          recommendation_type: 'evidence_based_clinical_reasoning',
          title: 'AI Evidence-Based Clinical Report',
          content: JSON.stringify(response),
          source: 'ai_clinical_reasoning_agent',
          priority: 'high',
          created_by: user.email
        });
      } catch (e) {
        console.log('Could not save recommendation:', e.message);
      }
    }

    return Response.json({
      success: true,
      report: response,
      generated_at: new Date().toISOString(),
      parameters: {
        specialty,
        authority_level,
        year_range: `${year_range_start}-${year_range_end}`,
        article_types
      }
    });

  } catch (error) {
    console.error('Error in generateEvidenceBasedReport:', error);
    return Response.json({ 
      error: 'Failed to generate evidence-based report',
      details: error.message 
    }, { status: 500 });
  }
});