// PDGM Navigator AI prompt + response-schema builders.
// Extracted from AutomatedPDGMNavigator.jsx to keep the component focused on UI/state.
// These are pure string/object builders — no React, no side effects.

export const buildNavigationRequest = ({ pdgmData, analysisResults, revenueData }) => ({
  model: "claude_opus_4_8",
  prompt: `You are a CMS PDGM expert navigator. Analyze this OASIS data and determine the correct PDGM grouping with detailed explanation.

OASIS/PDGM DATA:
${JSON.stringify({
  primary_diagnosis: pdgmData.primary_diagnosis,
  primary_diagnosis_code: pdgmData.primary_diagnosis_code,
  primary_diagnosis_description: pdgmData.primary_diagnosis_description,
  comorbidities: pdgmData.comorbidities,
  admission_source: pdgmData.admission_source,
  episode_timing: pdgmData.episode_timing,
  m0110_episode_timing: pdgmData.m0110_episode_timing,
  soc_date: pdgmData.soc_date,
  functional_scores: pdgmData.functional_scores,
  clinical_items: pdgmData.clinical_items,
  therapy_services: pdgmData.therapy_services
}, null, 2)}

EXISTING ANALYSIS SCORES:
${JSON.stringify({
  accuracy: analysisResults?.accuracy_score,
  compliance: analysisResults?.compliance_score,
  revenue: analysisResults?.revenue_optimization_score
}, null, 2)}

CURRENT REVENUE CALCULATION (if available):
${JSON.stringify(revenueData?.original || {}, null, 2)}

CRITICAL INSTRUCTIONS:
- ALL ICD-10 diagnoses are valid for PDGM - there is no such thing as an "invalid diagnosis for PDGM"
- Every diagnosis maps to one of the 12 PDGM clinical groups (MMTA categories)
- If you're uncertain about the exact mapping, use your best clinical judgment to assign to the most appropriate group
- Do NOT flag a diagnosis as "invalid" or "not recognized" - instead, determine which clinical group it most closely aligns with
- If the diagnosis is unclear, assign it to "MMTA_Other" rather than marking it as invalid

Provide a complete PDGM navigation analysis:

1. CLINICAL GROUP DETERMINATION
- Identify the correct PDGM clinical group based on the primary diagnosis ICD-10 code
- Every diagnosis MUST be assigned to one of the 12 clinical groups (Surgical Aftercare, Cardiac/Circulatory, Endocrine, GI/GU, Infectious Disease, Respiratory, Neuro/Rehab, Wounds, Complex Nursing, Behavioral Health, Medication Management, Musculoskeletal, or Other)
- Explain WHY this clinical group applies based on the diagnosis description and ICD-10 category
- List alternative clinical groups that could apply if documentation or coding changes
- Only flag issues if there are true documentation problems (missing info, conflicting data) - NOT diagnosis validity

2. FUNCTIONAL IMPAIRMENT LEVEL
- Calculate total functional points from M-items (M1800-M1860)
- Determine functional level (Low/Medium/High)
- Explain threshold cutoffs used
- Identify which M-items are driving the level

3. COMORBIDITY ADJUSTMENT
- Analyze comorbidities for PDGM relevance
- Identify high-value vs low-value comorbidities
- Determine comorbidity adjustment level (None/Low/High)
- Flag missing comorbidities that could be documented

4. ADMISSION SOURCE & EPISODE TIMING
- Validate admission source (Community vs Institutional)
- Validate episode timing (Early vs Late)
- Check for discrepancies with M0110 and dates
- Calculate payment impact of source/timing combination

5. CASE-MIX CALCULATION
- Show step-by-step case-mix weight calculation
- Break down each multiplier contribution
- Calculate final payment amount

6. DISCREPANCIES & OPPORTUNITIES
- Flag any data discrepancies found
- Identify documentation opportunities for higher reimbursement
- Provide specific recommendations

Return JSON:
{
  "clinical_group": {
    "assigned_group": "MMTA_GroupName",
    "group_name": "Human readable name",
    "confidence": "high/medium/low",
    "rationale": "Why this group was assigned based on the diagnosis",
    "icd10_basis": "ICD-10 code category and clinical reasoning for this mapping",
    "alternative_groups": [{"group": "name", "if_condition": "what would need to change"}],
    "potential_issues": ["ONLY list real documentation issues like missing data or conflicts - NEVER say diagnosis is invalid"]
  },
  "functional_level": {
    "total_points": 0,
    "level": "low/medium/high",
    "point_breakdown": {
      "m1800_grooming": {"score": 0, "max": 3, "contribution": "description"},
      "m1810_dress_upper": {"score": 0, "max": 3, "contribution": "description"},
      "m1820_dress_lower": {"score": 0, "max": 3, "contribution": "description"},
      "m1830_bathing": {"score": 0, "max": 6, "contribution": "description"},
      "m1840_toilet_transfer": {"score": 0, "max": 4, "contribution": "description"},
      "m1850_transferring": {"score": 0, "max": 5, "contribution": "description"},
      "m1860_ambulation": {"score": 0, "max": 6, "contribution": "description"}
    },
    "threshold_used": "X points for low, Y for high",
    "level_driver": "Which items are driving the level",
    "optimization_opportunities": ["ways to improve if clinically appropriate"]
  },
  "comorbidity_adjustment": {
    "level": "none/low/high",
    "total_comorbidities": 0,
    "high_value_count": 0,
    "medium_value_count": 0,
    "high_value_conditions": ["list"],
    "medium_value_conditions": ["list"],
    "missing_opportunities": ["comorbidities that could be added if present"],
    "rationale": "explanation of level determination"
  },
  "admission_timing": {
    "admission_source": "community/institutional",
    "admission_source_confidence": "high/medium/low",
    "admission_source_evidence": "what supports this",
    "episode_timing": "early/late",
    "episode_timing_confidence": "high/medium/low",
    "episode_timing_evidence": "what supports this",
    "m0110_value": "value if found",
    "days_since_soc": null,
    "discrepancies": ["any conflicts found"],
    "payment_impact": "how this combination affects payment"
  },
  "case_mix_calculation": {
    "base_payment": 2038.22,
    "clinical_weight": 0.0,
    "functional_multiplier": 0.0,
    "comorbidity_multiplier": 0.0,
    "source_timing_key": "community_early etc",
    "final_case_mix_weight": 0.0,
    "calculated_payment": 0.0,
    "calculation_steps": [
      "Step 1: description",
      "Step 2: description"
    ]
  },
  "discrepancies": [
    {
      "type": "category",
      "severity": "critical/high/medium/low",
      "finding": "what was found",
      "expected": "what should be",
      "actual": "what is documented",
      "revenue_impact": "$ impact estimate",
      "recommendation": "what to do"
    }
  ],
  "optimization_opportunities": [
    {
      "area": "area name",
      "current_state": "current documentation",
      "opportunity": "what could change",
      "potential_impact": "$ or % impact",
      "action_required": "specific action",
      "clinical_justification_needed": "what clinical evidence is needed"
    }
  ],
  "summary": {
    "payment_amount": 0.0,
    "key_drivers": ["top 3 factors affecting payment"],
    "risk_areas": ["areas of concern"],
    "quick_wins": ["easy improvements"]
  }
}`,
  response_json_schema: {
    type: "object",
    properties: {
      clinical_group: { type: "object" },
      functional_level: { type: "object" },
      comorbidity_adjustment: { type: "object" },
      admission_timing: { type: "object" },
      case_mix_calculation: { type: "object" },
      discrepancies: { type: "array", items: { type: "object" } },
      optimization_opportunities: { type: "array", items: { type: "object" } },
      summary: { type: "object" }
    }
  }
});

export const buildFinancialPredictionRequest = ({ item, type, revenueData, navigation, agencyCosts }) => ({
  model: "claude_opus_4_8",
  prompt: `You are a PDGM financial analyst. Predict the financial impact of this ${type} over a 1-year period.

${type.toUpperCase()} DETAILS:
${JSON.stringify(item, null, 2)}

CURRENT REVENUE DATA:
Base Payment: ${revenueData?.original?.totalPayment || navigation?.case_mix_calculation?.calculated_payment || 2038.22}
Current Case-Mix: ${revenueData?.original?.caseMixWeight || navigation?.case_mix_calculation?.final_case_mix_weight || 1.0}

AGENCY-SPECIFIC COST DATA (use these values for calculations):
- Average Staff Hourly Rate: $${agencyCosts.avg_staff_hourly_rate || 45}
- Training Cost Per Hour: $${agencyCosts.training_cost_per_hour || 35}
- Documentation Time Per Episode: ${agencyCosts.documentation_time_per_episode || 0.5} hours
- Audit Staff Hourly Rate: $${agencyCosts.audit_staff_hourly_rate || 50}
- Average Similar Episodes Per Year: ${agencyCosts.avg_episodes_per_year || 50}
- Current documentation pattern: likely to repeat
- Industry average correction rate: 65% if addressed proactively

IMPORTANT: Use the agency-specific values above for ALL cost calculations, implementation costs, and breakeven analysis.

Provide a detailed financial impact analysis:

1. PER-EPISODE IMPACT
   - Current state payment (if unaddressed)
   - Corrected state payment (if addressed)
   - Net gain per episode

2. ANNUAL PROJECTION (1 YEAR)
   - Use ${agencyCosts.avg_episodes_per_year || 50} episodes/year based on agency data
   - Total revenue if unaddressed
   - Total revenue if corrected
   - Total opportunity cost
   - Cumulative impact over time

3. RISK ANALYSIS
   - Probability this issue repeats: %
   - Audit risk if unaddressed
   - Compliance exposure
   - Downside scenarios

4. PRIORITIZATION SCORE
   - Financial urgency (1-10)
   - Ease of correction (1-10)
   - ROI potential (low/medium/high)
   - Recommended action timeline

5. BREAKEVEN ANALYSIS
   - Time to implement correction (in hours)
   - Cost to implement using agency rates:
     * Staff time at $${agencyCosts.avg_staff_hourly_rate || 45}/hour
     * Training at $${agencyCosts.training_cost_per_hour || 35}/hour
     * Documentation updates at ${agencyCosts.documentation_time_per_episode || 0.5} hours/episode
     * Audit/review at $${agencyCosts.audit_staff_hourly_rate || 50}/hour
   - Breakeven point (# of episodes)
   - Net benefit after 1 year

Return JSON:
{
  "per_episode": {
    "current_payment": 0,
    "corrected_payment": 0,
    "gain_per_episode": 0,
    "percentage_increase": 0,
    "explanation": "why this gap exists"
  },
  "annual_projection": {
    "similar_episodes_per_year": ${agencyCosts.avg_episodes_per_year || 50},
    "total_current_revenue": 0,
    "total_corrected_revenue": 0,
    "total_opportunity": 0,
    "opportunity_if_50_percent_corrected": 0,
    "cumulative_12_month": 0,
    "monthly_impact": 0
  },
  "risk_analysis": {
    "repetition_probability": 0,
    "audit_risk_level": "low/medium/high/critical",
    "compliance_exposure": "description",
    "downside_scenario": "worst case if unaddressed",
    "downside_amount": 0
  },
  "prioritization": {
    "financial_urgency": 0,
    "ease_of_correction": 0,
    "roi_potential": "low/medium/high",
    "priority_rank": "low/medium/high/critical",
    "recommended_timeline": "immediate/this week/this month/this quarter",
    "justification": "why this priority"
  },
  "breakeven": {
    "implementation_time": "time estimate",
    "implementation_cost": 0,
    "episodes_to_breakeven": 0,
    "time_to_breakeven": "time estimate",
    "net_benefit_year_1": 0,
    "roi_percentage": 0
  },
  "visual_summary": {
    "icon": "💰/⚠️/🎯/📈",
    "tagline": "one-sentence impact summary",
    "color_code": "green/yellow/orange/red"
  }
}`,
  response_json_schema: {
    type: "object",
    properties: {
      per_episode: { type: "object" },
      annual_projection: { type: "object" },
      risk_analysis: { type: "object" },
      prioritization: { type: "object" },
      breakeven: { type: "object" },
      visual_summary: { type: "object" }
    }
  }
});

export const buildResolutionWorkflowRequest = ({ discrepancy, pdgmData }) => ({
  model: "claude_opus_4_8",
  prompt: `You are a CMS OASIS compliance expert. Provide a detailed resolution workflow for this PDGM discrepancy.

DISCREPANCY DETAILS:
${JSON.stringify(discrepancy, null, 2)}

FULL OASIS CONTEXT:
Primary Diagnosis: ${pdgmData.primary_diagnosis_code} - ${pdgmData.primary_diagnosis_description}
Admission Source: ${pdgmData.admission_source}
Episode Timing: ${pdgmData.episode_timing}
Functional Scores: ${JSON.stringify(pdgmData.functional_scores, null, 2)}
Comorbidities: ${JSON.stringify(pdgmData.comorbidities, null, 2)}

Provide a comprehensive resolution plan:

1. ROOT CAUSE ANALYSIS
   - Identify exactly why this discrepancy occurred
   - Explain the specific data points causing the issue

2. STEP-BY-STEP CORRECTION PROCESS
   - Provide numbered steps to resolve
   - Be specific about which M-items or fields need correction
   - Include verification steps

3. CLINICAL DOCUMENTATION CHANGES
   - Provide exact text snippets to add/modify
   - Show before/after examples
   - Ensure clinical appropriateness

4. CMS GUIDELINES REFERENCE
   - Cite specific CMS OASIS-E guidance sections
   - Reference relevant M-item definitions
   - Include PDGM grouping rules

5. VALIDATION CHECKLIST
   - List items to verify after correction
   - Include interdependency checks

Return JSON:
{
  "root_cause": "detailed explanation of why discrepancy exists",
  "severity_explanation": "why this matters for reimbursement/compliance",
  "correction_steps": [
    {
      "step_number": 1,
      "action": "what to do",
      "specific_fields": ["M-items or fields to change"],
      "rationale": "why this step is needed"
    }
  ],
  "documentation_changes": [
    {
      "item": "M-item or field",
      "current_value": "what's currently documented",
      "recommended_value": "what it should be",
      "example_narrative": "exact text to add to clinical notes",
      "clinical_justification": "why this is clinically appropriate"
    }
  ],
  "cms_references": [
    {
      "guideline": "CMS guideline name",
      "section": "specific section",
      "quote": "relevant quote from guideline",
      "application": "how it applies to this case"
    }
  ],
  "validation_checklist": [
    "item to verify after correction"
  ],
  "estimated_resolution_time": "time estimate",
  "revenue_impact_if_resolved": "$ impact explanation"
}`,
  response_json_schema: {
    type: "object",
    properties: {
      root_cause: { type: "string" },
      severity_explanation: { type: "string" },
      correction_steps: { type: "array", items: { type: "object" } },
      documentation_changes: { type: "array", items: { type: "object" } },
      cms_references: { type: "array", items: { type: "object" } },
      validation_checklist: { type: "array", items: { type: "string" } },
      estimated_resolution_time: { type: "string" },
      revenue_impact_if_resolved: { type: "string" }
    }
  }
});