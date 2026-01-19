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

    // STAGE 1: Structured Note Ingestion
    const structurePrompt = `Extract and normalize the clinical information into structured components.

Clinical Input:
${clinical_note || clinical_question}

Extract:
1. Chief Complaint / Problem List
2. Key Findings (symptoms, exam findings, labs)
3. Current Medications
4. Vital Signs (if mentioned)
5. Past Medical History
6. Red Flags / Safety Concerns
7. Clinical Context`;

    const structuredData = await base44.integrations.Core.InvokeLLM({
      prompt: structurePrompt,
      add_context_from_internet: false,
      response_json_schema: {
        type: "object",
        properties: {
          chief_complaint: { type: "string" },
          problem_list: { type: "array", items: { type: "string" } },
          key_findings: {
            type: "object",
            properties: {
              symptoms: { type: "array", items: { type: "string" } },
              exam_findings: { type: "array", items: { type: "string" } },
              lab_results: { type: "array", items: { type: "string" } },
              imaging: { type: "array", items: { type: "string" } }
            }
          },
          medications: { type: "array", items: { type: "string" } },
          vital_signs: { type: "object" },
          past_medical_history: { type: "array", items: { type: "string" } },
          red_flags: { type: "array", items: { type: "string" } },
          clinical_context: { type: "string" }
        }
      }
    });

    // STAGE 2A: Generate Broad DDx List
    const ddxPrompt = `Based on this structured clinical data, generate a broad but clinically sensible differential diagnosis list.

${JSON.stringify(structuredData, null, 2)}
${patientContext}

Generate 8-10 differential diagnoses covering:
- Most likely diagnoses
- Life-threatening "can't miss" diagnoses
- Common mimics
- Specialty-specific considerations for ${specialty || 'general medicine'}

For each diagnosis, provide initial likelihood assessment.`;

    const broadDDx = await base44.integrations.Core.InvokeLLM({
      prompt: ddxPrompt,
      add_context_from_internet: true,
      response_json_schema: {
        type: "object",
        properties: {
          differential_diagnoses: {
            type: "array",
            items: {
              type: "object",
              properties: {
                diagnosis: { type: "string" },
                initial_likelihood: { type: "string", enum: ["high", "moderate", "low", "cant_miss"] },
                reasoning: { type: "string" }
              }
            }
          }
        }
      }
    });

    // STAGE 2B: Deep Dive on Top Candidates
    const topCandidates = broadDDx.differential_diagnoses
      .filter(d => d.initial_likelihood === 'high' || d.initial_likelihood === 'cant_miss')
      .slice(0, 5);

    const prompt = `You are an expert clinical reasoning AI with access to current medical literature. Perform deep evidence-based analysis.

STRUCTURED CLINICAL DATA:
${JSON.stringify(structuredData, null, 2)}

${patientContext}

TOP DIFFERENTIAL DIAGNOSES TO ANALYZE:
${JSON.stringify(topCandidates, null, 2)}

Evidence Retrieval Parameters:
- Specialty Focus: ${specialty || 'General Medicine'}
- Journal Authority Level: ${authority_level.toUpperCase()} (${journalGuidance})
${selected_journals.length > 0 ? `- Preferred Journals: ${selected_journals.join(', ')}` : ''}
- Year Range: ${year_range_start}-${year_range_end}
- Article Types: ${selectedArticleTypes}

For each top diagnosis, provide:
- Why it fits this specific patient
- Why it might NOT be this
- Next-best diagnostic tests
- Rule-out steps
- Don't-miss safety considerations

Generate comprehensive evidence-based clinical reasoning with:

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
                likelihood: { type: "string", enum: ["high", "moderate", "low", "cant_miss"] },
                why_it_fits: { type: "string" },
                why_it_might_not: { type: "string" },
                key_features: { type: "array", items: { type: "string" } },
                next_best_tests: { type: "array", items: { type: "string" } },
                rule_out_steps: { type: "array", items: { type: "string" } },
                safety_considerations: { type: "array", items: { type: "string" } },
                supporting_evidence_score: { type: "number" },
                evidence_quality_breakdown: {
                  type: "object",
                  properties: {
                    study_quality: { type: "number" },
                    journal_tier: { type: "number" },
                    recency: { type: "number" },
                    applicability: { type: "number" }
                  }
                }
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
                      quality_score_breakdown: {
                        type: "object",
                        properties: {
                          study_design: { type: "number" },
                          sample_size: { type: "number" },
                          journal_impact: { type: "number" },
                          recency: { type: "number" }
                        }
                      },
                      key_findings: { type: "string" },
                      why_this_applies: { type: "string" },
                      citation: { type: "string" },
                      pubmed_id: { type: "string" }
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
          limitations: { type: "array", items: { type: "string" } },
          governance_notes: {
            type: "object",
            properties: {
              disclaimer: { type: "string" },
              sources_queried: { type: "array", items: { type: "string" } },
              evidence_tiers_used: { type: "array", items: { type: "string" } }
            }
          }
        }
      }
    });

    // Audit logging
    await base44.entities.SecurityLog.create({
      timestamp: new Date().toISOString(),
      user_email: user.email,
      user_role: user.role,
      action: 'generate_evidence_based_report',
      details: {
        patient_id: patient_id || 'none',
        specialty,
        authority_level,
        year_range: `${year_range_start}-${year_range_end}`,
        article_types: selectedArticleTypes,
        note_snippet: (clinical_note || clinical_question).substring(0, 200),
        structured_data: structuredData,
        top_ddx: topCandidates.map(d => d.diagnosis),
        sources_accessed: response.governance_notes?.sources_queried || []
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
      report: {
        ...response,
        structured_input: structuredData,
        broad_ddx_generated: broadDDx.differential_diagnoses.length,
        deep_analysis_count: topCandidates.length
      },
      generated_at: new Date().toISOString(),
      parameters: {
        specialty,
        authority_level,
        year_range: `${year_range_start}-${year_range_end}`,
        article_types
      },
      audit_trail: {
        user: user.email,
        timestamp: new Date().toISOString(),
        note_length: (clinical_note || clinical_question).length,
        evidence_sources: response.governance_notes?.sources_queried?.length || 0
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